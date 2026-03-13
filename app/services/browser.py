"""Playwright browser automation wrapper for the job application agent.

Provides a BrowserSession class that manages a headless Chromium instance
with methods for navigation, interaction, and screenshots.
"""

import asyncio
import base64
import logging
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright, Playwright, Browser, Page

logger = logging.getLogger(__name__)

# Realistic user agent to avoid bot detection
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


class BrowserSession:
    """Manages a headless Chromium browser for job application automation."""

    def __init__(self, viewport_width: int = 1280, viewport_height: int = 900):
        self.playwright: Playwright | None = None
        self.browser: Browser | None = None
        self.page: Page | None = None
        self.viewport_width = viewport_width
        self.viewport_height = viewport_height
        self._temp_files: list[str] = []

    async def start(self) -> None:
        """Launch headless Chromium with stealth settings."""
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        context = await self.browser.new_context(
            viewport={"width": self.viewport_width, "height": self.viewport_height},
            user_agent=USER_AGENT,
            locale="en-US",
            timezone_id="Europe/Paris",
        )
        # Remove webdriver flag
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        self.page = await context.new_page()
        logger.info("Browser session started (viewport %dx%d)", self.viewport_width, self.viewport_height)

    async def screenshot(self, quality: int = 60) -> str:
        """Take screenshot and return as base64 JPEG string."""
        if not self.page:
            raise RuntimeError("Browser not started")
        buf = await self.page.screenshot(type="jpeg", quality=quality)
        return base64.b64encode(buf).decode("ascii")

    async def goto(self, url: str, timeout: int = 30000) -> None:
        """Navigate to URL."""
        if not self.page:
            raise RuntimeError("Browser not started")
        logger.info("Browser: navigating to %s", url)
        await self.page.goto(url, wait_until="domcontentloaded", timeout=timeout)

    async def click(self, selector: str, timeout: int = 5000) -> None:
        """Click an element by CSS selector or text."""
        if not self.page:
            raise RuntimeError("Browser not started")
        logger.info("Browser: clicking '%s'", selector)
        try:
            # Try CSS selector first
            await self.page.click(selector, timeout=timeout)
        except Exception:
            # Try by text content
            try:
                await self.page.get_by_text(selector, exact=False).first.click(timeout=timeout)
            except Exception:
                # Try by role/label
                await self.page.get_by_role("button", name=selector).or_(
                    self.page.get_by_role("link", name=selector)
                ).first.click(timeout=timeout)

    async def click_coordinates(self, x: int, y: int) -> None:
        """Click at specific pixel coordinates."""
        if not self.page:
            raise RuntimeError("Browser not started")
        logger.info("Browser: clicking at (%d, %d)", x, y)
        await self.page.mouse.click(x, y)

    async def fill(self, selector: str, value: str, timeout: int = 5000) -> None:
        """Fill an input field."""
        if not self.page:
            raise RuntimeError("Browser not started")
        logger.info("Browser: filling '%s' with '%s'", selector, value[:50])
        try:
            await self.page.fill(selector, value, timeout=timeout)
        except Exception:
            # Try by placeholder or label
            try:
                await self.page.get_by_placeholder(selector).first.fill(value, timeout=timeout)
            except Exception:
                await self.page.get_by_label(selector).first.fill(value, timeout=timeout)

    async def type_text(self, text: str, delay: int = 50) -> None:
        """Type text character by character (useful for search boxes with autocomplete)."""
        if not self.page:
            raise RuntimeError("Browser not started")
        logger.info("Browser: typing '%s'", text[:50])
        await self.page.keyboard.type(text, delay=delay)

    async def press(self, key: str) -> None:
        """Press a keyboard key (Enter, Tab, Escape, etc.)."""
        if not self.page:
            raise RuntimeError("Browser not started")
        logger.info("Browser: pressing '%s'", key)
        await self.page.keyboard.press(key)

    async def scroll(self, direction: str = "down", amount: int = 3) -> None:
        """Scroll the page. direction: 'up' or 'down'. amount: number of scroll ticks."""
        if not self.page:
            raise RuntimeError("Browser not started")
        delta = amount * 300 if direction == "down" else -(amount * 300)
        logger.info("Browser: scrolling %s by %d", direction, amount)
        await self.page.mouse.wheel(0, delta)
        await asyncio.sleep(0.5)  # let content load

    async def wait(self, seconds: float = 2) -> None:
        """Wait for a specified time."""
        await asyncio.sleep(min(seconds, 10))  # cap at 10s

    async def get_page_text(self) -> str:
        """Extract visible text content from the page."""
        if not self.page:
            raise RuntimeError("Browser not started")
        return await self.page.inner_text("body")

    async def get_url(self) -> str:
        """Get current page URL."""
        if not self.page:
            return ""
        return self.page.url

    async def upload_file(self, selector: str, file_data: bytes, filename: str, mime_type: str) -> None:
        """Upload a file to a file input element."""
        if not self.page:
            raise RuntimeError("Browser not started")
        # Write to temp file
        suffix = Path(filename).suffix or ".pdf"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp.write(file_data)
        tmp.close()
        self._temp_files.append(tmp.name)

        logger.info("Browser: uploading '%s' to '%s'", filename, selector)
        try:
            locator = self.page.locator(selector)
            await locator.set_input_files(tmp.name)
        except Exception:
            # Try finding file input near the selector
            locator = self.page.locator("input[type='file']").first
            await locator.set_input_files(tmp.name)

    async def set_cookies(self, cookies: list[dict]) -> None:
        """Set browser cookies (for logged-in sessions)."""
        if not self.page:
            raise RuntimeError("Browser not started")
        context = self.page.context
        await context.add_cookies(cookies)

    async def close(self) -> None:
        """Close the browser and clean up temp files."""
        if self.browser:
            try:
                await self.browser.close()
            except Exception:
                pass
        if self.playwright:
            try:
                await self.playwright.stop()
            except Exception:
                pass
        # Clean up temp files
        for f in self._temp_files:
            try:
                Path(f).unlink(missing_ok=True)
            except Exception:
                pass
        self._temp_files.clear()
        logger.info("Browser session closed")
