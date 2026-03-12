import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.admin import router as admin_router
from app.api.execute import router as execute_router
from app.api.live import router as live_router
from app.api.oauth import router as oauth_router
from app.api.routes import router
from app.config import settings
from app.database import engine
from app.models.tool import Base
from app.models.user import OAuthConnection, Session  # noqa: F401 — register models
from app.models.training import Conversation, Message, Feedback, ToolSuggestion  # noqa: F401
from app.models.registered_site import RegisteredSite  # noqa: F401 — register model
from app.models.domain import Domain, DomainTool  # noqa: F401 — register models

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Start background crawl worker
    from app.services.crawl_worker import run_worker
    worker_task = asyncio.create_task(run_worker())
    log.info("Crawl worker started")

    # Start MCP session manager (required for streamable HTTP transport)
    from app.mcp import mcp
    async with mcp.session_manager.run():
        yield

    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="AgentNet",
    description="Agent Capability Search Engine — Google for AI agents",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # /mcp must be reachable by Claude.ai, OpenAI, and any MCP client
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(oauth_router)
app.include_router(execute_router)
app.include_router(admin_router)
app.include_router(live_router, prefix="/v1")

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
