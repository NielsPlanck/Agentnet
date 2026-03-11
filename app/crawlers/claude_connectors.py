"""Claude Official Connectors Crawler.

Indexes all official MCP connectors listed at https://claude.com/connectors
These are Anthropic-approved, production-ready integrations.

Sources:
- Direct MCP URLs for official providers (e.g. https://mcp.stripe.com)
- Smithery registry for community-hosted servers
- claude.com/connectors detail pages as fallback

Usage:
    uv run python -m app.crawlers.claude_connectors
"""

import asyncio
import logging
import sys

import httpx
from sqlalchemy import select

from app.database import async_session, engine
from app.models.tool import Action, Base, Tool
from app.services.embeddings import get_embedding
from app.services.mcp_probe import probe_mcp_tools

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

SMITHERY_API = "https://registry.smithery.ai/servers"

# Full list of Claude connectors from https://claude.com/connectors
# Format: (display_name, mcp_url_or_smithery_qname, description, tags)
CLAUDE_CONNECTORS = [
    # ── Official direct MCP endpoints ──────────────────────────────────────
    ("Airtable", "https://mcp.airtable.com", "Bring your structured data to Claude", ["data", "productivity"]),
    ("Atlassian", "https://mcp.atlassian.com/jira", "Access Jira & Confluence from Claude", ["productivity", "developer"]),
    ("Canva", "https://mcp.canva.com", "Search, create, autofill, and export Canva designs", ["design", "media"]),
    ("Figma", "https://mcp.figma.com", "Generate diagrams and better code from Figma context", ["design", "developer"]),
    ("Slack", "https://mcp.slack.com", "Send messages, create canvases, and fetch Slack data", ["communication"]),
    ("Stripe", "https://mcp.stripe.com", "Payment processing and financial infrastructure tools", ["finance", "ecommerce"]),
    ("Shopify", "https://mcp.shopify.com", "Manage your Shopify store", ["ecommerce"]),
    ("HubSpot", "https://mcp.hubspot.com", "Chat with your CRM data to get personalized insights", ["marketing", "productivity"]),
    ("Cloudflare", "https://mcp.cloudflare.com", "Build applications with compute, storage, and AI", ["cloud", "developer"]),
    ("PayPal", "https://mcp.paypal.com", "Access PayPal payments platform", ["finance", "ecommerce"]),
    ("Intercom", "https://mcp.intercom.com", "AI access to Intercom data for better customer insights", ["communication", "marketing"]),
    ("Notion", "https://mcp.notion.com", "Connect your Notion workspace to search and update", ["productivity"]),
    ("Supabase", "https://mcp.supabase.com", "Manage databases, authentication, and storage", ["database", "developer"]),
    ("Vercel", "https://mcp.vercel.com", "Analyze, debug, and manage projects and deployments", ["developer", "cloud"]),
    ("Webflow", "https://mcp.webflow.com", "Design pages, manage CMS content, and automate site tasks", ["developer", "design"]),
    ("Square", "https://mcp.squareup.com", "Search and manage transaction, merchant, and payment data", ["finance", "ecommerce"]),
    ("Zapier", "https://mcp.zapier.com", "Automate workflows across thousands of apps via conversation", ["automation", "productivity"]),
    ("Linear", "https://mcp.linear.app", "Manage issues, projects and team workflows in Linear", ["productivity", "developer"]),
    ("Asana", "https://mcp.asana.com", "Connect to Asana to coordinate tasks, projects, and goals", ["productivity"]),
    ("Amplitude", "https://mcp.amplitude.com", "Give your teams powerful behavioral insights", ["data", "marketing"]),
    ("PagerDuty", "https://mcp.pagerduty.com", "Manage incidents, services and on-call schedules", ["developer", "cloud"]),
    ("Sentry", "https://mcp.sentry.io", "Search, query, and debug errors intelligently", ["developer"]),
    ("PostHog", "https://mcp.posthog.com", "Query, analyze, and manage your PostHog insights", ["data", "developer"]),
    ("Snowflake", "https://mcp.snowflake.com", "Retrieve both structured and unstructured data", ["database", "data"]),
    ("Databricks", "https://mcp.databricks.com", "Managed MCP servers with Unity Catalog and Mosaic AI", ["database", "ai", "data"]),
    ("Sanity", "https://mcp.sanity.io", "Create, query, and manage structured content in Sanity", ["developer", "productivity"]),
    ("Miro", "https://mcp.miro.com", "Access and create new content on Miro boards", ["design", "productivity"]),
    ("Gamma", "https://mcp.gamma.app", "Create presentations, docs, socials, and sites with AI", ["productivity", "ai"]),
    ("Plaid", "https://mcp.plaid.com", "Monitor, debug, and optimize your Plaid integration", ["finance", "developer"]),
    ("Gusto", "https://mcp.gusto.com", "Query and analyze your Gusto data", ["productivity"]),
    ("Box", "https://mcp.box.com", "Search, access and get insights on your Box content", ["productivity", "file"]),
    ("Docusign", "https://mcp.docusign.com", "Intelligent, secure contract management by Docusign", ["productivity", "security"]),
    ("Braze", "https://mcp.braze.com", "Connect to your Braze workspace to analyze trends", ["marketing"]),
    ("ClickUp", "https://mcp.clickup.com", "Project management and collaboration for teams and agents", ["productivity"]),
    ("Wix", "https://mcp.wix.com", "Manage and build sites and apps on Wix", ["developer", "design"]),
    ("Klaviyo", "https://mcp.klaviyo.com", "Report, strategize and create with real-time Klaviyo data", ["marketing", "ecommerce"]),
    ("Monday", "https://mcp.monday.com", "Manage projects, boards, and workflows in monday.com", ["productivity"]),
    ("Bitly", "https://mcp.bitly.com", "Shorten links, generate QR Codes, and track performance", ["marketing"]),
    ("Razorpay", "https://mcp.razorpay.com", "Turn Claude into your Razorpay Dashboard Assistant", ["finance", "ecommerce"]),
    ("Airwallex", "https://mcp.airwallex.com", "Integrate with the Airwallex Platform using Claude", ["finance"]),
    ("Attio", "https://mcp.attio.com", "Search, manage, and update your Attio CRM from Claude", ["productivity", "marketing"]),
    ("Pendo", "https://mcp.pendo.io", "Connect to Pendo for product and user insights", ["data", "marketing"]),
    ("Outreach", "https://mcp.outreach.io", "Unleash your team's best performance with Outreach AI", ["marketing"]),
    ("Glean", "https://mcp.glean.com", "Bring enterprise context to Claude and your AI tools", ["productivity", "search"]),
    ("Guru", "https://mcp.getguru.com", "Search and interact with your company knowledge", ["productivity"]),
    ("Workato", "https://mcp.workato.com", "Automate workflows and connect your business apps", ["automation"]),
    ("Ramp", "https://mcp.ramp.com", "Search, access, and analyze your Ramp financial data", ["finance"]),
    ("MailerLite", "https://mcp.mailerlite.com", "Turn Claude into your email marketing assistant", ["marketing", "email"]),
    ("Clearbit", "https://mcp.clearbit.com", "Enrich contacts and accounts with B2B intelligence", ["marketing", "data"]),
    ("Make", "https://mcp.make.com", "Run Make scenarios and manage your Make account", ["automation"]),
    ("Stytch", "https://mcp.stytch.com", "Manage your Stytch Project", ["developer", "security"]),
    ("Clerk", "https://mcp.clerk.com", "Add authentication, organizations, and billing", ["developer", "security"]),

    # ── Google services ─────────────────────────────────────────────────────
    ("Gmail", "https://mcp.google.com/gmail", "Search your emails, surface insights, and draft replies", ["communication", "email"]),
    ("Google Calendar", "https://mcp.google.com/calendar", "Schedule meetings based on availability, manage invites", ["productivity"]),
    ("Google Drive", "https://mcp.google.com/drive", "Search and read your Docs, Sheets, and Slides in Claude", ["productivity", "file"]),
    ("Google Cloud BigQuery", "https://mcp.google.com/bigquery", "BigQuery advanced analytical insights for agents", ["database", "data", "cloud"]),

    # ── Microsoft services ───────────────────────────────────────────────────
    ("Microsoft 365", "https://mcp.microsoft.com/365", "Access SharePoint, OneDrive, Outlook, and Teams context", ["productivity", "cloud"]),

    # ── Smithery qualifiedNames — use proxy URL directly ──────────────────
    # Smithery proxy pattern: https://server.smithery.ai/{qualifiedName}/mcp
    ("GitHub", "https://server.smithery.ai/github/mcp", "Manage GitHub repositories, issues, and pull requests", ["developer", "code"]),
    ("Context7", "https://server.smithery.ai/upstash/context7-mcp/mcp", "Up-to-date docs for LLMs and AI code editors", ["ai", "developer"]),
    ("Brave Search", "https://server.smithery.ai/brave/mcp", "Search the web with rich structured results", ["search"]),
    ("Exa Search", "https://server.smithery.ai/exa/mcp", "Fast, intelligent web search and web crawling", ["search"]),
    ("Postman", "https://server.smithery.ai/postman/mcp", "Give API context to your coding agents", ["developer"]),
    ("Apollo.io", "https://server.smithery.ai/apollo/mcp", "Find buyers. Book more meetings. Close more deals.", ["marketing", "leads"]),
    ("Clay", "https://server.smithery.ai/clay/mcp", "Find prospects, research accounts, personalize outreach", ["marketing", "leads"]),
    ("Harmonic", "https://server.smithery.ai/harmonic/mcp", "Discover, research, and enrich companies and people", ["data", "leads"]),
    ("ZoomInfo", "https://server.smithery.ai/zoominfo/mcp", "Enrich contacts and accounts with GTM intelligence", ["marketing", "leads"]),
    ("Smartsheet", "https://server.smithery.ai/smartsheet/mcp", "Analyze and manage Smartsheet data with Claude", ["productivity", "data"]),
    ("Netlify", "https://server.smithery.ai/netlify/mcp", "Create, deploy, manage, and secure websites on Netlify", ["developer", "cloud"]),
    ("Cloudinary", "https://server.smithery.ai/cloudinary/mcp", "Manage, transform and deliver your images and videos", ["media", "developer"]),
    ("Starburst", "https://server.smithery.ai/starburst/mcp", "Securely retrieve data from your federated data sources", ["database", "data"]),
    ("MotherDuck", "https://server.smithery.ai/motherduck/mcp", "Analyze your data with natural language", ["database", "data"]),
    ("PlanetScale", "https://server.smithery.ai/planetscale/mcp", "Authenticated access to your Postgres and MySQL DBs", ["database", "developer"]),
    ("Honeycomb", "https://server.smithery.ai/honeycomb/mcp", "Query and explore observability data and SLOs", ["developer", "cloud"]),
    ("Hex", "https://server.smithery.ai/hex/mcp", "Answer questions with the Hex agent", ["data", "ai"]),

    # ── Fallback: known MCP URL pattern ────────────────────────────────────
    ("10x Genomics Cloud", "https://mcp.10xgenomics.com", "Interact with 10x Genomics Cloud platform", ["data"]),
    ("ActiveCampaign", "https://mcp.activecampaign.com", "Autonomous marketing to transform how you work", ["marketing", "email"]),
    ("Ahrefs", "https://mcp.ahrefs.com", "SEO and AI search analytics", ["marketing", "search"]),
    ("Aiera", "https://mcp.aiera.com", "Live events, filings, company publications, and more", ["finance", "data"]),
    ("AirOps", "https://mcp.airops.com", "Craft content that wins AI search", ["marketing", "ai"]),
    ("AWS Marketplace", "https://mcp.aws.amazon.com/marketplace", "Discover, evaluate, and buy solutions for the cloud", ["cloud"]),
    ("Benchling", "https://mcp.benchling.com", "Connect to R&D data, source experiments, and notebooks", ["data"]),
    ("Bigdata.com", "https://mcp.bigdata.com", "Access real-time financial data", ["finance", "data"]),
    ("BioRender", "https://mcp.biorender.com", "Search for and use scientific templates and icons", ["media"]),
    ("Blackbaud", "https://mcp.blackbaud.com", "Search, explore, and query Blackbaud data", ["data"]),
    ("Blockscout", "https://mcp.blockscout.com", "Access and analyze blockchain data", ["finance"]),
    ("Campfire", "https://mcp.campfiretechnology.com", "Search, analyze, and export Campfire data", ["data"]),
    ("Candid", "https://mcp.candid.org", "Research nonprofits and funders using Candid data", ["data"]),
    ("CData", "https://mcp.cdata.com", "Managed MCP platform for 350 sources", ["data", "database"]),
    ("ChEMBL", "https://mcp.ebi.ac.uk/chembl", "Access to the ChEMBL Database", ["data"]),
    ("Chronograph", "https://mcp.chronograph.io", "Interact with your Chronograph data directly in Claude", ["finance", "data"]),
    ("Circleback", "https://mcp.circleback.ai", "Search and access context from meetings", ["productivity"]),
    ("Clarify", "https://mcp.clarify.co", "Query your CRM. Create records. Ask anything.", ["productivity", "marketing"]),
    ("Clarity AI", "https://mcp.clarity.ai", "Simulate fund classifications under proposed SFDR 2.0", ["finance"]),
    ("Clinical Trials", "https://mcp.clinicaltrials.gov", "Access ClinicalTrials.gov data", ["data"]),
    ("Clockwise", "https://mcp.getclockwise.com", "Advanced scheduling and time management for work", ["productivity"]),
    ("Close", "https://mcp.close.com", "Securely connect Claude to your Close data", ["marketing", "productivity"]),
    ("CMS Coverage", "https://mcp.cms.gov/coverage", "Access the CMS Coverage Database", ["data"]),
    ("Common Room", "https://mcp.commonroom.io", "Your GTM Copilot", ["marketing"]),
    ("Consensus", "https://mcp.consensus.app", "Explore scientific research", ["search", "data"]),
    ("Cortellis Regulatory Intelligence", "https://mcp.cortellis.com", "Trusted Regulatory Answers, by Clarivate Cortellis", ["data"]),
    ("Coupler.io", "https://mcp.coupler.io", "Access business data from hundreds of sources", ["data", "automation"]),
    ("Crossbeam", "https://mcp.crossbeam.com", "Explore partner data and ecosystem insights in Claude", ["marketing", "data"]),
    ("Crypto.com", "https://mcp.crypto.com", "Real time prices, orders, charts, and more for crypto", ["finance"]),
    ("Customer.io", "https://mcp.customer.io", "Explore customer data and generate insights via Claude", ["marketing"]),
    ("Daloopa", "https://mcp.daloopa.com", "Financial fundamental data and KPIs with hyperlinks", ["finance", "data"]),
    ("DataGrail", "https://mcp.datagrail.io", "Secure, production-ready AI orchestration for privacy", ["security", "data"]),
    ("Day AI", "https://mcp.day.ai", "Know everything about your prospects and customers with CRMx", ["marketing", "data"]),
    ("DevRev", "https://mcp.devrev.ai", "Search and update your company's knowledge graph", ["developer", "productivity"]),
    ("Dice", "https://mcp.dice.com", "Find active tech jobs on Dice", ["productivity"]),
    ("DirectBooker", "https://mcp.directbooker.com", "Compare hotels, then book direct", ["travel"]),
    ("Dremio Cloud", "https://mcp.dremio.cloud", "Analyze and get insights from your lakehouse data", ["database", "data"]),
    ("Egnyte", "https://mcp.egnyte.com", "Securely access and analyze Egnyte content", ["file", "productivity"]),
    ("Excalidraw", "https://mcp.excalidraw.com", "MCP for creating interactive hand-drawn diagrams", ["design"]),
    ("FactSet AI-Ready Data", "https://mcp.factset.com", "Access institutional-quality financial data and analytics", ["finance", "data"]),
    ("Fellow.ai", "https://mcp.fellow.app", "Chat with your meetings to uncover actionable insights", ["productivity"]),
    ("Fireflies", "https://mcp.fireflies.ai", "Analyze and generate insights from meeting transcripts", ["productivity", "ai"]),
    ("Function", "https://mcp.function.health", "View lab test results summaries, get nutrition plans", ["data"]),
    ("Granola", "https://mcp.granola.ai", "The AI notepad for meetings", ["productivity"]),
    ("GraphOS MCP Tools", "https://mcp.apollographql.com", "Search Apollo docs, specs, and best practices", ["developer"]),
    ("GoDaddy", "https://mcp.godaddy.com", "Search domains and check availability", ["developer"]),
    ("Harvey", "https://mcp.harvey.ai", "Answer legal queries, search vaults, and research", ["data"]),
    ("HealthEx", "https://mcp.healthex.com", "Connect your health records for personalized insights", ["data"]),
    ("Hugging Face", "https://mcp.huggingface.co", "Access the HF Hub and thousands of Gradio Apps", ["ai", "data"]),
    ("ICD-10 Codes", "https://mcp.icd10.com", "Access ICD-10-CM and ICD-10-PCS code sets", ["data"]),
    ("Indeed", "https://mcp.indeed.com", "Search for jobs on Indeed", ["productivity"]),
    ("Intapp Celeste", "https://mcp.intapp.com", "Securely, compliantly access Intapp Celeste products", ["productivity"]),
    ("Jam", "https://mcp.jam.dev", "Record screen and collect automatic context for issues", ["developer"]),
    ("Jotform", "https://mcp.jotform.com", "Create forms and analyze submissions inside Claude", ["productivity"]),
    ("Kiwi.com", "https://mcp.kiwi.com", "Search flights in Claude", ["travel"]),
    ("lastminute.com", "https://mcp.lastminute.com", "Search, compare and book flights, dynamic packages and hotels", ["travel"]),
    ("Learning Commons Knowledge Graph", "https://mcp.learningcommons.org", "K-12 standards, skills, and learning progressions", ["data"]),
    ("LegalZoom", "https://mcp.legalzoom.com", "Attorney guidance and tools for business and personal needs", ["productivity"]),
    ("LILT", "https://mcp.lilt.com", "High-quality translation with human verification", ["productivity"]),
    ("Local Falcon", "https://mcp.localfalcon.com", "AI visibility and local search intelligence platform", ["marketing", "search"]),
    ("LSEG", "https://mcp.lseg.com", "Access best in class data and analytics across asset classes", ["finance", "data"]),
    ("Lumin", "https://mcp.luminpdf.com", "Manage documents, send signature requests", ["productivity"]),
    ("LunarCrush", "https://mcp.lunarcrush.com", "Add real-time social media data to your searches", ["data", "social"]),
    ("Magic Patterns", "https://mcp.magicpatterns.com", "Discuss and iterate on Magic Patterns designs", ["design"]),
    ("Medidata", "https://mcp.medidata.com", "Medidata provides clinical trial software solutions", ["data"]),
    ("Melon", "https://mcp.melon.com", "Browse music charts and your personalized music picks", ["media"]),
    ("Mem", "https://mcp.mem.ai", "The AI notebook for everything on your mind", ["productivity", "ai"]),
    ("Mercury", "https://mcp.mercury.com", "Search, analyze and understand your finances on Mercury", ["finance"]),
    ("Mermaid Chart", "https://mcp.mermaidchart.com", "Validates Mermaid syntax, renders diagrams as high-quality SVG", ["developer", "design"]),
    ("Microsoft Learn", "https://mcp.microsoft.com/learn", "Search trusted Microsoft docs to power your development", ["developer", "cloud"]),
    ("Midpage Legal Research", "https://mcp.midpage.ai", "Conduct legal research and create work product", ["data"]),
    ("Moody's Analytics", "https://mcp.moodysanalytics.com", "Risk insights, analytics, and decision intelligence", ["finance", "data"]),
    ("Morningstar", "https://mcp.morningstar.com", "Up-to-date investment and market insights", ["finance", "data"]),
    ("MSCI", "https://mcp.msci.com", "Converse, query and comprehend a world of MSCI indexes", ["finance", "data"]),
    ("MT Newswires", "https://mcp.mtnewswires.com", "Trusted real-time global financial news provider", ["news", "finance"]),
    ("n8n", "https://mcp.n8n.io", "Access and run your n8n workflows", ["automation"]),
    ("NPI Registry", "https://mcp.nppes.cms.hhs.gov", "Access US National Provider Identifier (NPI) Registry", ["data"]),
    ("Omni Analytics", "https://mcp.omni.co", "Query your data using natural language through Omni's semantic model", ["data"]),
    ("Open Targets", "https://mcp.opentargets.org", "Drug target discovery and prioritisation platform", ["data"]),
    ("Oracle NetSuite", "https://mcp.netsuite.com", "Connect Claude to NetSuite data for analysis and insights", ["productivity", "finance"]),
    ("Owkin", "https://mcp.owkin.com", "Interact with AI agents built for biology", ["ai", "data"]),
    ("Pigment", "https://mcp.pigment.com", "Analyze business data", ["data", "finance"]),
    ("PitchBook", "https://mcp.pitchbook.com", "PitchBook data, embedded in the way you work", ["finance", "data"]),
    ("PlayMCP", "https://mcp.playmcp.com", "Connect and use PlayMCP servers in your toolbox", ["developer"]),
    ("Port IO", "https://mcp.getport.io", "Build and query your developer portal and trigger developer workflows", ["developer"]),
    ("Process Street", "https://mcp.process.st", "Explore and update your Process Street data", ["productivity"]),
    ("PubMed", "https://mcp.ncbi.nlm.nih.gov/pubmed", "Search biomedical literature from PubMed", ["search", "data"]),
    ("Pylon", "https://mcp.usepylon.com", "Search and manage Pylon support issues", ["productivity"]),
    ("Scholar Gateway", "https://mcp.scholargateway.com", "Enhance responses with scholarly research and citations", ["search", "data"]),
    ("SignNow", "https://mcp.signnow.com", "Automate eSignature workflows directly from Claude", ["productivity"]),
    ("Similarweb", "https://mcp.similarweb.com", "Real time web, mobile app, and market data", ["data", "marketing"]),
    ("S&P Global", "https://mcp.spglobal.com", "Query a range of S&P Global datasets, like Financials", ["finance", "data"]),
    ("Sprouts Data Intelligence", "https://mcp.sprouts.ai", "From query to qualified lead in seconds", ["marketing", "leads"]),
    ("Synapse.org", "https://mcp.synapse.org", "Search and metadata tools for Synapse scientific data", ["data"]),
    ("Ticket Tailor", "https://mcp.tickettailor.com", "Event platform for managing tickets, orders and more", ["productivity", "ecommerce"]),
    ("Tool Universe", "https://mcp.tooluniverse.com", "AI scientists with 600+ scientific tools", ["ai", "data"]),
    ("Trivago", "https://mcp.trivago.com", "Find your ideal hotel at the best price", ["travel"]),
    ("Udemy Business", "https://mcp.udemy.com", "Search and explore skill-building resources", ["productivity"]),
    ("Vibe Prospecting", "https://mcp.vibe-prospecting.com", "Find company and contact data", ["marketing", "leads"]),
    ("Visier", "https://mcp.visier.com", "Find people, productivity and business impact insights", ["data", "productivity"]),
    ("Windsor.ai", "https://mcp.windsor.ai", "Connect 325+ marketing, analytics and CRM data sources", ["marketing", "data"]),
    ("WordPress.com", "https://mcp.wordpress.com", "Secure AI access to manage your WordPress.com sites", ["developer"]),
    ("Wyndham Hotels and Resorts", "https://mcp.wyndhamhotels.com", "Discover the right Wyndham Hotel for you, faster", ["travel"]),
    ("Yardi Virtuoso", "https://mcp.yardi.com", "Real-time Yardi data and insights", ["data", "finance"]),
    ("Supermetrics", "https://mcp.supermetrics.com", "Analyze marketing performance across 200+ platforms", ["marketing", "data"]),
    ("Aura", "https://mcp.aura.com", "Company intelligence and workforce analytics", ["data"]),
    ("Base44", "https://mcp.base44.com", "Build and manage Base44 apps", ["developer"]),
    ("Benevity", "https://mcp.benevity.com", "Find and engage with verified nonprofits", ["productivity"]),
    ("bioRxiv", "https://mcp.biorxiv.org", "Access to bioRxiv and medRxiv preprint data", ["data", "search"]),
]


async def resolve_smithery_url(client: httpx.AsyncClient, qname: str) -> str:
    """Look up a Smithery server's deployment URL by qualifiedName."""
    try:
        r = await client.get(f"{SMITHERY_API}/{qname}", timeout=15)
        if r.status_code == 200:
            data = r.json()
            connections = data.get("connections", [])
            if connections:
                url = connections[0].get("deploymentUrl") or ""
                if url:
                    return url
            return data.get("deploymentUrl", "")
    except Exception:
        pass
    return ""


async def ingest_connector(db, display_name: str, mcp_url: str, description: str, tags: list[str]) -> Tool | None:
    """Upsert a Claude connector as an AgentNet tool."""
    # Clean slug for DB name
    slug = display_name.lower().replace(" ", "-").replace(".", "-").replace("/", "-").replace("(", "").replace(")", "").replace("'", "").replace("&", "and").replace(",", "")
    tool_name = f"claude/{slug}"

    existing = await db.execute(select(Tool).where(Tool.name == tool_name))
    tool = existing.scalar_one_or_none()

    all_tags = list(set(["mcp", "claude-connector"] + tags))

    if tool is None:
        tool = Tool(
            name=tool_name,
            provider=display_name,
            transport="mcp",
            base_url=mcp_url,
            page_url=f"https://claude.com/connectors/{slug}",
            auth_type="oauth",  # Claude connectors all use OAuth
            tags=all_tags,
            status="active",
            priority=2,  # Boost: official Claude connectors get priority
        )
        db.add(tool)
        await db.flush()
    else:
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
                input_schema={"type": "object", "description": f"{display_name} MCP parameters"},
                embedding=emb,
            ))

    return tool


async def crawl_claude_connectors() -> int:
    """Index all Claude official connectors."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with httpx.AsyncClient(
        headers={"User-Agent": "AgentNet-Crawler/1.0"},
        follow_redirects=True,
    ) as client:
        # Resolve Smithery URLs first
        smithery_items = [(n, u, d, t) for n, u, d, t in CLAUDE_CONNECTORS if u.startswith("smithery:")]
        direct_items = [(n, u, d, t) for n, u, d, t in CLAUDE_CONNECTORS if not u.startswith("smithery:")]

        log.info("Resolving %d Smithery URLs...", len(smithery_items))
        resolved_smithery = []
        for name, smithery_ref, desc, tags in smithery_items:
            qname = smithery_ref.replace("smithery:", "")
            url = await resolve_smithery_url(client, qname)
            if url:
                resolved_smithery.append((name, url, desc, tags))
                log.info("  %s → %s", name, url)
            else:
                log.debug("  %s: no deployment URL found", name)
            await asyncio.sleep(0.2)

        all_items = direct_items + resolved_smithery
        log.info("Indexing %d Claude connectors...", len(all_items))

        ingested = 0
        for name, url, desc, tags in all_items:
            async with async_session() as db:
                try:
                    tool = await ingest_connector(db, name, url, desc, tags)
                    if tool:
                        await db.commit()
                        ingested += 1
                except Exception as e:
                    log.debug("Skipping %s: %s", name, e)
                    await db.rollback()

        log.info("Claude connectors indexed: %d/%d", ingested, len(all_items))
        return ingested


if __name__ == "__main__":
    asyncio.run(crawl_claude_connectors())
