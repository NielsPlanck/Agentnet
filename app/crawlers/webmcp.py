"""WebMCP Crawler — detect and index client-side tools from websites.

WebMCP (W3C proposal by Microsoft & Google) lets websites expose JavaScript
tools via `navigator.modelContext.registerTool()`. These tools run in the
browser and can be called by AI agents.

This crawler:
1. Fetches web pages and looks for WebMCP registration signals in the HTML/JS
2. Accepts manual registration of WebMCP tool definitions via API
3. Indexes discovered tools into AgentNet's database

Usage:
    # Crawl a single URL
    uv run python -m app.crawlers.webmcp https://example.com

    # Crawl from a list file (one URL per line)
    uv run python -m app.crawlers.webmcp --file urls.txt
"""

import asyncio
import json
import logging
import re
import sys
import time

import httpx
from sqlalchemy import select

from app.database import async_session, engine
from app.models.tool import Action, Base, Tool
from app.services.embeddings import get_embedding

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
)

# Patterns that indicate WebMCP usage in page source
WEBMCP_SIGNALS = [
    r"navigator\.modelContext",
    r"modelContext\.registerTool",
    r"window\.navigator\.modelContext",
    r'"modelContext"',
    r"registerTool\s*\(",
]

# Pattern to extract tool registration objects from JS
REGISTER_TOOL_PATTERN = re.compile(
    r"registerTool\s*\(\s*(\{[\s\S]*?\})\s*\)",
    re.MULTILINE,
)

# Pattern to extract name, description, inputSchema from a tool object
TOOL_NAME_PATTERN = re.compile(r"""name\s*:\s*["']([^"']+)["']""")
TOOL_DESC_PATTERN = re.compile(r"""description\s*:\s*["']([^"']+)["']""")
TOOL_SCHEMA_PATTERN = re.compile(
    r"inputSchema\s*:\s*(\{[\s\S]*?\})\s*[,}]"
)


def detect_webmcp_signals(html: str) -> bool:
    """Check if a page's HTML/JS contains WebMCP registration signals."""
    for pattern in WEBMCP_SIGNALS:
        if re.search(pattern, html):
            return True
    return False


def extract_tools_from_source(html: str) -> list[dict]:
    """Extract tool definitions from page source code (best-effort static analysis)."""
    tools = []

    for match in REGISTER_TOOL_PATTERN.finditer(html):
        tool_block = match.group(1)

        name_match = TOOL_NAME_PATTERN.search(tool_block)
        desc_match = TOOL_DESC_PATTERN.search(tool_block)

        if not name_match:
            continue

        tool_def = {
            "name": name_match.group(1),
            "description": desc_match.group(1) if desc_match else "",
            "input_schema": None,
        }

        # Try to parse inputSchema (may fail for complex JS objects)
        schema_match = TOOL_SCHEMA_PATTERN.search(tool_block)
        if schema_match:
            try:
                # Attempt to parse as JSON (works for simple schemas)
                schema_text = schema_match.group(1)
                # Convert JS-style to JSON-style
                schema_text = re.sub(r"(\w+)\s*:", r'"\1":', schema_text)
                schema_text = schema_text.replace("'", '"')
                tool_def["input_schema"] = json.loads(schema_text)
            except (json.JSONDecodeError, ValueError):
                pass

        tools.append(tool_def)

    return tools


async def scan_url(client: httpx.AsyncClient, url: str) -> dict | None:
    """Scan a single URL for WebMCP tool registrations.

    Returns a dict with page info and discovered tools, or None if no WebMCP found.
    """
    try:
        r = await client.get(url, follow_redirects=True)
        r.raise_for_status()
    except (httpx.HTTPError, httpx.InvalidURL) as e:
        logger.warning("Failed to fetch %s: %s", url, e)
        return None

    html = r.text
    final_url = str(r.url)

    if not detect_webmcp_signals(html):
        logger.debug("No WebMCP signals found on %s", url)
        return None

    logger.info("WebMCP signals detected on %s", url)
    tools = extract_tools_from_source(html)

    # Extract page title
    title_match = re.search(r"<title>([^<]+)</title>", html, re.IGNORECASE)
    title = title_match.group(1).strip() if title_match else url

    # Extract domain as provider
    from urllib.parse import urlparse

    parsed = urlparse(final_url)
    provider = parsed.netloc.replace("www.", "")

    return {
        "url": final_url,
        "title": title,
        "provider": provider,
        "has_signals": True,
        "tools": tools,
        "tools_count": len(tools),
    }


async def ingest_webmcp_tools(
    scan_result: dict,
    session=None,
) -> Tool | None:
    """Insert discovered WebMCP tools into the database."""
    own_session = session is None
    if own_session:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        session = async_session()

    try:
        url = scan_result["url"]
        provider = scan_result["provider"]
        title = scan_result["title"]
        tools_data = scan_result["tools"]

        # Use domain as tool name
        tool_name = f"webmcp/{provider}"

        # Check if already exists
        existing = await session.execute(
            select(Tool).where(Tool.name == tool_name)
        )
        tool = existing.scalar_one_or_none()

        if tool is not None:
            logger.info("Tool %s already exists, updating", tool_name)
            tool.page_url = url
            tool.status = "active"
        else:
            tool = Tool(
                name=tool_name,
                provider=provider,
                transport="webmcp",
                base_url=url,
                page_url=url,
                auth_type="session",  # WebMCP uses browser session auth
                tags=["webmcp"],
                status="active",
            )
            session.add(tool)
            await session.flush()

        # Add actions from discovered tools
        for t in tools_data:
            tool_action_name = t["name"]
            tool_desc = t.get("description", "")
            input_schema = t.get("input_schema")

            # Check if action already exists
            existing_action = await session.execute(
                select(Action).where(
                    Action.tool_id == tool.id,
                    Action.name == tool_action_name,
                )
            )
            if existing_action.scalar_one_or_none():
                continue

            embed_text = f"{title} {tool_action_name}: {tool_desc}"
            emb = await get_embedding(embed_text)

            action = Action(
                tool_id=tool.id,
                name=tool_action_name,
                description=tool_desc[:2000] if tool_desc else "",
                operation_type="mixed",  # WebMCP tools can read and write
                input_schema=input_schema,
                embedding=emb,
            )
            session.add(action)

        if own_session:
            await session.commit()
        else:
            await session.flush()

        logger.info(
            "Ingested %s: %d tools from %s",
            tool_name,
            len(tools_data),
            url,
        )
        return tool

    except Exception:
        logger.exception("Failed to ingest WebMCP tools from %s", scan_result.get("url"))
        if own_session:
            await session.rollback()
        return None
    finally:
        if own_session:
            await session.close()


async def register_webmcp_manual(
    session,
    url: str,
    provider: str,
    tools: list[dict],
) -> Tool | None:
    """Manually register WebMCP tools (e.g., from API submission).

    tools format: [{"name": "add-todo", "description": "...", "input_schema": {...}}, ...]
    """
    scan_result = {
        "url": url,
        "title": provider,
        "provider": provider,
        "has_signals": True,
        "tools": tools,
        "tools_count": len(tools),
    }
    return await ingest_webmcp_tools(scan_result, session=session)


async def crawl_urls(urls: list[str]):
    """Crawl multiple URLs for WebMCP tools."""
    start = time.time()

    async with httpx.AsyncClient(
        timeout=30.0,
        headers={"User-Agent": "AgentNet-WebMCP-Crawler/0.1"},
        follow_redirects=True,
    ) as client:
        results = []
        for url in urls:
            result = await scan_url(client, url)
            if result:
                results.append(result)
                await ingest_webmcp_tools(result)
            await asyncio.sleep(0.5)  # polite delay

    elapsed = time.time() - start
    logger.info(
        "WebMCP crawl done: %d/%d pages had WebMCP tools (%.1fs)",
        len(results),
        len(urls),
        elapsed,
    )
    return results


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m app.crawlers.webmcp <url> [url2 ...]")
        print("       python -m app.crawlers.webmcp --file urls.txt")
        sys.exit(1)

    if sys.argv[1] == "--file":
        with open(sys.argv[2]) as f:
            urls = [line.strip() for line in f if line.strip()]
    else:
        urls = sys.argv[1:]

    asyncio.run(crawl_urls(urls))
