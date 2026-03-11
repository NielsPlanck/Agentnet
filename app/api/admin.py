import csv
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.config import settings
from app.models.registered_site import RegisteredSite
from app.models.tool import Action, Tool
from app.models.training import (
    Conversation,
    Feedback,
    Message,
    ToolSuggestion,
)

router = APIRouter(prefix="/v1/admin")


def _check_admin(request: Request):
    """Verify admin token from Authorization header."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = auth[7:]
    if token != settings.admin_password:
        raise HTTPException(status_code=403, detail="Invalid token")


# ── Auth ────────────────────────────────────────────────────────

@router.post("/login")
async def admin_login(request: Request):
    body = await request.json()
    email = body.get("email", "")
    password = body.get("password", "")
    if email != settings.admin_email or password != settings.admin_password:
        raise HTTPException(status_code=403, detail="Invalid credentials")
    return {"token": settings.admin_password}


# ── Dashboard stats ─────────────────────────────────────────────

@router.get("/stats")
async def admin_stats(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)

    conv_count = (await db.execute(select(func.count(Conversation.id)))).scalar() or 0
    msg_count = (await db.execute(select(func.count(Message.id)))).scalar() or 0
    fb_count = (await db.execute(select(func.count(Feedback.id)))).scalar() or 0
    up_count = (await db.execute(select(func.count(Feedback.id)).where(Feedback.vote == "up"))).scalar() or 0
    down_count = (await db.execute(select(func.count(Feedback.id)).where(Feedback.vote == "down"))).scalar() or 0
    suggestion_count = (await db.execute(select(func.count(ToolSuggestion.id)))).scalar() or 0

    return {
        "conversations": conv_count,
        "messages": msg_count,
        "feedback_total": fb_count,
        "feedback_positive": up_count,
        "feedback_negative": down_count,
        "suggestions": suggestion_count,
    }


# ── Conversations ───────────────────────────────────────────────

@router.get("/conversations")
async def list_conversations(
    request: Request,
    limit: int = Query(50, le=500),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)

    stmt = (
        select(Conversation)
        .options(selectinload(Conversation.messages), selectinload(Conversation.feedback))
        .order_by(Conversation.started_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    convs = result.scalars().all()

    return [
        {
            "id": c.id,
            "started_at": c.started_at.isoformat() if c.started_at else None,
            "message_count": len(c.messages),
            "feedback": [{"vote": f.vote, "content": f.message_content[:80]} for f in c.feedback],
            "preview": next((m.content[:120] for m in sorted(c.messages, key=lambda x: x.seq) if m.role == "user"), ""),
            "messages": [
                {
                    "seq": m.seq,
                    "role": m.role,
                    "content": m.content,
                    "raw_query": m.raw_query,
                    "tools_shown": m.tools_shown,
                    "tool_selected": m.tool_selected,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                }
                for m in sorted(c.messages, key=lambda x: x.seq)
            ],
        }
        for c in convs
    ]


# ── Feedback ────────────────────────────────────────────────────

@router.get("/feedback")
async def list_feedback(
    request: Request,
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)

    stmt = select(Feedback).order_by(Feedback.created_at.desc()).limit(limit)
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [
        {
            "id": f.id,
            "vote": f.vote,
            "content": f.message_content,
            "conversation_id": f.conversation_id,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for f in items
    ]


# ── Suggestions ─────────────────────────────────────────────────

@router.get("/suggestions")
async def list_suggestions(
    request: Request,
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)

    stmt = select(ToolSuggestion).order_by(ToolSuggestion.created_at.desc()).limit(limit)
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "url": s.url,
            "reason": s.reason,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in items
    ]


# ── CSV Export ──────────────────────────────────────────────────

@router.get("/export/conversations.csv")
async def export_conversations_csv(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)

    stmt = (
        select(Conversation)
        .options(selectinload(Conversation.messages), selectinload(Conversation.feedback))
        .order_by(Conversation.started_at)
    )
    result = await db.execute(stmt)
    convs = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["conversation_id", "started_at", "seq", "role", "content", "tools_shown", "tool_selected", "feedback"])

    for c in convs:
        fb_votes = ", ".join(f.vote for f in c.feedback) if c.feedback else ""
        for m in sorted(c.messages, key=lambda x: x.seq):
            tools = ", ".join(m.tools_shown.get("tools", [])) if m.tools_shown else ""
            writer.writerow([
                c.id,
                c.started_at.isoformat() if c.started_at else "",
                m.seq,
                m.role,
                m.content,
                tools,
                m.tool_selected or "",
                fb_votes if m.role == "assistant" else "",
            ])

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=agentnet_conversations.csv"},
    )


@router.get("/export/training.jsonl")
async def export_training_jsonl(
    request: Request,
    only_positive: bool = Query(False),
    format: str = Query("openai"),
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)

    stmt = (
        select(Conversation)
        .options(selectinload(Conversation.messages), selectinload(Conversation.feedback))
        .order_by(Conversation.started_at)
    )
    result = await db.execute(stmt)
    convs = result.scalars().all()

    lines = []
    for conv in convs:
        if only_positive and not any(f.vote == "up" for f in conv.feedback):
            continue
        msgs = sorted(conv.messages, key=lambda x: x.seq)
        if not msgs:
            continue

        if format == "openai":
            training_messages = [{"role": m.role, "content": m.content} for m in msgs]
            lines.append(json.dumps({"messages": training_messages}))
        else:
            lines.append(json.dumps({
                "conversation_id": conv.id,
                "feedback": [{"vote": f.vote} for f in conv.feedback],
                "messages": [
                    {"role": m.role, "content": m.content, "tools_shown": m.tools_shown, "tool_selected": m.tool_selected}
                    for m in msgs
                ],
            }))

    content = "\n".join(lines)
    return StreamingResponse(
        iter([content]),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f"attachment; filename=agentnet_training.jsonl"},
    )


@router.get("/export/suggestions.csv")
async def export_suggestions_csv(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)

    stmt = select(ToolSuggestion).order_by(ToolSuggestion.created_at.desc())
    result = await db.execute(stmt)
    items = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "name", "url", "reason", "created_at"])
    for s in items:
        writer.writerow([s.id, s.name, s.url, s.reason, s.created_at.isoformat() if s.created_at else ""])

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=agentnet_suggestions.csv"},
    )


# ── Tools CRUD ──────────────────────────────────────────────────

class ToolCreateRequest(BaseModel):
    name: str
    provider: str
    transport: str = "rest"
    base_url: str
    page_url: str | None = None
    auth_type: str = "none"
    status: str = "active"
    tags: list[str] = []
    priority: int = 0


class ToolUpdateRequest(BaseModel):
    name: str | None = None
    provider: str | None = None
    transport: str | None = None
    base_url: str | None = None
    page_url: str | None = None
    auth_type: str | None = None
    status: str | None = None
    tags: list[str] | None = None
    priority: int | None = None


class ActionCreateRequest(BaseModel):
    name: str
    description: str = ""
    operation_type: str = "read"
    input_schema: dict | None = None


@router.get("/tools")
async def admin_list_tools(
    request: Request,
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)
    stmt = select(Tool).options(selectinload(Tool.actions)).order_by(Tool.priority.desc(), Tool.name)
    result = await db.execute(stmt)
    tools = result.scalars().all()

    if search:
        s = search.lower()
        tools = [t for t in tools if s in t.name.lower() or s in t.provider.lower()]

    return [
        {
            "id": t.id,
            "name": t.name,
            "provider": t.provider,
            "transport": t.transport,
            "base_url": t.base_url,
            "page_url": t.page_url,
            "auth_type": t.auth_type,
            "status": t.status,
            "tags": t.tags,
            "priority": t.priority,
            "actions_count": len(t.actions),
            "actions": [
                {"id": a.id, "name": a.name, "description": a.description, "operation_type": a.operation_type}
                for a in t.actions
            ],
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in tools
    ]


@router.post("/tools")
async def admin_create_tool(
    request: Request,
    body: ToolCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)
    tool = Tool(
        name=body.name,
        provider=body.provider,
        transport=body.transport,
        base_url=body.base_url,
        page_url=body.page_url,
        auth_type=body.auth_type,
        status=body.status,
        tags=body.tags,
        priority=body.priority,
    )
    db.add(tool)
    await db.commit()
    await db.refresh(tool)
    return {"id": tool.id, "name": tool.name}


@router.put("/tools/{tool_id}")
async def admin_update_tool(
    request: Request,
    tool_id: str,
    body: ToolUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)
    result = await db.execute(select(Tool).where(Tool.id == tool_id))
    tool = result.scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(tool, field, value)

    await db.commit()
    return {"status": "updated", "id": tool.id}


@router.delete("/tools/{tool_id}")
async def admin_delete_tool(
    request: Request,
    tool_id: str,
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)
    result = await db.execute(select(Tool).where(Tool.id == tool_id))
    tool = result.scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    await db.delete(tool)
    await db.commit()
    return {"status": "deleted"}


@router.post("/tools/{tool_id}/actions")
async def admin_add_action(
    request: Request,
    tool_id: str,
    body: ActionCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)
    result = await db.execute(select(Tool).where(Tool.id == tool_id))
    tool = result.scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")

    from app.services.embeddings import get_embedding
    emb = await get_embedding(f"{tool.name} {body.name}: {body.description}")
    action = Action(
        tool_id=tool_id,
        name=body.name,
        description=body.description,
        operation_type=body.operation_type,
        input_schema=body.input_schema,
        embedding=emb,
    )
    db.add(action)
    await db.commit()
    await db.refresh(action)
    return {"id": action.id, "name": action.name}


@router.delete("/tools/{tool_id}/actions/{action_id}")
async def admin_delete_action(
    request: Request,
    tool_id: str,
    action_id: str,
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)
    result = await db.execute(
        select(Action).where(Action.id == action_id, Action.tool_id == tool_id)
    )
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    await db.delete(action)
    await db.commit()
    return {"status": "deleted"}


# ── Sites (Crawl Bot) ───────────────────────────────────────────

@router.get("/sites")
async def admin_list_sites(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)
    result = await db.execute(
        select(RegisteredSite).order_by(RegisteredSite.created_at.desc())
    )
    sites = result.scalars().all()
    return [
        {
            "id": s.id,
            "domain": s.domain,
            "submitted_url": s.submitted_url,
            "contact_email": s.contact_email,
            "verified": s.verified,
            "crawl_status": s.crawl_status,
            "crawl_error": s.crawl_error,
            "last_crawled_at": s.last_crawled_at.isoformat() if s.last_crawled_at else None,
            "next_crawl_at": s.next_crawl_at.isoformat() if s.next_crawl_at else None,
            "discovered_actions_count": s.discovered_actions_count,
            "discovered_tool_id": s.discovered_tool_id,
            "verification_token": s.verification_token,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in sites
    ]


@router.post("/sites/{site_id}/recrawl")
async def admin_recrawl_site(
    request: Request,
    site_id: str,
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)
    result = await db.execute(select(RegisteredSite).where(RegisteredSite.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    site.crawl_status = "pending"
    site.crawl_error = None
    site.next_crawl_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "queued", "domain": site.domain}


@router.post("/sites/register")
async def admin_register_site(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)
    body = await request.json()
    url = body.get("url", "")
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Invalid URL")

    domain = parsed.netloc.lower().replace("www.", "")
    existing = await db.execute(select(RegisteredSite).where(RegisteredSite.domain == domain))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Domain already registered")

    site = RegisteredSite(domain=domain, submitted_url=url, crawl_status="pending")
    db.add(site)
    await db.commit()
    await db.refresh(site)
    return {"id": site.id, "domain": domain, "status": "queued"}


@router.delete("/sites/{site_id}")
async def admin_delete_site(
    request: Request,
    site_id: str,
    db: AsyncSession = Depends(get_db),
):
    _check_admin(request)
    result = await db.execute(select(RegisteredSite).where(RegisteredSite.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    await db.delete(site)
    await db.commit()
    return {"status": "deleted"}


# ── Domains (Curated Rankings) ──────────────────────────────────

class DomainCreateRequest(BaseModel):
    name: str
    slug: str
    description: str = ""
    keywords: list[str] = []


class DomainUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    keywords: list[str] | None = None


class DomainToolRankRequest(BaseModel):
    tool_id: str
    rank: int


@router.get("/domains")
async def admin_list_domains(request: Request, db: AsyncSession = Depends(get_db)):
    _check_admin(request)
    from app.models.domain import Domain, DomainTool
    result = await db.execute(
        select(Domain).options(
            selectinload(Domain.tool_ranks).selectinload(DomainTool.tool)
        ).order_by(Domain.name)
    )
    domains = result.scalars().all()
    return [
        {
            "id": d.id,
            "name": d.name,
            "slug": d.slug,
            "description": d.description,
            "keywords": d.keywords,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "tools": [
                {
                    "domain_tool_id": dt.id,
                    "tool_id": dt.tool_id,
                    "tool_name": dt.tool.name if dt.tool else dt.tool_id,
                    "tool_provider": dt.tool.provider if dt.tool else "",
                    "tool_transport": dt.tool.transport if dt.tool else "",
                    "rank": dt.rank,
                }
                for dt in sorted(d.tool_ranks, key=lambda x: x.rank)
            ],
        }
        for d in domains
    ]


@router.post("/domains")
async def admin_create_domain(request: Request, body: DomainCreateRequest, db: AsyncSession = Depends(get_db)):
    _check_admin(request)
    from app.models.domain import Domain
    import re
    slug = body.slug or re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-")
    domain = Domain(name=body.name, slug=slug, description=body.description, keywords=body.keywords)
    db.add(domain)
    await db.commit()
    await db.refresh(domain)
    return {"id": domain.id, "name": domain.name, "slug": domain.slug}


@router.put("/domains/{domain_id}")
async def admin_update_domain(request: Request, domain_id: str, body: DomainUpdateRequest, db: AsyncSession = Depends(get_db)):
    _check_admin(request)
    from app.models.domain import Domain
    result = await db.execute(select(Domain).where(Domain.id == domain_id))
    domain = result.scalar_one_or_none()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(domain, field, value)
    await db.commit()
    return {"status": "updated"}


@router.delete("/domains/{domain_id}")
async def admin_delete_domain(request: Request, domain_id: str, db: AsyncSession = Depends(get_db)):
    _check_admin(request)
    from app.models.domain import Domain
    result = await db.execute(select(Domain).where(Domain.id == domain_id))
    domain = result.scalar_one_or_none()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    await db.delete(domain)
    await db.commit()
    return {"status": "deleted"}


@router.put("/domains/{domain_id}/tools")
async def admin_set_domain_tools(
    request: Request,
    domain_id: str,
    body: list[DomainToolRankRequest],
    db: AsyncSession = Depends(get_db),
):
    """Replace all tool rankings for a domain."""
    _check_admin(request)
    from app.models.domain import Domain, DomainTool
    result = await db.execute(select(Domain).where(Domain.id == domain_id))
    domain = result.scalar_one_or_none()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    # Delete existing
    existing = await db.execute(select(DomainTool).where(DomainTool.domain_id == domain_id))
    for dt in existing.scalars().all():
        await db.delete(dt)

    # Insert new
    for item in body:
        db.add(DomainTool(domain_id=domain_id, tool_id=item.tool_id, rank=item.rank))

    await db.commit()
    return {"status": "updated", "tools_count": len(body)}


# ── Apify Crawler ───────────────────────────────────────────────

@router.post("/apify/crawl")
async def admin_crawl_apify(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Trigger Apify MCP store crawl in background."""
    _check_admin(request)
    body = await request.json()
    limit = int(body.get("limit", 100))

    import asyncio
    from app.crawlers.apify import crawl_apify
    asyncio.create_task(crawl_apify(limit=limit))

    return {"status": "started", "limit": limit, "message": f"Crawling up to {limit} Apify MCP actors in background"}


@router.get("/apify/tools")
async def admin_list_apify_tools(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List all indexed Apify tools."""
    _check_admin(request)
    result = await db.execute(
        select(Tool)
        .where(Tool.name.like("apify/%"))
        .options(selectinload(Tool.actions))
        .order_by(Tool.name)
    )
    tools = result.scalars().all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "provider": t.provider,
            "page_url": t.page_url,
            "base_url": t.base_url,
            "tags": t.tags,
            "actions_count": len(t.actions),
            "status": t.status,
        }
        for t in tools
    ]


# ── MCP Market / Smithery Crawler ───────────────────────────────

@router.post("/mcpmarket/crawl")
async def admin_crawl_mcpmarket(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Trigger Smithery MCP registry crawl (3800+ deployed servers with live endpoints)."""
    _check_admin(request)
    body = await request.json()
    limit = int(body.get("limit", 500))
    deployed_only = bool(body.get("deployed_only", True))

    import asyncio
    from app.crawlers.smithery import crawl_smithery
    asyncio.create_task(crawl_smithery(limit=limit, deployed_only=deployed_only))

    return {"status": "started", "limit": limit, "message": f"Crawling up to {limit} MCP servers from Smithery registry in background"}


@router.get("/mcpmarket/tools")
async def admin_list_mcpmarket_tools(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List all indexed community MCP tools (from Smithery registry)."""
    _check_admin(request)
    # Smithery tools use qualifiedName directly — exclude known prefixed sources
    result = await db.execute(
        select(Tool)
        .where(Tool.transport == "mcp")
        .where(~Tool.name.like("apify/%"))
        .where(~Tool.name.like("webmcp/%"))
        .options(selectinload(Tool.actions))
        .order_by(Tool.provider)
    )
    tools = result.scalars().all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "provider": t.provider,
            "page_url": t.page_url,
            "base_url": t.base_url,
            "tags": t.tags,
            "actions_count": len(t.actions),
            "status": t.status,
        }
        for t in tools
    ]


# ── Claude Connectors Crawler ────────────────────────────────────

@router.post("/claude-connectors/crawl")
async def admin_crawl_claude_connectors(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Trigger Claude official connectors crawl in background."""
    _check_admin(request)
    import asyncio
    from app.crawlers.claude_connectors import crawl_claude_connectors
    asyncio.create_task(crawl_claude_connectors())
    return {"status": "started", "message": "Crawling Claude official connectors in background"}


@router.get("/claude-connectors/tools")
async def admin_list_claude_connectors(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List all indexed Claude connector tools."""
    _check_admin(request)
    result = await db.execute(
        select(Tool)
        .where(Tool.name.like("claude/%"))
        .options(selectinload(Tool.actions))
        .order_by(Tool.provider)
    )
    tools = result.scalars().all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "provider": t.provider,
            "page_url": t.page_url,
            "base_url": t.base_url,
            "tags": t.tags,
            "priority": t.priority,
            "actions_count": len(t.actions),
            "status": t.status,
        }
        for t in tools
    ]


# ── ChatGPT Connectors Crawler ───────────────────────────────────

@router.post("/chatgpt-connectors/crawl")
async def admin_crawl_chatgpt_connectors(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Trigger ChatGPT apps/connectors crawl in background."""
    _check_admin(request)
    import asyncio
    from app.crawlers.chatgpt_connectors import crawl_chatgpt_connectors
    asyncio.create_task(crawl_chatgpt_connectors())
    return {"status": "started", "message": "Crawling ChatGPT official connectors in background"}


@router.get("/chatgpt-connectors/tools")
async def admin_list_chatgpt_connectors(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List all indexed ChatGPT connector tools."""
    _check_admin(request)
    result = await db.execute(
        select(Tool)
        .where(Tool.tags.contains(["chatgpt-connector"]))
        .options(selectinload(Tool.actions))
        .order_by(Tool.provider)
    )
    tools = result.scalars().all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "provider": t.provider,
            "page_url": t.page_url,
            "base_url": t.base_url,
            "tags": t.tags,
            "priority": t.priority,
            "actions_count": len(t.actions),
            "status": t.status,
        }
        for t in tools
    ]


# ── Domain: Add tool by URL (crawl + link) ──────────────────────

@router.post("/domains/{domain_id}/crawl-url")
async def admin_domain_crawl_url(
    request: Request,
    domain_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Crawl a URL, index it as a tool, and add it to this domain."""
    _check_admin(request)
    from urllib.parse import urlparse
    from app.models.domain import Domain, DomainTool
    from app.models.registered_site import RegisteredSite
    from app.crawlers.site import crawl_site

    body = await request.json()
    url = body.get("url", "").strip()
    rank = int(body.get("rank", 1))

    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Invalid URL")

    # Check domain exists
    result = await db.execute(select(Domain).where(Domain.id == domain_id))
    domain = result.scalar_one_or_none()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    site_domain = parsed.netloc.lower().replace("www.", "")

    # Get or create RegisteredSite
    existing_site = await db.execute(select(RegisteredSite).where(RegisteredSite.domain == site_domain))
    site = existing_site.scalar_one_or_none()
    if not site:
        site = RegisteredSite(domain=site_domain, submitted_url=url, crawl_status="crawling")
        db.add(site)
        await db.flush()

    # Crawl synchronously
    try:
        tool, actions_count = await crawl_site(db, site)
        site.crawl_status = "done"
        site.discovered_actions_count = actions_count
        if tool:
            site.discovered_tool_id = tool.id
    except Exception as e:
        site.crawl_status = "failed"
        site.crawl_error = str(e)[:500]
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Crawl failed: {e}")

    if not tool:
        await db.commit()
        raise HTTPException(status_code=422, detail="Could not extract tools from this URL")

    # Link tool to domain (upsert)
    existing_dt = await db.execute(
        select(DomainTool).where(DomainTool.domain_id == domain_id, DomainTool.tool_id == tool.id)
    )
    dt = existing_dt.scalar_one_or_none()
    if dt:
        dt.rank = rank
    else:
        db.add(DomainTool(domain_id=domain_id, tool_id=tool.id, rank=rank))

    await db.commit()

    return {
        "status": "ok",
        "tool_id": tool.id,
        "tool_name": tool.name,
        "actions_count": actions_count,
        "rank": rank,
        "message": f"Crawled {url} and added to domain '{domain.name}' at rank {rank}",
    }
