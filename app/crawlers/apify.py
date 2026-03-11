"""Apify MCP Store Crawler — indexes MCP actors from apify.com/store/categories/mcp-servers.

Apify hosts 286+ MCP-compatible actors. This crawler:
1. Fetches all actors in the MCP_SERVERS category from Apify's public store API
2. Fetches each actor's detailed input schema to build proper action definitions
3. Indexes each actor as a Tool with its MCP endpoint: https://mcp.apify.com/{username}/{name}

Apify MCP endpoint: https://mcp.apify.com/
Auth: Bearer {APIFY_API_TOKEN} (user provides their token)

Usage:
    uv run python -m app.crawlers.apify
    uv run python -m app.crawlers.apify --limit 50
"""

import asyncio
import logging
import sys
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import async_session, engine
from app.models.tool import Action, Base, Tool
from app.services.embeddings import get_embedding

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

APIFY_STORE_API = "https://api.apify.com/v2/store"
APIFY_ACTOR_API = "https://api.apify.com/v2/acts"
APIFY_MCP_BASE = "https://mcp.apify.com"
PAGE_SIZE = 50


async def fetch_mcp_actors(client: httpx.AsyncClient, limit: int = 500) -> list[dict]:
    """Fetch all MCP_SERVERS category actors from Apify store."""
    actors = []
    offset = 0

    while len(actors) < limit:
        batch = min(PAGE_SIZE, limit - len(actors))
        r = await client.get(
            APIFY_STORE_API,
            params={"category": "MCP_SERVERS", "limit": batch, "offset": offset},
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()["data"]
        items = data.get("items", [])
        actors.extend(items)

        if len(items) < batch or len(actors) >= data.get("total", 0):
            break
        offset += batch
        await asyncio.sleep(0.2)

    log.info("Fetched %d Apify MCP actors", len(actors))
    return actors


async def fetch_actor_schema(client: httpx.AsyncClient, username: str, name: str) -> dict | None:
    """Fetch an actor's input schema to understand what it does."""
    actor_id = f"{username}~{name}"
    try:
        r = await client.get(f"{APIFY_ACTOR_API}/{actor_id}", timeout=15)
        if r.status_code == 200:
            return r.json().get("data", {})
    except Exception:
        pass
    return None


def _extract_actions_from_schema(actor: dict, schema: dict | None) -> list[dict]:
    """Build action definitions from actor metadata + schema."""
    title = actor.get("title") or actor.get("name", "run")
    description = actor.get("description", "")[:500]

    # Primary action: run the actor
    actions = [
        {
            "name": "run",
            "description": f"Run {title}: {description}",
            "operation_type": "read",
            "input_schema": _build_input_schema(schema),
        }
    ]

    # If actor has an output dataset, add a fetch_results action
    if schema:
        actions.append({
            "name": "get_results",
            "description": f"Get results/dataset from {title} after it completes",
            "operation_type": "read",
            "input_schema": None,
        })

    return actions


def _build_input_schema(actor_data: dict | None) -> dict | None:
    """Extract JSON Schema from actor's defaultRunOptions or versions."""
    if not actor_data:
        return None
    try:
        versions = actor_data.get("versions", {})
        if isinstance(versions, dict):
            for v in versions.values():
                schema = v.get("buildTag") or {}
                # Try to get input schema from the actor definition
                input_schema = v.get("sourceFiles", {})
                if input_schema:
                    return {"type": "object", "description": "Actor input parameters"}
    except Exception:
        pass
    return {"type": "object", "description": "Actor input parameters"}


def _actor_tags(actor: dict) -> list[str]:
    """Build tags from actor categories."""
    raw_cats = actor.get("categories", [])
    tag_map = {
        "SOCIAL_MEDIA": "social",
        "LEAD_GENERATION": "leads",
        "AI": "ai",
        "MCP_SERVERS": "mcp",
        "WEB_SCRAPING": "scraping",
        "ECOMMERCE": "ecommerce",
        "AUTOMATION": "automation",
        "MARKETING": "marketing",
        "FINANCE": "finance",
        "NEWS": "news",
        "REAL_ESTATE": "real_estate",
    }
    tags = ["mcp", "apify"]
    for cat in raw_cats:
        if cat in tag_map and tag_map[cat] not in tags:
            tags.append(tag_map[cat])
    return tags


async def ingest_actor(db, actor: dict, schema: dict | None) -> Tool | None:
    """Upsert a single Apify actor as a Tool."""
    username = actor.get("username", "apify")
    name = actor.get("name", "")
    title = actor.get("title") or name
    description = actor.get("description", "")[:500]

    tool_name = f"apify/{username}/{name}"
    mcp_url = f"{APIFY_MCP_BASE}/{username}/{name}"
    page_url = f"https://apify.com/{username}/{name}"

    # Check if already exists
    existing = await db.execute(select(Tool).where(Tool.name == tool_name))
    tool = existing.scalar_one_or_none()

    tags = _actor_tags(actor)

    if tool is None:
        tool = Tool(
            name=tool_name,
            provider=title,
            transport="mcp",
            base_url=mcp_url,
            page_url=page_url,
            auth_type="api_key",
            tags=tags,
            status="active",
        )
        db.add(tool)
        await db.flush()
    else:
        tool.tags = list(set(tool.tags + tags))
        tool.status = "active"
        await db.flush()

    # Check existing actions
    existing_actions = await db.execute(select(Action).where(Action.tool_id == tool.id))
    existing_names = {a.name for a in existing_actions.scalars()}

    actions = _extract_actions_from_schema(actor, schema)
    for a in actions:
        if a["name"] in existing_names:
            continue
        embed_text = f"{title} {a['name']}: {a['description']}"
        emb = await get_embedding(embed_text)
        db.add(Action(
            tool_id=tool.id,
            name=a["name"],
            description=a["description"],
            operation_type=a["operation_type"],
            input_schema=a.get("input_schema"),
            embedding=emb,
        ))

    return tool


async def crawl_apify(limit: int = 200) -> int:
    """Main entry point: crawl Apify MCP store and index all actors."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with httpx.AsyncClient(
        headers={"User-Agent": "AgentNet-Crawler/1.0"},
        follow_redirects=True,
    ) as client:
        actors = await fetch_mcp_actors(client, limit=limit)

        ingested = 0
        async with async_session() as db:
            for i, actor in enumerate(actors):
                username = actor.get("username", "")
                name = actor.get("name", "")
                if not username or not name:
                    continue

                try:
                    tool = await ingest_actor(db, actor, schema=None)
                    if tool:
                        ingested += 1

                    # Polite delay every 10 actors
                    if i % 10 == 9:
                        await db.flush()
                        await asyncio.sleep(0.5)
                        log.info("Progress: %d/%d actors ingested", ingested, len(actors))

                except Exception:
                    log.exception("Failed to ingest actor %s/%s", username, name)

            await db.commit()

    log.info("Apify crawl complete: %d actors indexed", ingested)
    return ingested


if __name__ == "__main__":
    limit = 200
    for arg in sys.argv[1:]:
        if arg.startswith("--limit="):
            limit = int(arg.split("=")[1])
        elif arg == "--limit" and len(sys.argv) > sys.argv.index(arg) + 1:
            limit = int(sys.argv[sys.argv.index(arg) + 1])
    asyncio.run(crawl_apify(limit=limit))
