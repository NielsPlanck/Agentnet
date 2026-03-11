"""Smithery.ai MCP Server Registry Crawler.

Smithery hosts 3800+ community MCP servers with real deployment URLs.
This crawler fetches servers that have `isDeployed: true` and indexes them
as directly-connectable tools with their live MCP endpoints.

Tool naming: uses qualifiedName directly (e.g. "brave", "upstash/context7-mcp")
so they appear as first-class tools — no source prefix shown.

Usage:
    uv run python -m app.crawlers.smithery
    uv run python -m app.crawlers.smithery --limit 500 --deployed-only
"""

import asyncio
import logging
import sys
import time

import httpx
from sqlalchemy import select

from app.database import async_session, engine
from app.models.tool import Action, Base, Tool
from app.services.embeddings import get_embedding

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

REGISTRY_URL = "https://registry.smithery.ai/servers"
PAGE_SIZE = 100
DETAIL_CONCURRENCY = 3  # low to avoid SQLite contention
RETRY_ATTEMPTS = 3


async def fetch_server_list(client: httpx.AsyncClient, limit: int = 2000, deployed_only: bool = True) -> list[dict]:
    """Fetch servers from Smithery registry, optionally filtering for deployed only."""
    all_servers = []
    page = 1

    while len(all_servers) < limit:
        try:
            r = await client.get(REGISTRY_URL, params={"pageSize": PAGE_SIZE, "page": page}, timeout=30)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            log.warning("Failed page %d: %s", page, e)
            break

        servers = data.get("servers", [])
        total_pages = data["pagination"]["totalPages"]

        for s in servers:
            if deployed_only and not s.get("isDeployed"):
                continue
            all_servers.append(s)

        if len(all_servers) % 200 < PAGE_SIZE:
            log.info("Page %d/%d — %d deployed servers so far", page, total_pages, len(all_servers))

        if page >= total_pages or len(all_servers) >= limit:
            break
        page += 1
        await asyncio.sleep(0.1)

    log.info("Total servers to index: %d", len(all_servers[:limit]))
    return all_servers[:limit]


async def fetch_server_detail(client: httpx.AsyncClient, qualified_name: str) -> dict | None:
    """Fetch full detail for one server including deploymentUrl and tools list."""
    for attempt in range(RETRY_ATTEMPTS):
        try:
            r = await client.get(f"{REGISTRY_URL}/{qualified_name}", timeout=20)
            if r.status_code == 429:
                await asyncio.sleep(2.0 * (2 ** attempt))
                continue
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
        except Exception as e:
            log.debug("Detail fetch failed for %s (attempt %d): %s", qualified_name, attempt + 1, e)
            await asyncio.sleep(1.0)
    return None


def _infer_tags(server: dict) -> list[str]:
    tags = ["mcp"]
    text = f"{server.get('displayName', '')} {server.get('description', '')}".lower()
    tag_map = {
        "search": ["search", "crawl", "web"],
        "code": ["code", "github", "gitlab", "git", "programming", "developer"],
        "database": ["database", "sql", "postgres", "mysql", "mongo", "redis"],
        "ai": ["ai", "llm", "model", "embedding", "openai", "anthropic"],
        "communication": ["slack", "email", "discord", "chat", "messaging"],
        "productivity": ["notion", "airtable", "docs", "document", "notes", "calendar"],
        "finance": ["finance", "banking", "payment", "stripe", "crypto"],
        "ecommerce": ["shopify", "ecommerce", "checkout", "order", "cart"],
        "cloud": ["aws", "azure", "gcp", "cloud", "s3", "lambda", "docker"],
        "marketing": ["marketing", "seo", "hubspot", "crm", "campaign"],
        "media": ["image", "video", "audio", "youtube", "spotify"],
        "security": ["security", "auth", "vulnerability"],
        "data": ["analytics", "data", "dashboard", "chart", "report"],
    }
    for tag, keywords in tag_map.items():
        if any(kw in text for kw in keywords):
            tags.append(tag)
    return tags


def _op_type(name: str, description: str) -> str:
    text = f"{name} {description}".lower()
    write_words = ["create", "send", "post", "update", "delete", "write", "upload", "push", "set", "add", "remove"]
    if any(w in text for w in write_words):
        return "write"
    return "read"


async def ingest_server(db, detail: dict, list_data: dict) -> Tool | None:
    """Upsert one Smithery server as an AgentNet tool."""
    qname = detail.get("qualifiedName") or list_data.get("qualifiedName", "")
    display_name = detail.get("displayName") or list_data.get("displayName") or qname
    description = (detail.get("description") or list_data.get("description") or "")[:500]
    tools_list = detail.get("tools", [])

    # Get real MCP endpoint URL
    deployment_url = ""
    connections = detail.get("connections", [])
    if connections:
        deployment_url = connections[0].get("deploymentUrl") or ""
    if not deployment_url:
        deployment_url = detail.get("deploymentUrl") or list_data.get("homepage") or ""

    if not qname:
        return None

    # Clean tool name — just qualifiedName (e.g. "brave", "upstash/context7-mcp")
    tool_name = qname
    page_url = list_data.get("homepage") or f"https://smithery.ai/servers/{qname}"

    # Determine auth from config schema
    config_schema = connections[0].get("configSchema") if connections else None
    auth_type = "api_key" if config_schema and config_schema.get("required") else "none"

    # Check/upsert tool
    existing = await db.execute(select(Tool).where(Tool.name == tool_name))
    tool = existing.scalar_one_or_none()

    tags = _infer_tags({**list_data, **detail})
    namespace = list_data.get("namespace", qname.split("/")[0] if "/" in qname else qname)

    if tool is None:
        tool = Tool(
            name=tool_name,
            provider=display_name,
            transport="mcp",
            base_url=deployment_url,
            page_url=page_url,
            auth_type=auth_type,
            tags=tags,
            status="active",
        )
        db.add(tool)
        await db.flush()
    else:
        tool.base_url = deployment_url or tool.base_url
        tool.provider = display_name
        tool.page_url = page_url
        tool.tags = list(set((tool.tags or []) + tags))
        tool.status = "active"
        await db.flush()

    # Upsert actions from tools list
    existing_actions = await db.execute(select(Action).where(Action.tool_id == tool.id))
    existing_names = {a.name for a in existing_actions.scalars()}

    if tools_list:
        for t in tools_list:
            aname = t.get("name", "")
            adesc = (t.get("description") or "")[:500]
            if not aname or aname in existing_names:
                continue
            embed_text = f"{display_name} {aname}: {adesc}"
            emb = await get_embedding(embed_text)
            db.add(Action(
                tool_id=tool.id,
                name=aname,
                description=adesc,
                operation_type=_op_type(aname, adesc),
                input_schema=t.get("inputSchema"),
                embedding=emb,
            ))
    elif "run" not in existing_names:
        # No tools in detail — create a generic action
        embed_text = f"{display_name}: {description}"
        emb = await get_embedding(embed_text)
        db.add(Action(
            tool_id=tool.id,
            name="run",
            description=description or f"Run {display_name}",
            operation_type="read",
            input_schema=config_schema,
            embedding=emb,
        ))

    return tool


async def crawl_smithery(limit: int = 500, deployed_only: bool = True) -> int:
    """Main entry point: crawl Smithery registry and index deployed MCP servers."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with httpx.AsyncClient(
        headers={"User-Agent": "AgentNet-Crawler/1.0"},
        follow_redirects=True,
    ) as client:
        servers = await fetch_server_list(client, limit=limit, deployed_only=deployed_only)

        # Step 1: Fetch all details in parallel (HTTP only, no DB writes)
        sem = asyncio.Semaphore(DETAIL_CONCURRENCY)

        async def fetch_one(list_data: dict) -> tuple[dict, dict]:
            qname = list_data.get("qualifiedName", "")
            async with sem:
                detail = await fetch_server_detail(client, qname)
                await asyncio.sleep(0.1)
            return list_data, detail or {}

        tasks = [fetch_one(s) for s in servers]
        fetched: list[tuple[dict, dict]] = []
        done_fetch = 0
        for coro in asyncio.as_completed(tasks):
            pair = await coro
            fetched.append(pair)
            done_fetch += 1
            if done_fetch % 100 == 0:
                log.info("Fetched details: %d/%d", done_fetch, len(servers))

        log.info("All details fetched. Writing to DB sequentially...")

        # Step 2: Write to DB sequentially (avoid SQLite concurrent write locks)
        ingested = 0
        for i, (list_data, detail) in enumerate(fetched):
            async with async_session() as db:
                try:
                    tool = await ingest_server(db, detail, list_data)
                    if tool:
                        await db.commit()
                        ingested += 1
                    else:
                        await db.rollback()
                except Exception:
                    log.debug("Skipping %s: %s", list_data.get("qualifiedName", "?"), "insert failed")
                    await db.rollback()
            if i % 50 == 49:
                log.info("Progress: %d/%d ingested", ingested, i + 1)

    log.info("Smithery crawl complete: %d servers indexed", ingested)
    return ingested


if __name__ == "__main__":
    limit = 500
    deployed_only = True
    for arg in sys.argv[1:]:
        if arg.startswith("--limit="):
            limit = int(arg.split("=")[1])
        elif arg == "--limit" and len(sys.argv) > sys.argv.index(arg) + 1:
            limit = int(sys.argv[sys.argv.index(arg) + 1])
        elif arg == "--all":
            deployed_only = False
    asyncio.run(crawl_smithery(limit=limit, deployed_only=deployed_only))
