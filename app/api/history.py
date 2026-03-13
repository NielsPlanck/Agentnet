"""Chat history API — list, load, and delete past conversations."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user_required, get_db
from app.models.training import Conversation, Message
from app.models.user import User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/history", tags=["history"])


@router.get("/conversations")
async def list_conversations(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """List user's conversations, newest first."""
    # Count total
    count_result = await db.execute(
        select(func.count()).select_from(Conversation).where(
            Conversation.user_id == user.id
        )
    )
    total = count_result.scalar() or 0

    # Fetch conversations with first message for preview
    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == user.id)
        .options(selectinload(Conversation.messages))
        .order_by(Conversation.started_at.desc())
        .offset(offset)
        .limit(limit)
    )
    conversations = result.scalars().all()

    items = []
    for c in conversations:
        msgs = c.__dict__.get("messages") or []
        first_user_msg = next((m for m in msgs if m.role == "user"), None)
        preview = ""
        if first_user_msg:
            preview = first_user_msg.content[:120]

        items.append({
            "id": c.id,
            "title": c.title or preview[:80] or "Untitled",
            "started_at": c.started_at.isoformat() if c.started_at else None,
            "message_count": len(msgs),
            "preview": preview,
        })

    return {"conversations": items, "total": total}


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Get a full conversation with all messages."""
    result = await db.execute(
        select(Conversation)
        .where(
            Conversation.id == conversation_id,
            Conversation.user_id == user.id,
        )
        .options(selectinload(Conversation.messages))
    )
    conv = result.scalar_one_or_none()

    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    msgs = conv.__dict__.get("messages") or []

    return {
        "id": conv.id,
        "title": conv.title,
        "started_at": conv.started_at.isoformat() if conv.started_at else None,
        "messages": [
            {
                "id": m.id,
                "seq": m.seq,
                "role": m.role,
                "content": m.content,
                "tools_shown": m.tools_shown,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in sorted(msgs, key=lambda x: x.seq)
        ],
    }


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single conversation."""
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == user.id,
        )
    )
    conv = result.scalar_one_or_none()

    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    await db.execute(
        delete(Conversation).where(Conversation.id == conversation_id)
    )
    await db.commit()
    return {"ok": True}
