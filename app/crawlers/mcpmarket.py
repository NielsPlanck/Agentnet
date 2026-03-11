"""MCP Market / Glama MCP Directory Crawler.

Fetches MCP servers from the Glama.ai MCP directory (https://glama.ai/mcp/servers),
which aggregates 1000+ community MCP servers and is accessible via their public API.

This crawler is triggered from the admin panel at POST /admin/mcpmarket/crawl.

Usage:
    uv run python -m app.crawlers.mcpmarket
    uv run python -m app.crawlers.mcpmarket --limit 500
"""

import asyncio
import logging
import sys
from typing import Any

import httpx
from sqlalchemy import select

from app.database import async_session, engine
from app.models.tool import Action, Base, Tool
from app.services.embeddings import get_embedding

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

GLAMA_API = "https://glama.ai/api/mcp/v1/servers"
PAGE_SIZE = 100


async def fetch_servers_page(client: httpx.AsyncClient, after: str | None = None) -> dict:
    """Fetch one page of MCP servers from Glama API."""
    params: dict[str, Any] = {"first": PAGE_SIZE}
    if after:
        params["after"] = after
    r = await client.get(GLAMA_API, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


async def fetch_all_servers(client: httpx.AsyncClient, limit: int = 1000) -> list[dict]:
    """Fetch all MCP servers from Glama directory via pagination."""
    servers = []
    cursor = None

    while len(servers) < limit:
        data = await fetch_servers_page(client, after=cursor)
        page_servers = data.get("servers", [])
        servers.extend(page_servers)
        log.info("Fetched %d servers so far (page size: %d)", len(servers), len(page_servers))

        page_info = data.get("pageInfo", {})
        if not page_info.get("hasNextPage") or not page_servers:
            break
        cursor = page_info.get("endCursor")
        await asyncio.sleep(0.5)  # Polite delay between pages

    return servers[:limit]


def _infer_tags(server: dict) -> list[str]:
    """Infer tags from server description and attributes."""
    tags = ["mcp"]
    attributes = server.get("attributes", [])
    for attr in attributes:
        if "remote" in attr:
            tags.append("remote")
        elif "local" in attr:
            tags.append("local")

    desc_lower = (server.get("description") or "").lower()
    name_lower = (server.get("name") or "").lower()
    combined = f"{name_lower} {desc_lower}"

    tag_keywords = {
        "ai": ["ai", "llm", "model", "gpt", "claude", "embedding"],
        "database": ["database", "sql", "postgres", "mysql", "mongo", "redis", "sqlite"],
        "scraping": ["scrape", "scraping", "crawl", "web", "browser", "puppeteer"],
        "search": ["search", "query", "find", "lookup", "discovery"],
        "social": ["twitter", "x.com", "slack", "discord", "telegram", "instagram", "linkedin"],
        "automation": ["automate", "automation", "workflow", "schedule", "cron"],
        "ecommerce": ["shopify", "stripe", "payment", "checkout", "order", "cart"],
        "finance": ["finance", "stock", "crypto", "trading", "wallet", "blockchain"],
        "news": ["news", "article", "rss", "feed"],
        "productivity": ["notion", "jira", "github", "gitlab", "linear", "asana"],
        "email": ["email", "gmail", "outlook", "mailgun", "sendgrid"],
        "cloud": ["aws", "azure", "gcp", "cloud", "s3", "lambda"],
        "developer": ["git", "code", "debug", "testing", "ci/cd", "api"],
    }
    for tag, keywords in tag_keywords.items():
        if any(kw in combined for kw in keywords) and tag not in tags:
            tags.append(tag)

    return tags


async def ingest_server(db, server: dict) -> Tool | None:
    """Upsert a single MCP server as a Tool."""
    name = server.get("name") or server.get("slug", "")
    description = (server.get("description") or "")[:500]
    slug = server.get("slug", "")
    namespace = server.get("namespace", "")
    repo_url = (server.get("repository") or {}).get("url", "")
    glama_url = server.get("url", f"https://glama.ai/mcp/servers/{server.get('id', '')}")

    if not name or not slug:
        return None

    tool_name = f"mcp/{namespace}/{slug}" if namespace else f"mcp/{slug}"

    # Use repo URL as base_url for MCP connectivity (best we can infer without live MCP endpoint)
    base_url = repo_url or glama_url
    page_url = glama_url

    existing = await db.execute(select(Tool).where(Tool.name == tool_name))
    tool = existing.scalar_one_or_none()

    tags = _infer_tags(server)

    if tool is None:
        tool = Tool(
            name=tool_name,
            provider=f"MCP Market — {namespace or name}",
            transport="mcp",
            base_url=base_url,
            page_url=page_url,
            auth_type="api_key",
            tags=tags,
            status="active",
        )
        db.add(tool)
        await db.flush()
    else:
        tool.tags = list(set((tool.tags or []) + tags))
        tool.status = "active"
        await db.flush()

    # Check existing actions
    existing_actions = await db.execute(select(Action).where(Action.tool_id == tool.id))
    existing_names = {a.name for a in existing_actions.scalars()}

    if "run" not in existing_names:
        embed_text = f"{name}: {description}"
        emb = await get_embedding(embed_text)
        db.add(Action(
            tool_id=tool.id,
            name="run",
            description=description or f"Run {name} MCP server",
            operation_type="read",
            input_schema={"type": "object", "description": "MCP server input parameters"},
            embedding=emb,
        ))

    return tool


async def crawl_mcpmarket(limit: int = 500) -> int:
    """Main entry point: crawl Glama MCP directory and index all servers."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with httpx.AsyncClient(
        headers={"User-Agent": "AgentNet-Crawler/1.0", "Accept": "application/json"},
        follow_redirects=True,
    ) as client:
        servers = await fetch_all_servers(client, limit=limit)
        log.info("Total servers to index: %d", len(servers))

        ingested = 0
        async with async_session() as db:
            for i, server in enumerate(servers):
                try:
                    tool = await ingest_server(db, server)
                    if tool:
                        ingested += 1

                    if i % 20 == 19:
                        await db.flush()
                        await asyncio.sleep(0.2)
                        log.info("Progress: %d/%d servers ingested", ingested, len(servers))

                except Exception:
                    log.exception("Failed to ingest server %s", server.get("name", "?"))

            await db.commit()

    log.info("MCP Market crawl complete: %d servers indexed", ingested)
    return ingested


if __name__ == "__main__":
    limit = 500
    for arg in sys.argv[1:]:
        if arg.startswith("--limit="):
            limit = int(arg.split("=")[1])
        elif arg == "--limit" and len(sys.argv) > sys.argv.index(arg) + 1:
            limit = int(sys.argv[sys.argv.index(arg) + 1])
    asyncio.run(crawl_mcpmarket(limit=limit))
