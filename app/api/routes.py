import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.config import settings
from app.models.capability import Capability
from app.models.registered_site import RegisteredSite
from app.models.tool import Action, Tool
from app.models.training import (
    Conversation,
    Feedback,
    Message,
    ToolSuggestion as ToolSuggestionModel,
)
from app.schemas.capability import CapabilityOut
from app.schemas.search import (
    AskRequest,
    AskResponse,
    SearchRequest,
    SearchResponse,
    SearchResultItem,
)
from app.schemas.tool import ActionOut, ToolDetailOut, ToolOut
from app.services.llm import ask_agentnet, ask_agentnet_stream, ask_web_stream
from app.services.search import search_by_intent

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1")


# ── Search & Tools ──────────────────────────────────────────────

@router.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest, db: AsyncSession = Depends(get_db)):
    return await search_by_intent(db, req)


@router.get("/tools", response_model=list[ToolOut])
async def list_tools(
    category: str | None = Query(None),
    transport: str | None = Query(None),
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Tool)
    if category:
        stmt = stmt.where(Tool.tags.contains(f'"{category}"'))
    if transport:
        stmt = stmt.where(Tool.transport == transport)
    if status:
        stmt = stmt.where(Tool.status == status)
    stmt = stmt.order_by(Tool.name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/tools/{tool_id}", response_model=ToolDetailOut)
async def get_tool(tool_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(Tool).where(Tool.id == tool_id).options(selectinload(Tool.actions))
    result = await db.execute(stmt)
    tool = result.scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    return tool


@router.get("/capabilities", response_model=list[CapabilityOut])
async def list_capabilities(
    category: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Capability)
    if category:
        stmt = stmt.where(Capability.category == category)
    stmt = stmt.order_by(Capability.slug)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/actions/{action_id}", response_model=ActionOut)
async def get_action(action_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(Action).where(Action.id == action_id)
    result = await db.execute(stmt)
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    return action


# ── Ask (chat) ──────────────────────────────────────────────────

async def _extract_search_intent(query: str, history: list) -> str:
    """Use conversation context to build a precise search query for tool lookup."""
    if not history:
        return query

    # Build conversation summary: first user message + last assistant + current query
    first_user = next((m.content for m in history if m.role == "user"), "")
    last_assistant = next((m.content for m in reversed(history) if m.role == "assistant"), "")

    # Always rewrite when there's history — option selections like "Order online for home delivery"
    # look like short queries but carry no context without the conversation around them.
    from app.services.search import _get_client
    try:
        client = _get_client()
        conv_summary = f"Original request: {first_user[:200]}"
        if last_assistant:
            conv_summary += f"\nAssistant asked: {last_assistant[:200]}"
        conv_summary += f"\nUser replied: {query}"

        response = await client.chat.completions.create(
            model=settings.openai_fast_model,
            messages=[
                {"role": "system", "content": (
                    "You extract the RIGHT tool/platform a user needs based on their conversation.\n"
                    "Return ONLY a short search query (3-8 words). Be specific about the domain.\n"
                    "CRITICAL rules:\n"
                    "- 'buy phone online' → 'buy smartphone online Amazon Best Buy electronics'\n"
                    "- 'order food delivery' → 'food delivery DoorDash restaurant'\n"
                    "- 'book flight' → 'flight booking airline tickets'\n"
                    "- 'book hotel' → 'hotel booking accommodation'\n"
                    "- 'book table / reserve restaurant / dine-in reservation' → 'restaurant table reservation OpenTable Resy booking'\n"
                    "- 'order food from restaurant / food delivery' → 'food delivery DoorDash Uber Eats'\n"
                    "- 'find apartment / rent apartment / best apartment / logement / appartement' → 'apartment rental real estate SeLoger BienIci Leboncoin'\n"
                    "- 'apartment in Paris / rent in France / flat to rent' → 'France real estate apartment rental SeLoger PAP'\n"
                    "- If user wants to BUY a PRODUCT (phone, laptop, TV, clothes) → use 'online shopping ecommerce retailer'\n"
                    "- NEVER return 'delivery' alone if the original intent is buying a physical product\n"
                    "- NEVER return food delivery tools when the user wants to BOOK A TABLE (dine-in reservation)\n"
                    "- The query must match the ORIGINAL intent, not just the last reply"
                )},
                {"role": "user", "content": conv_summary},
            ],
            temperature=0,
            max_tokens=30,
        )
        result = (response.choices[0].message.content or "").strip().strip('"')
        if result:
            log.info("Search intent extracted: %r → %r", query, result)
            return result
    except Exception:
        log.exception("Intent extraction failed")
    return query


async def _collect_web_sources(query: str, history: list, images) -> list[dict]:
    """Run web search and collect all sources (for parallel use in 'both' mode)."""
    web_sources: list[dict] = []
    async for _token, sources in ask_web_stream(query, history, images):
        if sources:
            web_sources = sources
    return web_sources


async def _search_for_ask(
    db: AsyncSession, req: AskRequest
) -> list[SearchResultItem]:
    intent = await _extract_search_intent(req.query, req.history or [])
    search_req = SearchRequest(
        intent=intent,
        category=req.category,
        transport=req.transport,
        limit=10,
    )
    search_resp = await search_by_intent(db, search_req)
    return search_resp.results


@router.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest, db: AsyncSession = Depends(get_db)):
    sources = await _search_for_ask(db, req)
    answer = await ask_agentnet(req.query, sources, req.history, req.images or None)

    # Store conversation
    conv = await _get_or_create_conversation(db, req)
    seq = len(req.history) + 1
    db.add(Message(
        conversation_id=conv.id, seq=seq, role="user",
        content=req.query, raw_query=req.query,
        tools_shown={"tools": [s.tool_name for s in sources]},
    ))
    db.add(Message(
        conversation_id=conv.id, seq=seq + 1, role="assistant",
        content=answer,
        tools_shown={"tools": [s.tool_name for s in sources]},
    ))
    await db.commit()

    return AskResponse(query=req.query, answer=answer, sources=sources)


@router.post("/ask/stream")
async def ask_stream(req: AskRequest, db: AsyncSession = Depends(get_db)):
    # ── Web-only mode ──────────────────────────────────────────────
    if req.mode == "web":
        async def web_event_generator():
            async for token, web_sources in ask_web_stream(req.query, req.history, req.images or None):
                if token:
                    yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
                if web_sources:
                    yield f"data: {json.dumps({'type': 'web_sources', 'sources': web_sources})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(web_event_generator(), media_type="text/event-stream")

    # ── Both mode — AgentNet + Web in parallel ─────────────────────
    if req.mode == "both":
        sources = await _search_for_ask(db, req)
        # Kick off web search concurrently
        import asyncio as _asyncio
        web_task = _asyncio.create_task(
            _collect_web_sources(req.query, req.history, req.images or None)
        )

        async def both_event_generator():
            import re as _re
            tag_done = False
            prefix_buf = ""
            async for token in ask_agentnet_stream(req.query, sources, req.history, req.images or None):
                if not tag_done:
                    prefix_buf += token
                    if "]" in prefix_buf or len(prefix_buf) > 20:
                        tag_done = True
                        m = _re.match(r"^\[TOOL:#(\d+)\]\s*", prefix_buf)
                        if m:
                            rank = int(m.group(1))
                            idx = rank - 1
                            if 0 <= idx < len(sources):
                                used = sources[idx]
                                yield f"data: {json.dumps({'type': 'used_tool', 'tool': used.model_dump(mode='json')})}\n\n"
                            prefix_buf = prefix_buf[m.end():]
                        if prefix_buf:
                            yield f"data: {json.dumps({'type': 'token', 'content': prefix_buf})}\n\n"
                        prefix_buf = ""
                    continue
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
            if prefix_buf:
                yield f"data: {json.dumps({'type': 'token', 'content': prefix_buf})}\n\n"

            yield f"data: {json.dumps({'type': 'sources', 'sources': [s.model_dump(mode='json') for s in sources]})}\n\n"

            # Await web results and emit
            web_sources = await web_task
            if web_sources:
                yield f"data: {json.dumps({'type': 'web_sources', 'sources': web_sources})}\n\n"

            yield "data: [DONE]\n\n"

        return StreamingResponse(
            both_event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ── AgentNet mode ──────────────────────────────────────────────
    sources = await _search_for_ask(db, req)

    # Create conversation record before streaming
    conv = await _get_or_create_conversation(db, req)
    seq = len(req.history) + 1
    db.add(Message(
        conversation_id=conv.id, seq=seq, role="user",
        content=req.query, raw_query=req.query,
        tools_shown={"tools": [s.tool_name for s in sources]},
    ))
    await db.commit()

    # We'll collect the full response to save after streaming
    collected_agent: list[str] = []

    async def event_generator():
        import re as _re
        tag_done = False
        prefix_buf = ""

        async for token in ask_agentnet_stream(req.query, sources, req.history, req.images or None):
            if not tag_done:
                prefix_buf += token
                # Wait until we have the closing ] or enough chars to know there's no tag
                if "]" in prefix_buf or len(prefix_buf) > 20:
                    tag_done = True
                    m = _re.match(r"^\[TOOL:#(\d+)\]\s*", prefix_buf)
                    if m:
                        rank = int(m.group(1))
                        idx = rank - 1
                        if 0 <= idx < len(sources):
                            used = sources[idx]
                            yield f"data: {json.dumps({'type': 'used_tool', 'tool': used.model_dump(mode='json')})}\n\n"
                        prefix_buf = prefix_buf[m.end():]
                    if prefix_buf:
                        collected_agent.append(prefix_buf)
                        yield f"data: {json.dumps({'type': 'token', 'content': prefix_buf})}\n\n"
                    prefix_buf = ""
                continue
            collected_agent.append(token)
            yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

        # Flush any remaining prefix buffer (short response with no tag)
        if prefix_buf:
            collected_agent.append(prefix_buf)
            yield f"data: {json.dumps({'type': 'token', 'content': prefix_buf})}\n\n"

        yield f"data: {json.dumps({'type': 'sources', 'sources': [s.model_dump(mode='json') for s in sources]})}\n\n"
        yield "data: [DONE]\n\n"

        # Save assistant message after stream completes
        full_response = "".join(collected_agent)
        db.add(Message(
            conversation_id=conv.id, seq=seq + 1, role="assistant",
            content=full_response,
            tools_shown={"tools": [s.tool_name for s in sources]},
        ))
        await db.commit()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _get_or_create_conversation(db: AsyncSession, req: AskRequest) -> Conversation:
    """Reuse conversation if there's history, otherwise create new."""
    if req.history:
        # Find existing conversation by matching first user message
        first_user = next((m.content for m in req.history if m.role == "user"), None)
        if first_user:
            stmt = (
                select(Conversation)
                .join(Message)
                .where(Message.role == "user", Message.seq == 1, Message.content == first_user)
                .order_by(Conversation.started_at.desc())
                .limit(1)
            )
            result = await db.execute(stmt)
            conv = result.scalar_one_or_none()
            if conv:
                return conv

    conv = Conversation()
    db.add(conv)
    await db.flush()
    return conv


# ── WebMCP ──────────────────────────────────────────────────────


class WebMCPScanRequest(BaseModel):
    url: str


class WebMCPToolDef(BaseModel):
    name: str
    description: str = ""
    input_schema: dict | None = None


class WebMCPRegisterRequest(BaseModel):
    url: str
    provider: str
    tools: list[WebMCPToolDef]


@router.post("/webmcp/scan")
async def webmcp_scan(req: WebMCPScanRequest, db: AsyncSession = Depends(get_db)):
    """Scan a URL for WebMCP tool registrations."""
    import httpx
    from app.crawlers.webmcp import scan_url, ingest_webmcp_tools

    async with httpx.AsyncClient(
        timeout=30.0,
        headers={"User-Agent": "AgentNet-WebMCP-Crawler/0.1"},
        follow_redirects=True,
    ) as client:
        result = await scan_url(client, req.url)

    if not result:
        return {"status": "no_webmcp", "url": req.url, "tools": []}

    tool = await ingest_webmcp_tools(result, session=db)
    await db.commit()

    return {
        "status": "found",
        "url": result["url"],
        "provider": result["provider"],
        "tools_count": result["tools_count"],
        "tools": result["tools"],
        "tool_id": tool.id if tool else None,
    }


@router.post("/webmcp/register")
async def webmcp_register(req: WebMCPRegisterRequest, db: AsyncSession = Depends(get_db)):
    """Manually register WebMCP tools for a website."""
    from app.crawlers.webmcp import register_webmcp_manual

    tools_data = [t.model_dump() for t in req.tools]
    tool = await register_webmcp_manual(db, req.url, req.provider, tools_data)
    await db.commit()

    if not tool:
        return {"status": "error", "message": "Failed to register tools"}

    return {
        "status": "registered",
        "tool_id": tool.id,
        "tool_name": tool.name,
        "actions_count": len(tools_data),
    }


@router.get("/webmcp/tools")
async def list_webmcp_tools(db: AsyncSession = Depends(get_db)):
    """List all indexed WebMCP tools."""
    stmt = (
        select(Tool)
        .where(Tool.transport == "webmcp")
        .options(selectinload(Tool.actions))
        .order_by(Tool.name)
    )
    result = await db.execute(stmt)
    tools = result.scalars().all()

    return [
        {
            "id": t.id,
            "name": t.name,
            "provider": t.provider,
            "page_url": t.page_url,
            "status": t.status,
            "tags": t.tags,
            "actions": [
                {
                    "id": a.id,
                    "name": a.name,
                    "description": a.description,
                    "input_schema": a.input_schema,
                }
                for a in t.actions
            ],
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in tools
    ]


# ── Feedback & Suggestions ──────────────────────────────────────

class FeedbackRequest(BaseModel):
    content: str
    vote: str
    conversation_id: str | None = None


class ToolSuggestionRequest(BaseModel):
    name: str
    url: str = ""
    reason: str = ""
    conversation_id: str | None = None


@router.post("/feedback")
async def submit_feedback(req: FeedbackRequest, db: AsyncSession = Depends(get_db)):
    fb = Feedback(
        message_content=req.content,
        vote=req.vote,
        conversation_id=req.conversation_id,
    )
    db.add(fb)
    await db.commit()
    log.info("Feedback [%s] stored: %s", req.vote, req.content[:80])
    return {"status": "ok", "id": fb.id}


@router.post("/suggestions")
async def suggest_tool(req: ToolSuggestionRequest, db: AsyncSession = Depends(get_db)):
    suggestion = ToolSuggestionModel(
        name=req.name,
        url=req.url,
        reason=req.reason,
        conversation_id=req.conversation_id,
    )
    db.add(suggestion)
    await db.commit()
    log.info("Tool suggestion stored: %s (%s)", req.name, req.url)
    return {"status": "ok", "id": suggestion.id}


# ── Training Data Export ────────────────────────────────────────

@router.get("/training/conversations")
async def list_conversations(
    limit: int = Query(50, le=500),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    """List conversations with message counts for training data review."""
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
            "has_positive_feedback": any(f.vote == "up" for f in c.feedback),
            "has_negative_feedback": any(f.vote == "down" for f in c.feedback),
            "messages": [
                {
                    "seq": m.seq,
                    "role": m.role,
                    "content": m.content,
                    "raw_query": m.raw_query,
                    "tools_shown": m.tools_shown,
                    "tool_selected": m.tool_selected,
                }
                for m in sorted(c.messages, key=lambda x: x.seq)
            ],
        }
        for c in convs
    ]


@router.get("/training/export")
async def export_training_data(
    format: str = Query("jsonl", regex="^(jsonl|openai)$"),
    only_positive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """Export conversations as training data in JSONL or OpenAI fine-tuning format."""
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
            # OpenAI fine-tuning format
            training_messages = []
            for m in msgs:
                training_messages.append({"role": m.role, "content": m.content})
            lines.append(json.dumps({"messages": training_messages}))
        else:
            # Raw JSONL with all metadata
            lines.append(json.dumps({
                "conversation_id": conv.id,
                "started_at": conv.started_at.isoformat() if conv.started_at else None,
                "feedback": [{"vote": f.vote} for f in conv.feedback],
                "messages": [
                    {
                        "role": m.role,
                        "content": m.content,
                        "raw_query": m.raw_query,
                        "tools_shown": m.tools_shown,
                        "tool_selected": m.tool_selected,
                    }
                    for m in msgs
                ],
            }))

    content = "\n".join(lines)
    return StreamingResponse(
        iter([content]),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f"attachment; filename=agentnet_training.{format}"},
    )


# ── Site Registration & Crawl ────────────────────────────────────

class SiteRegisterRequest(BaseModel):
    url: str
    contact_email: str | None = None


@router.post("/sites/register")
async def register_site(req: SiteRegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a website for crawling and indexing on AgentNet."""
    from urllib.parse import urlparse
    parsed = urlparse(req.url)
    if not parsed.scheme or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Invalid URL")

    domain = parsed.netloc.lower().replace("www.", "")

    # Check if already registered
    existing = await db.execute(select(RegisteredSite).where(RegisteredSite.domain == domain))
    site = existing.scalar_one_or_none()

    if site:
        return {
            "status": "already_registered",
            "domain": domain,
            "crawl_status": site.crawl_status,
            "verification_token": site.verification_token,
            "verification_file": f"/.well-known/agentnet.txt",
            "verification_instructions": f"Create a file at https://{domain}/.well-known/agentnet.txt containing: {site.verification_token}",
        }

    site = RegisteredSite(
        domain=domain,
        submitted_url=req.url,
        contact_email=req.contact_email,
        crawl_status="pending",
    )
    db.add(site)
    await db.commit()
    await db.refresh(site)

    log.info("New site registered: %s", domain)
    return {
        "status": "registered",
        "domain": domain,
        "site_id": site.id,
        "crawl_status": site.crawl_status,
        "verification_token": site.verification_token,
        "verification_file": "/.well-known/agentnet.txt",
        "verification_instructions": f"Create a file at https://{domain}/.well-known/agentnet.txt containing: {site.verification_token}",
        "message": "Your site has been queued for crawling. Results will appear within minutes.",
    }


@router.get("/sites/{domain}/status")
async def site_status(domain: str, db: AsyncSession = Depends(get_db)):
    """Check the crawl status for a registered domain."""
    domain = domain.lower().replace("www.", "")
    result = await db.execute(select(RegisteredSite).where(RegisteredSite.domain == domain))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Domain not registered")

    return {
        "domain": site.domain,
        "verified": site.verified,
        "crawl_status": site.crawl_status,
        "crawl_error": site.crawl_error,
        "last_crawled_at": site.last_crawled_at.isoformat() if site.last_crawled_at else None,
        "next_crawl_at": site.next_crawl_at.isoformat() if site.next_crawl_at else None,
        "discovered_actions_count": site.discovered_actions_count,
        "discovered_tool_id": site.discovered_tool_id,
        "verification_token": site.verification_token,
    }


@router.get("/sites")
async def list_registered_sites(
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List all registered sites."""
    result = await db.execute(
        select(RegisteredSite).order_by(RegisteredSite.created_at.desc()).limit(limit)
    )
    sites = result.scalars().all()
    return [
        {
            "domain": s.domain,
            "verified": s.verified,
            "crawl_status": s.crawl_status,
            "discovered_actions_count": s.discovered_actions_count,
            "last_crawled_at": s.last_crawled_at.isoformat() if s.last_crawled_at else None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in sites
    ]


@router.get("/training/suggestions")
async def list_suggestions(
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
):
    """List all tool suggestions from users."""
    stmt = select(ToolSuggestionModel).order_by(ToolSuggestionModel.created_at.desc()).limit(limit)
    result = await db.execute(stmt)
    suggestions = result.scalars().all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "url": s.url,
            "reason": s.reason,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in suggestions
    ]
