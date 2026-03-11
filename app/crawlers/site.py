"""General-purpose site crawler for AgentNet.

When a domain is registered, this crawler probes it for agent capabilities:
  1. /.well-known/agentnet.txt     — ownership verification
  2. /.well-known/agent.json       — WWA protocol manifest
  3. /openapi.json, /swagger.json  — REST API specs
  4. /mcp                          — MCP-over-HTTP endpoint
  5. HTML meta tags / JSON-LD      — structured capability hints
  6. Sitemap → linked API doc pages

Usage:
    uv run python -m app.crawlers.site https://example.com
"""

import asyncio
import json
import logging
import re
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session, engine
from app.models.registered_site import RegisteredSite
from app.models.tool import Action, Base, Tool
from app.services.embeddings import get_embedding

log = logging.getLogger(__name__)

HEADERS = {"User-Agent": "AgentNet-Crawler/1.0 (+https://agentnet.ai/bot)"}
TIMEOUT = httpx.Timeout(15.0)


# ── Probes ────────────────────────────────────────────────────────────────────

async def _get(client: httpx.AsyncClient, url: str) -> httpx.Response | None:
    try:
        r = await client.get(url, headers=HEADERS, timeout=TIMEOUT, follow_redirects=True)
        if r.status_code < 400:
            return r
    except Exception:
        pass
    return None


async def probe_verification(client: httpx.AsyncClient, base_url: str, token: str) -> bool:
    """Check /.well-known/agentnet.txt for the verification token."""
    r = await _get(client, urljoin(base_url, "/.well-known/agentnet.txt"))
    if r and token in r.text:
        return True
    return False


async def probe_agent_manifest(client: httpx.AsyncClient, base_url: str) -> dict | None:
    """Probe /.well-known/agent.json (WWA protocol manifest)."""
    r = await _get(client, urljoin(base_url, "/.well-known/agent.json"))
    if not r:
        return None
    try:
        return r.json()
    except Exception:
        return None


async def probe_openapi(client: httpx.AsyncClient, base_url: str) -> dict | None:
    """Try common OpenAPI spec paths."""
    paths = ["/openapi.json", "/swagger.json", "/api-docs", "/api/openapi.json", "/docs/openapi.json"]
    for path in paths:
        r = await _get(client, urljoin(base_url, path))
        if r:
            try:
                data = r.json()
                if "paths" in data or "openapi" in data or "swagger" in data:
                    return data
            except Exception:
                continue
    return None


async def probe_mcp(client: httpx.AsyncClient, base_url: str) -> dict | None:
    """Try MCP-over-HTTP endpoint."""
    for path in ["/mcp", "/mcp/tools", "/.mcp/tools"]:
        r = await _get(client, urljoin(base_url, path))
        if r:
            try:
                data = r.json()
                if "tools" in data or "capabilities" in data:
                    return data
            except Exception:
                continue
    return None


async def probe_html_meta(client: httpx.AsyncClient, base_url: str) -> dict:
    """Extract agent hints from homepage HTML (meta tags, JSON-LD, title)."""
    r = await _get(client, base_url)
    if not r:
        return {}

    html = r.text
    result: dict = {}

    # Title
    m = re.search(r"<title>([^<]+)</title>", html, re.IGNORECASE)
    if m:
        result["title"] = m.group(1).strip()

    # Meta description
    m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
    if m:
        result["description"] = m.group(1).strip()

    # JSON-LD
    json_lds = re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>', html, re.IGNORECASE)
    for raw in json_lds:
        try:
            data = json.loads(raw.strip())
            if isinstance(data, dict):
                result.setdefault("json_ld", []).append(data)
        except Exception:
            pass

    return result


# ── Normalizers ───────────────────────────────────────────────────────────────

def actions_from_openapi(spec: dict) -> list[dict]:
    """Extract actions from an OpenAPI spec."""
    actions = []
    paths = spec.get("paths", {})
    for path, methods in paths.items():
        for method, op in methods.items():
            if method.upper() not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                continue
            summary = op.get("summary") or op.get("description") or f"{method.upper()} {path}"
            op_type = "read" if method.upper() == "GET" else "write"
            action_name = op.get("operationId") or f"{method}_{path.strip('/').replace('/', '_')}"
            actions.append({
                "name": action_name[:100],
                "description": summary[:500],
                "operation_type": op_type,
                "input_schema": op.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema"),
            })
    return actions[:50]  # cap at 50 actions per site


def actions_from_mcp(data: dict) -> list[dict]:
    """Extract actions from MCP tools response."""
    actions = []
    for tool in data.get("tools", []):
        actions.append({
            "name": tool.get("name", "unknown")[:100],
            "description": tool.get("description", "")[:500],
            "operation_type": "mixed",
            "input_schema": tool.get("inputSchema"),
        })
    return actions[:50]


def actions_from_agent_manifest(manifest: dict) -> list[dict]:
    """Extract actions from WWA agent.json manifest."""
    actions = []
    for action in manifest.get("actions", []):
        actions.append({
            "name": action.get("name", "unknown")[:100],
            "description": action.get("description", "")[:500],
            "operation_type": action.get("method", "read").lower() in ("get",) and "read" or "write",
            "input_schema": action.get("parameters"),
        })
    return actions[:50]


# ── Ingest ────────────────────────────────────────────────────────────────────

async def ingest_site(
    db: AsyncSession,
    domain: str,
    base_url: str,
    tool_name: str,
    provider: str,
    transport: str,
    tags: list[str],
    actions: list[dict],
    meta: dict,
) -> Tool:
    """Upsert a Tool + Actions from crawl results."""
    existing = await db.execute(select(Tool).where(Tool.name == tool_name))
    tool = existing.scalar_one_or_none()

    description_hint = meta.get("description", "")

    if tool is None:
        tool = Tool(
            name=tool_name,
            provider=provider,
            transport=transport,
            base_url=base_url,
            page_url=base_url,
            auth_type="none",
            tags=tags,
            status="active",
        )
        db.add(tool)
        await db.flush()
    else:
        tool.status = "active"
        tool.tags = list(set(tool.tags + tags))
        await db.flush()

    # Upsert actions
    existing_actions = await db.execute(select(Action).where(Action.tool_id == tool.id))
    existing_names = {a.name for a in existing_actions.scalars()}

    new_count = 0
    for a in actions:
        if a["name"] in existing_names:
            continue
        embed_text = f"{provider} {a['name']}: {a['description']} {description_hint}"
        emb = await get_embedding(embed_text)
        db.add(Action(
            tool_id=tool.id,
            name=a["name"],
            description=a["description"],
            operation_type=a.get("operation_type", "read"),
            input_schema=a.get("input_schema"),
            embedding=emb,
        ))
        new_count += 1

    await db.flush()
    log.info("Ingested %s: %d new actions", tool_name, new_count)
    return tool


# ── Main crawl entry point ────────────────────────────────────────────────────

async def crawl_site(db: AsyncSession, site: RegisteredSite) -> tuple[Tool | None, int]:
    """
    Full crawl of a registered site. Returns (tool, actions_count) or (None, 0).
    Probes in priority order: MCP → OpenAPI → WWA manifest → HTML meta.
    """
    parsed = urlparse(site.submitted_url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"
    domain = site.domain
    provider = domain.replace("www.", "")

    async with httpx.AsyncClient(follow_redirects=True) as client:
        # 1. Verify ownership (non-blocking — crawl regardless for MVP)
        verified = await probe_verification(client, base_url, site.verification_token)
        if verified and not site.verified:
            site.verified = True

        # 2. Probe for capabilities in priority order
        actions: list[dict] = []
        transport = "rest"
        tags = ["web"]

        mcp_data = await probe_mcp(client, base_url)
        if mcp_data:
            actions = actions_from_mcp(mcp_data)
            transport = "mcp"
            tags = ["mcp", "web"]
            log.info("%s: found MCP endpoint (%d tools)", domain, len(actions))

        if not actions:
            openapi = await probe_openapi(client, base_url)
            if openapi:
                actions = actions_from_openapi(openapi)
                transport = "rest"
                tags = ["rest", "web", "api"]
                log.info("%s: found OpenAPI spec (%d endpoints)", domain, len(actions))

        if not actions:
            manifest = await probe_agent_manifest(client, base_url)
            if manifest:
                actions = actions_from_agent_manifest(manifest)
                transport = "webmcp"
                tags = ["wwa", "web"]
                log.info("%s: found WWA agent.json (%d actions)", domain, len(actions))

        # 3. Always grab HTML meta for richer embeddings
        meta = await probe_html_meta(client, base_url)

        # 4. If nothing found, create a minimal stub so the site is indexed
        if not actions:
            title = meta.get("title", provider)
            desc = meta.get("description", f"Website at {domain}")
            actions = [{"name": "visit_site", "description": desc, "operation_type": "read"}]
            transport = "webmcp"
            tags = ["web"]
            log.info("%s: no API found, creating stub", domain)

    tool_name = f"site/{domain}"
    tool = await ingest_site(
        db=db,
        domain=domain,
        base_url=base_url,
        tool_name=tool_name,
        provider=provider,
        transport=transport,
        tags=tags,
        actions=actions,
        meta=meta,
    )
    return tool, len(actions)


# ── CLI ───────────────────────────────────────────────────────────────────────

async def _cli(url: str):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        from app.models.registered_site import RegisteredSite
        site = RegisteredSite(
            domain=urlparse(url).netloc,
            submitted_url=url,
            verification_token="cli_test",
        )
        tool, count = await crawl_site(db, site)
        if tool:
            print(f"✓ Crawled {url}: tool={tool.name}, actions={count}")
        else:
            print(f"✗ Crawl failed for {url}")
        await db.commit()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m app.crawlers.site <url>")
        sys.exit(1)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    asyncio.run(_cli(sys.argv[1]))
