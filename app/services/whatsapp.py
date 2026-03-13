"""WhatsApp Web automation via Playwright — persistent browser session.

Uses a persistent user_data_dir so the QR code only needs scanning once.
"""

import asyncio
import base64
import logging
from pathlib import Path

from playwright.async_api import async_playwright, Playwright, Browser, BrowserContext, Page

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# Persistent data dir for WhatsApp session
WA_DATA_DIR = Path.home() / ".agentnet" / "whatsapp_data"


class WhatsAppSession:
    """Manages a Chromium browser session for WhatsApp Web."""

    def __init__(self):
        self.playwright: Playwright | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None
        self._started = False

    async def start(self) -> None:
        """Launch browser with persistent context, navigate to WhatsApp Web."""
        WA_DATA_DIR.mkdir(parents=True, exist_ok=True)

        self.playwright = await async_playwright().start()
        self.context = await self.playwright.chromium.launch_persistent_context(
            str(WA_DATA_DIR),
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
            viewport={"width": 1280, "height": 900},
            user_agent=USER_AGENT,
            locale="en-US",
        )
        # Remove webdriver flag
        await self.context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )

        if self.context.pages:
            self.page = self.context.pages[0]
        else:
            self.page = await self.context.new_page()

        await self.page.goto("https://web.whatsapp.com", wait_until="domcontentloaded", timeout=30000)
        # Wait a bit for the page to load
        await asyncio.sleep(3)
        self._started = True
        logger.info("WhatsApp session started")

    async def close(self) -> None:
        """Close the browser session."""
        if self.context:
            await self.context.close()
        if self.playwright:
            await self.playwright.stop()
        self._started = False
        logger.info("WhatsApp session closed")

    async def is_authenticated(self) -> bool:
        """Check if WhatsApp Web is authenticated (no QR code showing)."""
        if not self.page:
            return False
        try:
            # If the side panel (chat list) is visible, we're authenticated
            chat_list = await self.page.query_selector('[data-testid="chat-list"]')
            if chat_list:
                return True
            # Also check for the search box
            search = await self.page.query_selector('[data-testid="chat-list-search"]')
            if search:
                return True
            return False
        except Exception:
            return False

    async def get_qr_screenshot(self) -> str:
        """Take a screenshot showing the QR code for authentication."""
        if not self.page:
            raise RuntimeError("WhatsApp session not started")
        buf = await self.page.screenshot(type="jpeg", quality=80)
        return base64.b64encode(buf).decode("ascii")

    async def list_chats(self, limit: int = 20) -> list[dict]:
        """Scrape the chat list from the sidebar."""
        if not self.page:
            raise RuntimeError("WhatsApp session not started")

        chats = await self.page.evaluate(f"""
            () => {{
                const results = [];
                const chatItems = document.querySelectorAll('[data-testid="cell-frame-container"]');
                for (let i = 0; i < Math.min(chatItems.length, {limit}); i++) {{
                    const item = chatItems[i];
                    const nameEl = item.querySelector('[data-testid="cell-frame-title"] span[title]');
                    const lastMsgEl = item.querySelector('[data-testid="last-msg-status"] span[title]') ||
                                      item.querySelector('span[data-testid="last-msg-status"]');
                    const timeEl = item.querySelector('[data-testid="cell-frame-secondary"]');
                    const unreadEl = item.querySelector('[data-testid="icon-unread-count"]');

                    const name = nameEl ? nameEl.getAttribute('title') || nameEl.textContent : '';
                    const lastMsg = lastMsgEl ? (lastMsgEl.getAttribute('title') || lastMsgEl.textContent) : '';
                    const time = timeEl ? timeEl.textContent : '';
                    const unread = unreadEl ? parseInt(unreadEl.textContent || '0') : 0;

                    if (name) {{
                        results.push({{ name, lastMessage: lastMsg, time, unread }});
                    }}
                }}
                return results;
            }}
        """)
        return chats

    async def get_messages(self, chat_name: str, limit: int = 30) -> list[dict]:
        """Open a chat by name and scrape recent messages."""
        if not self.page:
            raise RuntimeError("WhatsApp session not started")

        # Search for the chat
        search_box = await self.page.query_selector('[data-testid="chat-list-search"]')
        if search_box:
            await search_box.click()
            await self.page.keyboard.press("Control+a")
            await self.page.keyboard.type(chat_name)
            await asyncio.sleep(1)

        # Click on the first matching chat
        try:
            chat_el = await self.page.wait_for_selector(
                f'span[title="{chat_name}"]',
                timeout=5000,
            )
            if chat_el:
                await chat_el.click()
                await asyncio.sleep(1)
        except Exception:
            logger.warning("Could not find chat: %s", chat_name)
            return []

        # Scrape messages
        messages = await self.page.evaluate(f"""
            () => {{
                const results = [];
                const msgRows = document.querySelectorAll('[data-testid="msg-container"]');
                const startIdx = Math.max(0, msgRows.length - {limit});
                for (let i = startIdx; i < msgRows.length; i++) {{
                    const row = msgRows[i];
                    const textEl = row.querySelector('.selectable-text span');
                    const metaEl = row.querySelector('[data-testid="msg-meta"]');
                    const isOutgoing = row.classList.contains('message-out') ||
                                       row.closest('[data-testid="conv-msg-true"]') !== null;

                    const text = textEl ? textEl.textContent : '';
                    const time = metaEl ? metaEl.textContent : '';

                    if (text) {{
                        results.push({{
                            from: isOutgoing ? 'me' : 'other',
                            text: text.substring(0, 500),
                            time
                        }});
                    }}
                }}
                return results;
            }}
        """)
        return messages

    async def send_message(self, chat_name: str, text: str) -> bool:
        """Open a chat and send a message."""
        if not self.page:
            raise RuntimeError("WhatsApp session not started")

        # Navigate to the chat
        search_box = await self.page.query_selector('[data-testid="chat-list-search"]')
        if search_box:
            await search_box.click()
            await self.page.keyboard.press("Control+a")
            await self.page.keyboard.type(chat_name)
            await asyncio.sleep(1)

        try:
            chat_el = await self.page.wait_for_selector(
                f'span[title="{chat_name}"]',
                timeout=5000,
            )
            if chat_el:
                await chat_el.click()
                await asyncio.sleep(1)
        except Exception:
            logger.warning("Could not find chat: %s", chat_name)
            return False

        # Type the message
        input_box = await self.page.query_selector('[data-testid="conversation-compose-box-input"]')
        if not input_box:
            logger.warning("Could not find message input box")
            return False

        await input_box.click()
        await self.page.keyboard.type(text)
        await asyncio.sleep(0.5)

        # Send
        send_btn = await self.page.query_selector('[data-testid="send"]')
        if send_btn:
            await send_btn.click()
            logger.info("WhatsApp: sent message to %s", chat_name)
            return True

        # Try pressing Enter as fallback
        await self.page.keyboard.press("Enter")
        logger.info("WhatsApp: sent message to %s (via Enter)", chat_name)
        return True

    async def search_chats(self, query: str) -> list[dict]:
        """Search chats using the WhatsApp search bar."""
        if not self.page:
            raise RuntimeError("WhatsApp session not started")

        search_box = await self.page.query_selector('[data-testid="chat-list-search"]')
        if not search_box:
            return []

        await search_box.click()
        await self.page.keyboard.press("Control+a")
        await self.page.keyboard.type(query)
        await asyncio.sleep(1.5)

        return await self.list_chats(limit=10)


# ── Singleton session management ────────────────────────────────────

_sessions: dict[str, WhatsAppSession] = {}


async def get_whatsapp_session(user_id: str) -> WhatsAppSession:
    """Get or create a WhatsApp session for a user."""
    if user_id not in _sessions or not _sessions[user_id]._started:
        session = WhatsAppSession()
        await session.start()
        _sessions[user_id] = session
    return _sessions[user_id]


async def close_whatsapp_session(user_id: str) -> None:
    """Close a WhatsApp session for a user."""
    if user_id in _sessions:
        await _sessions[user_id].close()
        del _sessions[user_id]
