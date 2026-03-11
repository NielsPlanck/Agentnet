"""Auto-discover and create tools when the index has no good match."""

import json
import logging

from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.tool import Action, Tool
from app.schemas.search import SearchResultItem, WorkflowStep
from app.services.embeddings import get_embedding

log = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None

DISCOVERY_PROMPT = """\
You are a tool discovery engine. The user wants to accomplish a task but no \
matching tool exists in our index.

STEP 1 — INTENT DECOMPOSITION:
Before picking tools, decompose the user's intent into layers:
- What is the user's GOAL? (e.g., eat a burger)
- What is the CONTEXT? (e.g., at home, in 20 minutes)
- What CONSTRAINTS does that imply? (e.g., needs delivery, not dine-in)
- What is the FIRST actionable tool layer? (e.g., a delivery app, not a restaurant)

The user needs tools at the RIGHT abstraction level:
- "I want to eat a burger at home" → delivery apps (DoorDash, Uber Eats), NOT restaurants
- "I want to buy an iPhone" → Apple Store, Amazon, Best Buy (purchase platforms)
- "I want to invest in stocks" → brokerage apps (Robinhood, Fidelity), NOT stock exchanges
- "I want to fly to Paris" → flight booking (Google Flights, Kayak), NOT airlines directly
- "contact VCs and send pitch deck" → email (Gmail), VC databases (Crunchbase, AngelList), \
  file sharing (DocSend, Google Drive), CRM (HubSpot). NOT accelerator application forms.
- "post on social media" → social media tools (Twitter/X, LinkedIn, Buffer), NOT individual post editors
- "hire a developer" → job platforms (LinkedIn, Indeed, Upwork), NOT resume builders

Always surface the PLATFORM the user would actually interact with first. \
The platform's actions should include browsing/selecting the underlying service \
(e.g., a delivery app has: search_restaurants → browse_menu → place_order).

For multi-step tasks, return the tools needed for EACH step of the workflow:
- "contact VCs + send pitch deck" needs: 1) find VCs (Crunchbase), 2) email them (Gmail), 3) share deck (DocSend)
- Return each as a separate tool — the user picks which ones to use.

STEP 2 — Return a JSON array (no markdown fences) ranked by relevance (best first).

Schema:
[
  {
    "name": "ServiceName",
    "provider": "Company Name",
    "base_url": "https://api.example.com",
    "page_url": "https://example.com (the website URL, for webmcp tools)",
    "auth_type": "oauth|api_key|none|session",
    "tags": ["category1", "category2"],
    "has_mcp": true or false,
    "has_webmcp": true or false,
    "mcp_url": "https://mcp.example.com (if has_mcp is true, else null)",
    "actions": [
      {"name": "action_name", "description": "What it does", "operation_type": "read|write"}
    ]
  }
]

Rules:
- Return 3-5 different REAL services ranked by how well they fit the request
- The MOST relevant service comes first (e.g., DoorDash first for "eat burger at home")
- Each service is a DIFFERENT company/platform
- actions should be ordered as a WORKFLOW — the steps a user would follow
  (e.g., search_restaurants → browse_menu → add_to_cart → place_order → track_delivery)
- base_url should be a plausible API endpoint
- action names in snake_case
- CRITICAL: has_mcp must be ACCURATE. Many services now have official MCP servers.
  Known services WITH MCP servers include (not exhaustive):
  GitHub, Slack, Notion, Linear, Figma, Sentry, Cloudflare, Supabase, Stripe,
  Brave Search, Google Maps, Google Drive, Puppeteer, Playwright, Docker,
  PostgreSQL, SQLite, MongoDB, Redis, Elasticsearch, Shopify, HubSpot,
  Twilio, Jira, Confluence, GitLab, Vercel, Heroku, DigitalOcean,
  YouTube, Spotify, Discord, Telegram, WhatsApp, Miro, Canva,
  OpenAI, Anthropic, AWS, Azure, GCP, Snowflake, Databricks,
  Airtable, Asana, Trello, Monday.com, Zoom, Calendar (Google), Gmail
  If a service is NOT in this list and you're not sure, set has_mcp to false.
- has_webmcp: true if the service's WEBSITE exposes client-side tools via the \
  WebMCP API (navigator.modelContext.registerTool). WebMCP is a W3C proposal \
  that lets websites expose JS functions as tools for AI agents in the browser. \
  Most services do NOT have WebMCP yet — set to false unless you're confident. \
  If has_webmcp is true, set auth_type to "session" and include page_url.
- Return ONLY the JSON array
"""


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


async def _create_tool(db: AsyncSession, data: dict) -> Tool | None:
    """Create a single tool + actions in the DB, or return existing."""
    tool_name = data.get("name", "Unknown")

    existing = await db.execute(
        select(Tool)
        .where(Tool.name == tool_name)
        .options(selectinload(Tool.actions))
    )
    tool = existing.scalar_one_or_none()

    if tool is not None:
        return tool

    has_mcp = data.get("has_mcp", False)
    has_webmcp = data.get("has_webmcp", False)
    mcp_url = data.get("mcp_url")

    if has_webmcp:
        transport = "webmcp"
        base_url = data.get("page_url", data.get("base_url", ""))
        status = "active"
    elif has_mcp:
        transport = "mcp"
        base_url = mcp_url if mcp_url else data.get("base_url", "")
        status = "active"
    else:
        transport = "rest"
        base_url = data.get("base_url", "")
        status = "no_mcp"

    tool = Tool(
        name=tool_name,
        provider=data.get("provider", "Unknown"),
        transport=transport,
        base_url=base_url,
        page_url=data.get("page_url") if has_webmcp else None,
        auth_type=data.get("auth_type", "none"),
        tags=data.get("tags", []),
        status=status,
    )
    db.add(tool)
    await db.flush()

    for act in data.get("actions", []):
        emb = await get_embedding(
            f"{tool_name} {act['name']}: {act['description']}"
        )
        action = Action(
            tool_id=tool.id,
            name=act["name"],
            description=act["description"],
            operation_type=act.get("operation_type", "read"),
            embedding=emb,
        )
        db.add(action)

    await db.flush()
    await db.refresh(tool, ["actions"])
    return tool


async def discover_and_create(
    db: AsyncSession, query: str
) -> list[SearchResultItem]:
    """Use LLM to infer missing tools, create them in the DB, return results."""
    if not settings.openai_api_key:
        return []

    client = _get_client()

    try:
        response = await client.chat.completions.create(
            model=settings.openai_fast_model,
            messages=[
                {"role": "system", "content": DISCOVERY_PROMPT},
                {"role": "user", "content": query},
            ],
            temperature=0.2,
            max_tokens=1024,
        )
        raw = response.choices[0].message.content or ""
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]
        tools_data = json.loads(raw.strip())
    except Exception:
        log.exception("Discovery LLM call failed")
        return []

    if isinstance(tools_data, dict):
        tools_data = [tools_data]

    items: list[SearchResultItem] = []

    for rank, data in enumerate(tools_data, 1):
        tool = await _create_tool(db, data)
        if tool is None:
            continue

        # Build workflow steps in order
        workflow = [
            WorkflowStep(
                action_id=action.id,
                action_name=action.name,
                description=action.description,
                step_number=step,
            )
            for step, action in enumerate(tool.actions, 1)
        ]

        items.append(
            SearchResultItem(
                tool_name=tool.name,
                tool_id=tool.id,
                transport=tool.transport,
                base_url=tool.base_url,
                description=f"{tool.provider} — {tool.name}",
                similarity=-1.0,  # sentinel: discovered
                status=tool.status,
                rank=rank,
                workflow=workflow,
            )
        )

    await db.commit()
    return items
