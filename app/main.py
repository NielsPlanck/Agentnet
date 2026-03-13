import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.campaigns import router as campaigns_router
from app.api.execute import router as execute_router
from app.api.live import router as live_router
from app.api.oauth import router as oauth_router
from app.api.history import router as history_router
from app.api.routes import router
from app.api.settings import router as settings_router
from app.config import settings
from app.database import engine
from app.models.tool import Base
from app.models.user import OAuthConnection, Session, User  # noqa: F401 — register models
from app.models.training import Conversation, Message, Feedback, ToolSuggestion  # noqa: F401
from app.models.registered_site import RegisteredSite  # noqa: F401 — register model
from app.models.domain import Domain, DomainTool  # noqa: F401 — register models
from app.models.followup import TrackedPerson, FollowUpStep  # noqa: F401 — register models
from app.models.campaign import Campaign, CampaignProspect, SequenceStep, OutreachLog  # noqa: F401
from app.models.preference import UserPreference  # noqa: F401 — register model
from app.models.job_profile import JobProfile, JobApplication  # noqa: F401 — register models
from app.models.routine import Routine, RoutineRun  # noqa: F401 — register models
from app.models.memory import Memory  # noqa: F401 — register model
from app.models.email_intel import EmailDigest  # noqa: F401 — register model
from app.models.meeting_intel import MeetingDebrief  # noqa: F401 — register model
from app.models.workflow import Workflow, WorkflowStep, WorkflowRun  # noqa: F401 — register models
from app.models.skill import CustomSkill  # noqa: F401 — register model

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Start background crawl worker
    from app.services.crawl_worker import run_worker
    worker_task = asyncio.create_task(run_worker())
    log.info("Crawl worker started")

    # Start routine worker (proactive assistant)
    from app.services.routine_worker import run_routine_worker
    routine_task = asyncio.create_task(run_routine_worker())
    log.info("Routine worker started")

    # Start MCP session manager (required for streamable HTTP transport)
    from app.mcp import mcp
    async with mcp.session_manager.run():
        yield

    worker_task.cancel()
    routine_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
    try:
        await routine_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="AgentNet",
    description="Agent Capability Search Engine — Google for AI agents",
    version="0.1.0",
    lifespan=lifespan,
)

_cors_origins = [
    settings.frontend_url,
    "https://agentnet.codiris.app",
    "https://backagentnet.codiris.app",
    "http://localhost:3001",
    "http://localhost:3003",
    "http://localhost:8000",
]
# Filter out empty/duplicate strings.
_cors_origins = list({o for o in _cors_origins if o})

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(auth_router)
app.include_router(campaigns_router)
app.include_router(oauth_router)
app.include_router(execute_router)
app.include_router(admin_router)
app.include_router(settings_router)
app.include_router(history_router)
app.include_router(live_router, prefix="/v1")

# Job application agent
from app.api.jobs import router as jobs_router  # noqa: E402
app.include_router(jobs_router)

# Routines (proactive assistant)
from app.api.routines import router as routines_router  # noqa: E402
app.include_router(routines_router)

# Memories (persistent AI memory)
from app.api.memories import router as memories_router  # noqa: E402
app.include_router(memories_router)

# Email Intelligence (Smart Inbox)
from app.api.email_intel import router as email_intel_router  # noqa: E402
app.include_router(email_intel_router)

# Meeting Intelligence
from app.api.meeting_intel import router as meeting_intel_router  # noqa: E402
app.include_router(meeting_intel_router)

# WhatsApp Integration
from app.api.whatsapp import router as whatsapp_router  # noqa: E402
app.include_router(whatsapp_router)

# Workflow Builder
from app.api.workflows import router as workflows_router  # noqa: E402
app.include_router(workflows_router)

# Custom Skills (user-created skills with instructions + MCP)
from app.api.skills import router as skills_router  # noqa: E402
app.include_router(skills_router)

# Speech-to-text WebSocket (OpenAI GPT-4o Realtime Transcription)
from app.api.stt import router as stt_router  # noqa: E402
app.include_router(stt_router, prefix="/v1")

# MCP endpoint — Claude.ai connectors, Claude Desktop, OpenAI Apps SDK
from app.mcp import get_mcp_app  # noqa: E402
app.mount("/mcp", get_mcp_app())

@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve Next.js static export — must be last (catch-all)
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


# ASGI wrapper: normalize POST /mcp (no trailing slash) → /mcp/
# Starlette's Mount regex requires the slash; static-files catch-all at /
# intercepts /mcp before the redirect_slashes logic can run.
_fastapi_app = app

async def app(scope, receive, send):  # noqa: F811  (shadows FastAPI app intentionally)
    if scope.get("type") == "http" and scope.get("path") == "/mcp":
        scope = {**scope, "path": "/mcp/", "raw_path": b"/mcp/"}
    await _fastapi_app(scope, receive, send)
