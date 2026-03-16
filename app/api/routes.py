import json
import logging
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user_optional, get_db
from app.models.user import User
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
    DocumentInput,
    SearchRequest,
    SearchResponse,
    SearchResultItem,
)
from app.schemas.tool import ActionOut, ToolDetailOut, ToolOut
from app.services.documents import extract_text, is_gemini_native, is_text_file
from app.services.enrichment import enrich_table
from app.services.calendar import (
    create_event,
    find_free_slots,
    list_calendars,
    list_events,
)
from app.services.contacts import get_user_profile, list_contacts
from app.services.drive import get_file_metadata, list_files, search_files
from app.services.gmail import create_draft
from app.services.llm import ask_agentnet, ask_agentnet_stream, ask_web_stream
from app.services.oauth import decrypt_token, refresh_google_token
from app.services.sheets import (
    append_rows,
    create_spreadsheet,
    get_spreadsheet,
    read_range,
    write_range,
)
from app.services.search import search_by_intent
from app.services.url_fetcher import extract_urls, fetch_urls_content
from app.services.artifacts import (
    ARTIFACTS_DIR,
    detect_artifact_intent,
    generate_document_artifact,
    generate_slides_artifact,
    DOCUMENT_INSTRUCTIONS,
    SLIDES_INSTRUCTIONS,
    SHEET_INSTRUCTIONS,
)

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


async def _collect_web_sources(
    query: str, history: list, images, doc_context: str = "", binary_docs=None,
) -> list[dict]:
    """Run web search and collect all sources (for parallel use in 'both' mode)."""
    web_sources: list[dict] = []
    async for _token, sources in ask_web_stream(
        query, history, images, doc_context=doc_context, binary_docs=binary_docs,
    ):
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


async def _fetch_url_context(query: str) -> tuple[str, list[dict]]:
    """Detect URLs in query, fetch content, return (context_string, metadata)."""
    urls = extract_urls(query)
    if not urls:
        return "", []

    results = await fetch_urls_content(urls)
    context_parts: list[str] = []
    metadata: list[dict] = []
    for r in results:
        if r["content"]:
            context_parts.append(f"## Content from {r['url']}\n\n{r['content']}")
            metadata.append({"url": r["url"], "title": r["title"], "status": "ok"})
        elif r["error"]:
            metadata.append({"url": r["url"], "title": r["url"], "status": "error", "error": r["error"]})

    url_context = "\n\n---\n\n".join(context_parts) if context_parts else ""
    return url_context, metadata


async def _process_documents(
    documents: list[DocumentInput],
) -> tuple[str, list[DocumentInput]]:
    """Process uploaded documents.

    Returns (doc_text_context, binary_docs_for_gemini).
    - doc_text_context: extracted text to include in the prompt
    - binary_docs_for_gemini: PDF/image docs to send as binary parts
    """
    doc_context_parts: list[str] = []
    binary_docs: list[DocumentInput] = []

    for doc in documents:
        fname = doc.filename or "document"

        # If frontend already extracted text (for text files)
        if doc.text_content:
            doc_context_parts.append(f"## {fname}\n{doc.text_content[:15000]}")
            continue

        # PDF — send as binary to Gemini (it handles PDF natively)
        # Also try to extract text for richer context
        if doc.mime_type == "application/pdf":
            text = await extract_text(doc.base64, doc.mime_type, doc.filename)
            if text.strip():
                doc_context_parts.append(f"## {fname}\n{text[:15000]}")
            else:
                binary_docs.append(doc)
            continue

        # DOCX, TXT, CSV, etc. — extract text
        if is_text_file(doc.mime_type, doc.filename):
            try:
                import base64 as b64
                raw = b64.b64decode(doc.base64)
                text = raw.decode("utf-8", errors="replace")
                doc_context_parts.append(f"## {fname}\n{text[:15000]}")
            except Exception:
                pass
            continue

        # Try generic text extraction
        text = await extract_text(doc.base64, doc.mime_type, doc.filename)
        if text.strip():
            doc_context_parts.append(f"## {fname}\n{text[:15000]}")
        elif is_gemini_native(doc.mime_type):
            binary_docs.append(doc)

    doc_context = "\n\n---\n\n".join(doc_context_parts) if doc_context_parts else ""
    return doc_context, binary_docs


@router.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest, db: AsyncSession = Depends(get_db), user: User | None = Depends(get_current_user_optional)):
    sources = await _search_for_ask(db, req)
    answer = await ask_agentnet(req.query, sources, req.history, req.images or None)

    # Store conversation
    conv = await _get_or_create_conversation(db, req, user)
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


async def _try_google_calendar(request: Request, db: AsyncSession) -> str | None:
    """Try to fetch Google Calendar events. Returns context string or None."""
    try:
        from app.api.session_utils import get_or_create_session
        from app.models.user import OAuthConnection

        session = await get_or_create_session(request, Response(), db)
        if not session:
            return None

        result = await db.execute(
            select(OAuthConnection).where(
                OAuthConnection.session_id == session.id,
                OAuthConnection.provider == "google",
            )
        )
        conn = result.scalar_one_or_none()
        if not conn:
            return None

        # Get valid token (refresh if needed)
        from datetime import timezone
        from app.services.oauth import encrypt_token

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if conn.token_expires_at and conn.token_expires_at < now:
            if not conn.refresh_token_enc:
                return None
            refresh_tok = decrypt_token(conn.refresh_token_enc)
            new_tokens = await refresh_google_token(refresh_tok)
            conn.access_token_enc = encrypt_token(new_tokens["access_token"])
            conn.token_expires_at = now + timedelta(seconds=new_tokens.get("expires_in", 3600))
            await db.commit()
            token = new_tokens["access_token"]
        else:
            token = decrypt_token(conn.access_token_enc)

        events = await list_events(token, days_ahead=3, max_results=15)
        if not events:
            return "### Google Calendar: No upcoming events in the next 3 days."

        lines = ["### Google Calendar — Upcoming Events"]
        for e in events:
            start = e.get("start", "")
            end = e.get("end", "")
            line = f"- **{e['summary']}** | {start} → {end}"
            if e.get("location"):
                line += f" | Location: {e['location']}"
            if e.get("attendees"):
                line += f" | Attendees: {', '.join(e['attendees'][:3])}"
            lines.append(line)
        return "\n".join(lines)
    except Exception as e:
        log.debug("Google Calendar not available: %s", e)
        return None


async def _maybe_gather_context(query: str, request: Request | None = None, db: AsyncSession | None = None) -> str:
    """Gather context from connected services (Google Calendar, Apple, etc.)."""
    q = query.lower()
    keywords_calendar = ["calendar", "schedule", "meeting", "event", "today", "tomorrow", "agenda", "what's on", "whats on", "busy", "free time", "availability"]
    keywords_reminder = ["reminder", "task", "todo", "to-do", "to do"]
    keywords_message = ["message", "imessage", "text", "sms", "iphone", "texts"]
    keywords_notes = ["note", "notes"]

    need_calendar = any(kw in q for kw in keywords_calendar)
    need_reminders = any(kw in q for kw in keywords_reminder)
    need_messages = any(kw in q for kw in keywords_message)
    need_notes = any(kw in q for kw in keywords_notes)

    if not (need_calendar or need_reminders or need_messages or need_notes):
        return ""

    parts: list[str] = []
    from app.services.apple import (
        apple_calendar_list_events,
        apple_notes_list,
        apple_reminders_list,
        imessage_recent,
    )

    now_str = datetime.now().strftime("%A, %B %d, %Y at %I:%M %p")
    parts.append(f"## Live Context (current time: {now_str})\n")

    if need_calendar:
        # Try Google Calendar first, fall back to Apple Calendar
        gcal_ctx = None
        got_calendar_data = False
        if request and db:
            gcal_ctx = await _try_google_calendar(request, db)

        if gcal_ctx:
            parts.append(gcal_ctx)
            parts.append("")
            got_calendar_data = True
        else:
            try:
                events = await apple_calendar_list_events(days_ahead=3)
                if events:
                    parts.append("### Upcoming Calendar Events")
                    for e in events[:12]:
                        line = f"- **{e['title']}** | {e['start']} → {e['end']}"
                        if e.get("location"):
                            line += f" | Location: {e['location']}"
                        if e.get("calendar"):
                            line += f" | Calendar: {e['calendar']}"
                        parts.append(line)
                    got_calendar_data = True
                else:
                    parts.append("### Calendar: No upcoming events in the next 3 days.")
                    got_calendar_data = True
                parts.append("")
            except Exception as e:
                log.warning("Failed to fetch Apple calendar: %s", e)

        if not got_calendar_data:
            parts.append("### Calendar: NOT CONNECTED — The user has NOT connected their Google Calendar. You do NOT have access to their calendar data. Tell the user to sign in with Google (top-right button) to connect their calendar. Do NOT fabricate or simulate calendar data.")
            parts.append("")

    if need_reminders:
        try:
            reminders = await apple_reminders_list()
            if reminders:
                parts.append("### Pending Reminders")
                for r in reminders[:12]:
                    due = f" (due: {r['due_date']})" if r.get("due_date") else ""
                    parts.append(f"- {r['name']}{due}")
            else:
                parts.append("### Reminders: No pending reminders.")
            parts.append("")
        except Exception as e:
            log.warning("Failed to fetch Apple reminders: %s", e)

    if need_messages:
        try:
            messages = await imessage_recent(hours=24, limit=20)
            if messages:
                parts.append("### Recent Messages (last 24h)")
                for m in messages[:15]:
                    sender = "Me" if m["from"] == "me" else m["from"]
                    parts.append(f"- [{m['time']}] {sender}: {m['text'][:120]}")
            else:
                parts.append("### Messages: No recent messages.")
            parts.append("")
        except Exception as e:
            log.warning("Failed to fetch iMessages: %s", e)

    if need_notes:
        try:
            notes = await apple_notes_list(limit=8)
            if notes:
                parts.append("### Recent Notes")
                for n in notes[:8]:
                    parts.append(f"- **{n['title']}** (modified: {n['modified']})")
            parts.append("")
        except Exception as e:
            log.warning("Failed to fetch Apple notes: %s", e)

    return "\n".join(parts)


# ── Artifact file serving ─────────────────────────────────────────
@router.get("/artifacts/{artifact_id}/{filename}")
async def serve_artifact(artifact_id: str, filename: str):
    """Serve a generated artifact file (document, slides, sheet)."""
    from fastapi.responses import FileResponse
    import mimetypes

    file_path = ARTIFACTS_DIR / artifact_id / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found")

    # Security: prevent path traversal
    try:
        file_path.resolve().relative_to(ARTIFACTS_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    mime, _ = mimetypes.guess_type(str(file_path))
    return FileResponse(
        path=str(file_path),
        media_type=mime or "application/octet-stream",
        filename=filename,
    )


@router.post("/ask/stream")
async def ask_stream(request: Request, req: AskRequest, db: AsyncSession = Depends(get_db), user: User | None = Depends(get_current_user_optional)):
    # ── Fetch URL content (all modes) ─────────────────────────────
    url_context, url_metadata = await _fetch_url_context(req.query)

    # ── Process uploaded documents ────────────────────────────────
    doc_context = ""
    binary_docs = None
    if req.documents:
        doc_context, binary_docs = await _process_documents(req.documents)
        binary_docs = binary_docs or None

    # ── Inject persistent memories ─────────────────────────────────
    if user:
        try:
            from app.services.memory import inject_memories
            memory_context = await inject_memories(user.id, req.query)
            if memory_context:
                doc_context = (doc_context + "\n\n" + memory_context) if doc_context else memory_context
        except Exception as _mem_err:
            log.warning("Failed to inject memories: %s", _mem_err)

    # ── Inject email digest when relevant ──────────────────────────
    email_keywords = ["email", "inbox", "gmail", "mail", "unread", "urgent email", "messages"]
    if user and any(kw in req.query.lower() for kw in email_keywords):
        try:
            from app.services.email_intel import get_latest_digest
            digest = await get_latest_digest(user.id)
            if digest:
                email_ctx = f"LATEST INBOX DIGEST ({digest['emails_processed']} emails, {digest['urgent_count']} urgent):\n{digest['summary_text']}"
                doc_context = (doc_context + "\n\n" + email_ctx) if doc_context else email_ctx
        except Exception as _email_err:
            log.warning("Failed to inject email digest: %s", _email_err)

    # ── Inject meeting debriefs when relevant ───────────────────────
    meeting_keywords = ["meeting", "debrief", "follow-up", "follow up", "action items", "post-meeting"]
    if user and any(kw in req.query.lower() for kw in meeting_keywords):
        try:
            from app.services.meeting_intel import list_debriefs
            debriefs = await list_debriefs(user.id, limit=5)
            if debriefs:
                meeting_ctx = "RECENT MEETING DEBRIEFS:\n"
                for d in debriefs[:3]:
                    meeting_ctx += f"- {d['event_title']} ({d['event_start'] or 'unknown time'}): {len(d['action_items'])} action items\n"
                doc_context = (doc_context + "\n\n" + meeting_ctx) if doc_context else meeting_ctx
        except Exception as _meet_err:
            log.warning("Failed to inject meeting context: %s", _meet_err)

    # ── Inject live context (Google Calendar, Apple, etc.) ─────────
    live_context = await _maybe_gather_context(req.query, request, db)
    if live_context:
        doc_context = (doc_context + "\n\n" + live_context) if doc_context else live_context

    # ── Helper: emit activity event ─────────────────────────────────
    def _activity(action: str, status: str, detail: str = "") -> str:
        return f"data: {json.dumps({'type': 'activity', 'action': action, 'status': status, 'detail': detail})}\n\n"

    # ── Helper: emit tab title event ──────────────────────────────
    def _tab_title(query: str) -> str:
        """Generate a short descriptive title from the user query."""
        q = query.strip()
        # Remove filler words at the start
        import re as _re2
        q = _re2.sub(r'^(can you |please |hey |hi |help me |i want to |i need to |make me |give me |find me |create |build |generate )', '', q, flags=_re2.IGNORECASE).strip()
        # Capitalize first letter, limit to 35 chars
        if len(q) > 35:
            q = q[:32].rsplit(" ", 1)[0] + "…"
        return f"data: {json.dumps({'type': 'tab_title', 'title': q[:1].upper() + q[1:] if q else 'Chat'})}\n\n"

    # ── Web-only mode ──────────────────────────────────────────────
    if req.mode == "web":
        async def web_event_generator():
            yield _tab_title(req.query)
            if url_metadata:
                yield f"data: {json.dumps({'type': 'url_sources', 'sources': url_metadata})}\n\n"
            yield _activity("web_search", "running", f"Searching the web for \"{req.query[:60]}\"")
            async for token, web_sources in ask_web_stream(
                req.query, req.history, req.images or None,
                url_context=url_context, doc_context=doc_context, binary_docs=binary_docs,
            ):
                if token:
                    yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
                if web_sources:
                    yield _activity("web_search", "done", f"Found {len(web_sources)} sources")
                    yield f"data: {json.dumps({'type': 'web_sources', 'sources': web_sources})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(web_event_generator(), media_type="text/event-stream")

    # ── Both mode — AgentNet + Web in parallel ─────────────────────
    if req.mode == "both":
        async def both_event_generator():
            yield _tab_title(req.query)
            if url_metadata:
                yield f"data: {json.dumps({'type': 'url_sources', 'sources': url_metadata})}\n\n"

            # Step 1: Search tools
            yield _activity("tool_search", "running", "Searching AgentNet tools…")
            sources = await _search_for_ask(db, req)
            yield _activity("tool_search", "done", f"Found {len(sources)} tools")

            # Step 2: Kick off web search concurrently
            import asyncio as _asyncio
            yield _activity("web_search", "running", f"Searching the web…")
            web_task = _asyncio.create_task(
                _collect_web_sources(
                    req.query, req.history, req.images or None,
                    doc_context=doc_context, binary_docs=binary_docs,
                )
            )

            # Step 3: Stream LLM response
            yield _activity("thinking", "running", "Generating response…")
            import re as _re
            tag_done = False
            prefix_buf = ""
            skill_instructions = [(s.name, s.instructions) for s in req.enabled_skills if s.instructions.strip()] or None
            async for token in ask_agentnet_stream(
                req.query, sources, req.history, req.images or None,
                url_context=url_context, doc_context=doc_context, binary_docs=binary_docs,
                skill_instructions=skill_instructions,
            ):
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
                yield _activity("web_search", "done", f"Found {len(web_sources)} web sources")
                yield f"data: {json.dumps({'type': 'web_sources', 'sources': web_sources})}\n\n"

            yield "data: [DONE]\n\n"

        return StreamingResponse(
            both_event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ── AgentNet mode ──────────────────────────────────────────────

    # Detect artifact intent (document, slides, sheet)
    artifact_type = detect_artifact_intent(req.query)

    # We'll collect the full response to save after streaming
    collected_agent: list[str] = []

    async def event_generator():
        yield _tab_title(req.query)

        if url_metadata:
            yield f"data: {json.dumps({'type': 'url_sources', 'sources': url_metadata})}\n\n"

        # Step 1: Search AgentNet tools
        yield _activity("tool_search", "running", "Searching AgentNet tools…")
        sources = await _search_for_ask(db, req)
        yield _activity("tool_search", "done", f"Found {len(sources)} tools")

        # Create conversation record
        conv = await _get_or_create_conversation(db, req, user)
        seq = len(req.history) + 1
        db.add(Message(
            conversation_id=conv.id, seq=seq, role="user",
            content=req.query, raw_query=req.query,
            tools_shown={"tools": [s.tool_name for s in sources]},
        ))
        await db.commit()

        # Step 2: Stream LLM response
        yield _activity("thinking", "running", "Generating response…")
        import re as _re
        tag_done = False
        prefix_buf = ""

        # Inject artifact-specific instructions as a skill
        skill_instructions2 = [(s.name, s.instructions) for s in req.enabled_skills if s.instructions.strip()] or []
        if artifact_type == "document":
            skill_instructions2.append(("Document Generator", DOCUMENT_INSTRUCTIONS))
        elif artifact_type == "slides":
            skill_instructions2.append(("Slides Generator", SLIDES_INSTRUCTIONS))
        elif artifact_type == "sheet":
            skill_instructions2.append(("Sheet Generator", SHEET_INSTRUCTIONS))

        async for token in ask_agentnet_stream(
            req.query, sources, req.history, req.images or None,
            url_context=url_context, doc_context=doc_context, binary_docs=binary_docs,
            skill_instructions=skill_instructions2 or None,
        ):
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

        # ── Generate artifact files from streamed content ──────────
        if artifact_type in ("document", "slides"):
            yield _activity("generating", "running", f"Creating {artifact_type} files…")
            full_content = "".join(collected_agent)
            try:
                artifact_info = None
                if artifact_type == "document":
                    artifact_info = generate_document_artifact(full_content)
                elif artifact_type == "slides":
                    artifact_info = generate_slides_artifact(full_content)

                if artifact_info:
                    yield _activity("generating", "done", f"{artifact_type.title()} created")
                    yield f"data: {json.dumps({'type': 'artifact', **artifact_info})}\n\n"
            except Exception as _art_err:
                log.warning("Artifact generation failed: %s", _art_err)

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


async def _get_or_create_conversation(db: AsyncSession, req: AskRequest, user: User | None = None) -> Conversation:
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
                # Backfill user_id if missing
                if user and not conv.user_id:
                    conv.user_id = user.id
                return conv

    # Auto-title from the query (first 80 chars)
    title = req.query[:80].strip() if req.query else None

    conv = Conversation(
        user_id=user.id if user else None,
        title=title,
    )
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


# ── Temporary CSV storage (for Google Sheets export) ────────────

_temp_csvs: dict[str, dict] = {}
_TEMP_CSV_TTL = timedelta(minutes=10)


def _cleanup_temp_csvs():
    """Remove expired temp CSV entries."""
    cutoff = datetime.utcnow() - _TEMP_CSV_TTL
    expired = [k for k, v in _temp_csvs.items() if v["created"] < cutoff]
    for k in expired:
        del _temp_csvs[k]


class TempCsvRequest(BaseModel):
    csv: str


@router.post("/temp-csv")
async def create_temp_csv(body: TempCsvRequest, request: Request):
    """Store CSV data temporarily and return a URL to access it."""
    _cleanup_temp_csvs()
    csv_id = uuid.uuid4().hex[:10]
    _temp_csvs[csv_id] = {"data": body.csv, "created": datetime.utcnow()}

    # Build public URL from request
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("host", "localhost:8000")
    url = f"{scheme}://{host}/v1/temp-csv/{csv_id}"
    return {"id": csv_id, "url": url}


@router.get("/temp-csv/{csv_id}")
async def get_temp_csv(csv_id: str):
    """Serve a temporarily stored CSV file."""
    entry = _temp_csvs.get(csv_id)
    if not entry:
        raise HTTPException(status_code=404, detail="CSV not found or expired")
    return Response(
        content=entry["data"],
        media_type="text/csv",
        headers={
            "Content-Disposition": f'inline; filename="data-{csv_id}.csv"',
            "Access-Control-Allow-Origin": "*",
        },
    )


# ── Table Enrichment (real data via Hunter.io/Tavily) ────────────

class EnrichTableRequest(BaseModel):
    columns: list[str]
    rows: list[list]
    add_columns: list[str]


@router.post("/enrich-table")
async def enrich_table_endpoint(body: EnrichTableRequest):
    """Enrich table rows with real data from Hunter.io / Tavily web search."""
    result = await enrich_table(body.columns, body.rows, body.add_columns)
    return result


# ── Gmail Drafts ─────────────────────────────────────────────────

class GmailDraftRequest(BaseModel):
    to: str
    subject: str
    body: str


@router.post("/gmail/drafts")
async def create_gmail_draft(
    body: GmailDraftRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a draft email in the user's Gmail account."""
    from app.api.session_utils import get_or_create_session
    from app.models.user import OAuthConnection

    session = await get_or_create_session(request, None, db)
    if not session:
        raise HTTPException(status_code=401, detail="No session found")

    # Find Gmail OAuth connection for this session
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.session_id == session.id,
            OAuthConnection.provider == "google",
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(
            status_code=401,
            detail="Gmail not connected. Please connect your Gmail account first.",
        )

    try:
        token = decrypt_token(conn.access_token_enc)
    except Exception:
        raise HTTPException(status_code=401, detail="Failed to decrypt token")

    try:
        draft = await create_draft(token, body.to, body.subject, body.body)
        return {**draft, "gmail_url": "https://mail.google.com/mail/u/0/#drafts"}
    except Exception:
        log.exception("Failed to create Gmail draft")
        raise HTTPException(status_code=500, detail="Failed to create Gmail draft")


# ── Document Parsing ──────────────────────────────────────────────

class ParseDocumentRequest(BaseModel):
    base64: str
    mime_type: str
    filename: str = ""


@router.post("/parse-document")
async def parse_document(body: ParseDocumentRequest):
    """Extract text from an uploaded document (PDF, DOCX, TXT, etc.)."""
    text = await extract_text(body.base64, body.mime_type, body.filename)
    return {"text": text, "filename": body.filename}


# ── Shared: Google OAuth token helper ─────────────────────────────

async def _get_google_token(request: Request, db: AsyncSession) -> str:
    """Extract a valid Google access token from the current session.

    Raises HTTPException 401 if not connected or token is invalid.
    Automatically refreshes the token if it's expired.
    """
    from app.api.session_utils import get_or_create_session
    from app.models.user import OAuthConnection

    session = await get_or_create_session(request, Response(), db)
    if not session:
        raise HTTPException(status_code=401, detail="No session found")

    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.session_id == session.id,
            OAuthConnection.provider == "google",
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(
            status_code=401,
            detail="Google account not connected. Please connect first.",
        )

    # Check if token is expired and try to refresh
    from datetime import datetime, timezone, timedelta
    from app.services.oauth import encrypt_token

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if conn.token_expires_at and conn.token_expires_at < now:
        if not conn.refresh_token_enc:
            raise HTTPException(
                status_code=401,
                detail="Token expired and no refresh token available. Please reconnect.",
            )
        try:
            refresh_tok = decrypt_token(conn.refresh_token_enc)
            new_tokens = await refresh_google_token(refresh_tok)
            conn.access_token_enc = encrypt_token(new_tokens["access_token"])
            conn.token_expires_at = now + timedelta(seconds=new_tokens.get("expires_in", 3600))
            await db.commit()
            return new_tokens["access_token"]
        except Exception:
            log.exception("Failed to refresh Google token")
            raise HTTPException(
                status_code=401,
                detail="Failed to refresh token. Please reconnect your Google account.",
            )

    try:
        return decrypt_token(conn.access_token_enc)
    except Exception:
        raise HTTPException(status_code=401, detail="Failed to decrypt token")


# ── Google Calendar ───────────────────────────────────────────────

@router.get("/calendar/calendars")
async def api_list_calendars(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List all calendars for the connected Google account."""
    token = await _get_google_token(request, db)
    return await list_calendars(token)


@router.get("/calendar/events")
async def api_list_events(
    request: Request,
    calendar_id: str = Query("primary"),
    days_ahead: int = Query(7, ge=1, le=90),
    max_results: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List upcoming events from a calendar."""
    token = await _get_google_token(request, db)
    return await list_events(token, calendar_id, days_ahead, max_results)


class CreateEventRequest(BaseModel):
    summary: str
    start: str
    end: str
    description: str = ""
    location: str = ""
    attendees: list[str] | None = None
    calendar_id: str = "primary"
    send_notifications: bool = True


@router.post("/calendar/events")
async def api_create_event(
    body: CreateEventRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new calendar event."""
    token = await _get_google_token(request, db)
    return await create_event(
        token,
        summary=body.summary,
        start=body.start,
        end=body.end,
        description=body.description,
        location=body.location,
        attendees=body.attendees,
        calendar_id=body.calendar_id,
        send_notifications=body.send_notifications,
    )


@router.get("/calendar/free-busy")
async def api_free_busy(
    request: Request,
    days_ahead: int = Query(7, ge=1, le=30),
    calendar_id: str = Query("primary"),
    db: AsyncSession = Depends(get_db),
):
    """Get free/busy information for a calendar."""
    token = await _get_google_token(request, db)
    return await find_free_slots(token, days_ahead, calendar_id)


# ── Google Contacts ───────────────────────────────────────────────

@router.get("/contacts")
async def api_list_contacts(
    request: Request,
    query: str | None = Query(None),
    page_size: int = Query(50, ge=1, le=100),
    page_token: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List or search contacts from Google Contacts."""
    token = await _get_google_token(request, db)
    return await list_contacts(token, page_size, page_token, query)


@router.get("/contacts/me")
async def api_user_profile(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get the authenticated user's own profile info."""
    token = await _get_google_token(request, db)
    return await get_user_profile(token)


# ── Google Drive ──────────────────────────────────────────────────

@router.get("/drive/files")
async def api_list_drive_files(
    request: Request,
    query: str | None = Query(None),
    mime_type: str | None = Query(None),
    page_size: int = Query(20, ge=1, le=100),
    page_token: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List files in Google Drive. Optionally filter by name or mime type."""
    token = await _get_google_token(request, db)
    return await list_files(token, query, page_size, page_token, mime_type)


@router.get("/drive/files/{file_id}")
async def api_get_drive_file(
    file_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get metadata for a single Drive file."""
    token = await _get_google_token(request, db)
    return await get_file_metadata(token, file_id)


@router.get("/drive/search")
async def api_search_drive(
    request: Request,
    query: str = Query(...),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Full-text search across Google Drive files."""
    token = await _get_google_token(request, db)
    return await search_files(token, query, page_size)


# ── Google Sheets ─────────────────────────────────────────────────

@router.get("/sheets/{spreadsheet_id}")
async def api_get_spreadsheet(
    spreadsheet_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get spreadsheet metadata (title, sheet list)."""
    token = await _get_google_token(request, db)
    return await get_spreadsheet(token, spreadsheet_id)


@router.get("/sheets/{spreadsheet_id}/values/{range_notation:path}")
async def api_read_sheet_range(
    spreadsheet_id: str,
    range_notation: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Read values from a spreadsheet range (e.g. Sheet1!A1:Z100)."""
    token = await _get_google_token(request, db)
    return await read_range(token, spreadsheet_id, range_notation)


class WriteSheetRequest(BaseModel):
    range: str
    values: list[list]


@router.put("/sheets/{spreadsheet_id}/values")
async def api_write_sheet_range(
    spreadsheet_id: str,
    body: WriteSheetRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Write values to a spreadsheet range."""
    token = await _get_google_token(request, db)
    return await write_range(token, spreadsheet_id, body.range, body.values)


class AppendSheetRequest(BaseModel):
    range: str
    values: list[list]


@router.post("/sheets/{spreadsheet_id}/append")
async def api_append_sheet_rows(
    spreadsheet_id: str,
    body: AppendSheetRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Append rows to a spreadsheet."""
    token = await _get_google_token(request, db)
    return await append_rows(token, spreadsheet_id, body.range, body.values)


class CreateSpreadsheetRequest(BaseModel):
    title: str
    sheet_titles: list[str] | None = None


@router.post("/sheets")
async def api_create_spreadsheet(
    body: CreateSpreadsheetRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new Google Spreadsheet."""
    token = await _get_google_token(request, db)
    return await create_spreadsheet(token, body.title, body.sheet_titles)


# ── Person Intelligence ──────────────────────────────────────────

class PersonResearchRequest(BaseModel):
    name: str
    company: str = ""
    role: str = ""
    topics: list[str] | None = None


@router.post("/person/research")
async def api_research_person(body: PersonResearchRequest):
    """Research a person's recent activities and generate intel."""
    from app.services.person_intel import research_person
    result = await research_person(body.name, body.company, body.role, body.topics)
    return result


# ── Follow-Up Sequences ──────────────────────────────────────────

class FollowUpStepInput(BaseModel):
    step_order: int
    step_type: str  # email, linkedin, reminder, call
    delay_days: int = 0
    subject: str = ""
    body: str = ""


class CreateFollowUpRequest(BaseModel):
    name: str
    email: str = ""
    company: str = ""
    title: str = ""
    linkedin: str = ""
    notes: str = ""
    intel_summary: str = ""
    steps: list[FollowUpStepInput] = []


@router.post("/followups")
async def api_create_followup(
    body: CreateFollowUpRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a tracked person with a follow-up sequence."""
    from app.api.session_utils import get_or_create_session
    from app.models.followup import FollowUpStep, TrackedPerson

    session = await get_or_create_session(request, Response(), db)
    person = TrackedPerson(
        session_id=session.id,
        name=body.name,
        email=body.email,
        company=body.company,
        title=body.title,
        linkedin=body.linkedin,
        notes=body.notes,
        intel_summary=body.intel_summary,
    )
    db.add(person)
    await db.flush()

    # Add steps with scheduled dates
    from datetime import timedelta
    prev_date = datetime.utcnow()
    for s in body.steps:
        scheduled = prev_date + timedelta(days=s.delay_days)
        step = FollowUpStep(
            person_id=person.id,
            step_order=s.step_order,
            step_type=s.step_type,
            delay_days=s.delay_days,
            subject=s.subject,
            body=s.body,
            status="pending",
            scheduled_at=scheduled,
        )
        db.add(step)
        prev_date = scheduled

    await db.commit()
    return {
        "id": person.id,
        "name": person.name,
        "company": person.company,
        "steps_count": len(body.steps),
        "status": "created",
    }


@router.get("/followups")
async def api_list_followups(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List all tracked people + follow-up sequences for the current session."""
    from app.api.session_utils import get_or_create_session
    from app.models.followup import FollowUpStep, TrackedPerson

    session = await get_or_create_session(request, Response(), db)
    result = await db.execute(
        select(TrackedPerson)
        .where(TrackedPerson.session_id == session.id)
        .order_by(TrackedPerson.created_at.desc())
    )
    people = result.scalars().all()

    output = []
    for p in people:
        # Load steps
        steps_result = await db.execute(
            select(FollowUpStep)
            .where(FollowUpStep.person_id == p.id)
            .order_by(FollowUpStep.step_order)
        )
        steps = steps_result.scalars().all()
        output.append({
            "id": p.id,
            "name": p.name,
            "email": p.email,
            "company": p.company,
            "title": p.title,
            "linkedin": p.linkedin,
            "intel_summary": p.intel_summary,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "steps": [
                {
                    "id": s.id,
                    "order": s.step_order,
                    "type": s.step_type,
                    "delay_days": s.delay_days,
                    "status": s.status,
                    "subject": s.subject,
                    "body": s.body,
                    "scheduled_at": s.scheduled_at.isoformat() if s.scheduled_at else None,
                    "completed_at": s.completed_at.isoformat() if s.completed_at else None,
                }
                for s in steps
            ],
        })

    return output


class UpdateStepRequest(BaseModel):
    status: str  # "sent", "skipped", "pending"


@router.patch("/followups/{person_id}/steps/{step_id}")
async def api_update_step(
    person_id: str,
    step_id: str,
    body: UpdateStepRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update a follow-up step status (e.g., mark as sent)."""
    from app.models.followup import FollowUpStep

    result = await db.execute(
        select(FollowUpStep).where(
            FollowUpStep.id == step_id,
            FollowUpStep.person_id == person_id,
        )
    )
    step = result.scalar_one_or_none()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    step.status = body.status
    if body.status == "sent":
        step.completed_at = datetime.utcnow()
    await db.commit()
    return {"id": step.id, "status": step.status}
