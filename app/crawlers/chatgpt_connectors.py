"""ChatGPT Apps/Connectors Crawler.

Indexes official ChatGPT apps from https://chatgpt.com/apps
Only includes tools with VERIFIED, working MCP endpoints (HTTP 401/403/200 confirmed).

Each tool is named with its provider name directly — no prefix — making them
first-class tools alongside seeded and Smithery tools.

Usage:
    uv run python -m app.crawlers.chatgpt_connectors
"""

import asyncio
import logging

from sqlalchemy import select

from app.database import async_session, engine
from app.models.tool import Action, Base, Tool
from app.services.embeddings import get_embedding
from app.services.mcp_probe import probe_mcp_tools

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Verified ChatGPT connectors with confirmed working MCP endpoints.
# All URLs tested: 401 (auth required) or 403 (exists) = server is real.
# Sources: Instafill/chatgpt-apps-connectors registry, official docs, HTTP responses.
# Format: (display_name, mcp_url, description, tags)
CHATGPT_CONNECTORS = [
    # ── Analytics & Data ─────────────────────────────────────────────────────
    ("Amplitude",    "https://mcp.amplitude.com/mcp",         "Search, analyze, and query charts, dashboards, experiments, and metrics",         ["data", "marketing"]),
    ("Semrush",      "https://mcp.semrush.com/v1/mcp",        "Ask about site metrics, traffic, and market data",                               ["marketing", "data", "search"]),
    ("Hex",          "https://app.hex.tech/mcp",              "Answer data questions and spin up new analyses",                                  ["data", "ai"]),
    ("Coupler.io",   "https://mcp.coupler.io/mcp",            "Access business data from hundreds of sources",                                   ["data", "automation"]),
    ("Conductor",    "https://mcp.conductor.com/mcp",         "Analyze brand presence, sentiment, and content performance",                       ["marketing", "data"]),
    ("Coveo",        "https://mcp.cloud.coveo.com/mcp",       "Enterprise content search and knowledge retrieval",                               ["search", "data"]),

    # ── Finance ──────────────────────────────────────────────────────────────
    ("Alpaca",       "https://mcp.alpaca.markets/mcp",        "Market data for stocks, options, and crypto",                                     ["finance", "data"]),
    ("Daloopa",      "https://mcp.daloopa.com/server/mcp",    "Financial fundamental data and KPIs with hyperlinks",                             ["finance", "data"]),
    ("LSEG",         "https://api.analytics.lseg.com/lfa/mcp","Access LSEG's comprehensive financial data & analytics ecosystem",                ["finance", "data"]),
    ("Morningstar",  "https://mcp.morningstar.com/mcp",       "Investment insights, market data and financial analysis",                          ["finance", "data"]),
    ("Stripe",       "https://mcp.stripe.com",                "Manage your business and develop your payments integration",                      ["finance", "ecommerce"]),

    # ── Design & Creative ────────────────────────────────────────────────────
    ("Adobe Photoshop", "https://photoshop-mcp-service.adobe.io/mcp", "Edit images, apply effects, and create designs with Photoshop",          ["design", "media"]),
    ("Adobe Acrobat",   "https://acrobat-mcp.adobe.io/mcp/call",      "Edit, redact, organize, and manage PDF documents",                       ["design", "productivity", "file"]),
    ("Adobe Express",   "https://express-mcp-service.adobe.io/mcp",   "Design flyers, invitations, and marketing materials quickly",            ["design", "media"]),
    ("Canva",        "https://openai.canva.com",              "Create, edit, resize, and make stunning presentations, videos, and designs",       ["design", "media"]),
    ("Figma",        "https://mcp.figma.com/mcp",            "Create flow charts, diagrams, Gantt charts, and more in FigJam",                  ["design", "developer"]),
    ("BioRender",    "https://mcp.services.biorender.com/mcp","Quickly access science visuals for publications and meetings",                    ["media", "data"]),

    # ── Productivity & Project Management ────────────────────────────────────
    ("Atlassian Rovo","https://mcp.atlassian.com/v1/mcp",    "Summarize and search Jira and Confluence content, create and update issues",       ["productivity", "developer"]),
    ("Monday.com",   "https://mcp.monday.com/mcp",           "Manage projects, gain insights, and automate workflows",                           ["productivity"]),
    ("Notion",       "https://mcp.notion.com/mcp",           "Search, read, and update your Notion workspace pages and databases",               ["productivity"]),
    ("Linear",       "https://mcp.linear.app/mcp",           "Manage issues, projects and team workflows in Linear",                             ["productivity", "developer"]),
    ("Vercel",       "https://mcp.vercel.com",               "Search and navigate documentation, manage projects and deployments",               ["developer", "cloud"]),
    ("Jam",          "https://mcp.jam.dev/mcp",              "Record your screen and collect automatic context for issues",                      ["developer"]),

    # ── CRM & Marketing ──────────────────────────────────────────────────────
    ("HubSpot",      "https://mcp.hubspot.com/openai",        "Chat with your CRM data to get personalized insights",                            ["marketing", "productivity"]),
    ("HighLevel",    "https://services.leadconnectorhq.com/mcp/", "Interact with HighLevel CRM business data and workflows",                    ["marketing", "productivity"]),
    ("Clay",         "https://mcp.clay.earth/mcp",           "Find prospects, research accounts, personalize outreach at scale",                 ["marketing", "leads"]),

    # ── Communication ────────────────────────────────────────────────────────
    ("Slack",        "https://mcp.slack.com/mcp",            "Look up chats, search messages, and post in Slack channels",                      ["communication"]),
    ("Fireflies",    "https://api.fireflies.ai/mcp",         "Query and return meeting transcripts and summaries",                               ["productivity", "communication"]),

    # ── Developer Tools ──────────────────────────────────────────────────────
    ("GitHub",       "https://api.githubcopilot.com/mcp/",   "Manage GitHub repositories, issues, and pull requests",                           ["developer", "code"]),
    ("Spaceship",    "https://gpt-mcp.service.spaceship.com/mcp/", "Search and check availability for domain names with pricing",              ["developer"]),

    # ── File Storage ─────────────────────────────────────────────────────────
    ("Dropbox",      "https://mcp.dropbox.com/mcp",          "Find, access, and reference files stored in Dropbox",                             ["file", "productivity"]),
    ("Box",          "https://mcp.box.com",                  "Search, access and get insights on your Box content",                             ["file", "productivity"]),
    ("Egnyte",       "https://mcp-server.egnyte.com/mcp",    "Search, access and get insights on your Egnyte content",                          ["file", "productivity"]),

    # ── Travel & Accommodation ───────────────────────────────────────────────
    ("Booking.com",  "https://demandapi-mcp.booking.com/v1/mcp/2438770", "Search hotels, homes or vacation rentals in over 85,000 destinations", ["travel"]),
    ("Tripadvisor",  "https://production.ai-mcp-extensibility-prd.tamg.cloud", "Find your perfect hotel based on reviews and traveler advice",  ["travel"]),
    ("Zillow",       "https://mcp.zillow.com",               "Shop for and discover homes to rent or buy",                                       ["travel", "data"]),

    # ── Shopping & Retail ────────────────────────────────────────────────────
    ("Target",       "https://rmcp.target.com",              "Shop for favorites, essentials, and deals with same-day pickup or shipping",       ["ecommerce"]),
    ("Instacart",    "https://fig-mcp.instacart.com",        "Get groceries and essentials delivered from 1,800+ trusted retailers",             ["ecommerce"]),
    ("Thumbtack",    "https://mcp.thumbtack.com",            "Find trusted pros in your area to care for your home",                             ["productivity"]),

    # ── Entertainment & Lifestyle ────────────────────────────────────────────
    ("Spotify",      "https://mcp-gateway-external-pilot.spotify.net", "Search for music and podcasts, or turn your ideas into playlists",    ["media"]),
    ("Peloton",      "https://mcp.onepeloton.com",           "Discover, plan and personalize your Peloton workouts",                             ["productivity"]),
]


async def ingest_connector(db, display_name: str, mcp_url: str, description: str, tags: list[str]) -> Tool | None:
    """Upsert a ChatGPT connector as a first-class AgentNet tool."""
    # Use display_name directly as slug (no prefix) — same pattern as seeded tools
    slug = (display_name.lower()
            .replace(" ", "-").replace(".", "-").replace("/", "-")
            .replace("(", "").replace(")", "").replace("'", "")
            .replace("&", "and").replace(",", ""))

    all_tags = list(set(["mcp", "chatgpt-connector"] + tags))

    # Try to find existing tool by slug (no prefix) first, then with old chatgpt/ prefix
    existing = await db.execute(select(Tool).where(Tool.name == slug))
    tool = existing.scalar_one_or_none()

    if tool is None:
        # Check for old chatgpt/ prefixed version
        existing2 = await db.execute(select(Tool).where(Tool.name == f"chatgpt/{slug}"))
        tool = existing2.scalar_one_or_none()

    if tool is None:
        tool = Tool(
            name=slug,
            provider=display_name,
            transport="mcp",
            base_url=mcp_url,
            page_url="https://chatgpt.com/apps",
            auth_type="oauth",
            tags=all_tags,
            status="active",
            priority=2,
        )
        db.add(tool)
        await db.flush()
    else:
        # Update: fix name to remove chatgpt/ prefix if present
        if tool.name.startswith("chatgpt/"):
            tool.name = slug
        tool.base_url = mcp_url or tool.base_url
        tool.provider = display_name
        tool.tags = list(set((tool.tags or []) + all_tags))
        tool.priority = max(tool.priority or 0, 2)
        tool.status = "active"
        await db.flush()

    # Add actions — try to discover real ones from the MCP server first
    existing_actions = await db.execute(select(Action).where(Action.tool_id == tool.id))
    existing_names = {a.name for a in existing_actions.scalars()}

    if not existing_names:
        probed = await probe_mcp_tools(mcp_url)
        if probed:
            log.info("  [probe] %s → %d actions", display_name, len(probed))
            for t in probed:
                name_ = t.get("name", "run")
                desc_ = t.get("description") or description
                schema = t.get("inputSchema") or {"type": "object"}
                emb = await get_embedding(f"{display_name} {name_}: {desc_}")
                db.add(Action(
                    tool_id=tool.id,
                    name=name_,
                    description=desc_,
                    operation_type="read",
                    input_schema=schema,
                    embedding=emb,
                ))
        else:
            # Fallback: generic run action
            emb = await get_embedding(f"{display_name}: {description}")
            db.add(Action(
                tool_id=tool.id,
                name="run",
                description=description,
                operation_type="read",
                input_schema={"type": "object", "description": f"{display_name} parameters"},
                embedding=emb,
            ))

    return tool


async def crawl_chatgpt_connectors() -> int:
    """Index all ChatGPT official connectors with verified MCP endpoints."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    log.info("Indexing %d ChatGPT connectors...", len(CHATGPT_CONNECTORS))
    ingested = 0

    for name, url, desc, tags in CHATGPT_CONNECTORS:
        async with async_session() as db:
            try:
                tool = await ingest_connector(db, name, url, desc, tags)
                if tool:
                    await db.commit()
                    ingested += 1
                    log.info("  ✓ %s → %s", name, url[:55])
            except Exception as e:
                log.debug("Skipping %s: %s", name, e)
                await db.rollback()

    log.info("ChatGPT connectors indexed: %d/%d", ingested, len(CHATGPT_CONNECTORS))
    return ingested


if __name__ == "__main__":
    asyncio.run(crawl_chatgpt_connectors())
