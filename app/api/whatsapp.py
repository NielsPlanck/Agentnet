"""WhatsApp API — connect, list chats, read messages, send messages."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.deps import get_current_user_required
from app.models.user import User
from app.services.whatsapp import (
    close_whatsapp_session,
    get_whatsapp_session,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/whatsapp", tags=["whatsapp"])


# ── Schemas ──────────────────────────────────────────────────────────

class SendMessageRequest(BaseModel):
    chat_name: str
    message: str


class SummarizeChatRequest(BaseModel):
    chat_name: str
    limit: int = 30


# ── Endpoints ────────────────────────────────────────────────────────

@router.post("/connect")
async def api_connect_whatsapp(
    user: User = Depends(get_current_user_required),
):
    """Start WhatsApp session and return QR screenshot for authentication."""
    try:
        session = await get_whatsapp_session(user.id)
        authenticated = await session.is_authenticated()

        if authenticated:
            return {"status": "authenticated", "qr_needed": False}

        # Return QR code screenshot
        qr = await session.get_qr_screenshot()
        return {"status": "needs_qr", "qr_needed": True, "qr_screenshot": qr}
    except Exception as e:
        log.error("Failed to start WhatsApp session: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to start WhatsApp: {str(e)}")


@router.get("/status")
async def api_whatsapp_status(
    user: User = Depends(get_current_user_required),
):
    """Check WhatsApp connection status."""
    try:
        session = await get_whatsapp_session(user.id)
        authenticated = await session.is_authenticated()
        return {"status": "authenticated" if authenticated else "needs_qr", "connected": authenticated}
    except Exception:
        return {"status": "disconnected", "connected": False}


@router.get("/qr")
async def api_get_qr(
    user: User = Depends(get_current_user_required),
):
    """Get current QR code screenshot."""
    try:
        session = await get_whatsapp_session(user.id)
        qr = await session.get_qr_screenshot()
        return {"qr_screenshot": qr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/chats")
async def api_list_chats(
    limit: int = Query(20, ge=1, le=50),
    user: User = Depends(get_current_user_required),
):
    """List recent WhatsApp chats."""
    session = await get_whatsapp_session(user.id)
    if not await session.is_authenticated():
        raise HTTPException(status_code=401, detail="WhatsApp not authenticated. Scan QR code first.")

    chats = await session.list_chats(limit=limit)
    return {"chats": chats, "count": len(chats)}


@router.get("/messages/{chat_name}")
async def api_get_messages(
    chat_name: str,
    limit: int = Query(30, ge=1, le=100),
    user: User = Depends(get_current_user_required),
):
    """Get messages from a specific chat."""
    session = await get_whatsapp_session(user.id)
    if not await session.is_authenticated():
        raise HTTPException(status_code=401, detail="WhatsApp not authenticated")

    messages = await session.get_messages(chat_name, limit=limit)
    return {"chat_name": chat_name, "messages": messages, "count": len(messages)}


@router.post("/send")
async def api_send_message(
    body: SendMessageRequest,
    user: User = Depends(get_current_user_required),
):
    """Send a message to a WhatsApp chat."""
    session = await get_whatsapp_session(user.id)
    if not await session.is_authenticated():
        raise HTTPException(status_code=401, detail="WhatsApp not authenticated")

    success = await session.send_message(body.chat_name, body.message)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to send message")

    return {"status": "sent", "chat_name": body.chat_name}


@router.get("/summary/{chat_name}")
async def api_summarize_chat(
    chat_name: str,
    limit: int = Query(30, ge=1, le=100),
    user: User = Depends(get_current_user_required),
):
    """LLM-summarize a WhatsApp chat thread."""
    session = await get_whatsapp_session(user.id)
    if not await session.is_authenticated():
        raise HTTPException(status_code=401, detail="WhatsApp not authenticated")

    messages = await session.get_messages(chat_name, limit=limit)
    if not messages:
        return {"chat_name": chat_name, "summary": "No messages found", "messages": []}

    # Use LLM to summarize
    from google import genai
    from google.genai import types

    from app.config import settings

    client = genai.Client(api_key=settings.gemini_api_key)

    msg_text = "\n".join([f"[{m.get('time', '')}] {m['from']}: {m['text']}" for m in messages])
    prompt = f"""Summarize this WhatsApp conversation from "{chat_name}" concisely.
Highlight key topics, decisions, and any action items.

Messages:
{msg_text[:3000]}

Return a brief summary (under 200 words)."""

    response = await client.aio.models.generate_content(
        model=settings.gemini_chat_model,
        contents=[types.Content(role="user", parts=[types.Part.from_text(text=prompt)])],
        config=types.GenerateContentConfig(max_output_tokens=512, temperature=0.3),
    )

    return {
        "chat_name": chat_name,
        "summary": response.text or "",
        "message_count": len(messages),
        "key_messages": messages[-5:] if len(messages) > 5 else messages,
    }


@router.post("/disconnect")
async def api_disconnect_whatsapp(
    user: User = Depends(get_current_user_required),
):
    """Disconnect WhatsApp session."""
    await close_whatsapp_session(user.id)
    return {"status": "disconnected"}
