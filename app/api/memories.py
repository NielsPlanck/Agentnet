"""Memory API — CRUD + extraction + search for persistent AI memory."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_required, get_db
from app.models.memory import Memory
from app.models.user import User
from app.services.memory import (
    auto_extract_memories,
    list_memories,
    search_memories,
    _memory_to_dict,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/memories", tags=["memories"])


# ── Schemas ──────────────────────────────────────────────────────

class CreateMemoryRequest(BaseModel):
    category: str = "fact"  # preference | contact | fact | decision | pattern
    key: str
    content: str
    importance: float = 0.5


class UpdateMemoryRequest(BaseModel):
    category: Optional[str] = None
    key: Optional[str] = None
    content: Optional[str] = None
    importance: Optional[float] = None


class ExtractMemoriesRequest(BaseModel):
    conversation_text: str
    conversation_id: str = ""


# ── Endpoints ────────────────────────────────────────────────────

@router.get("/")
async def api_list_memories(
    category: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user_required),
):
    """List all memories for the current user, optionally filtered by category."""
    return await list_memories(user.id, category=category, limit=limit, offset=offset)


@router.get("/search")
async def api_search_memories(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user_required),
):
    """Search memories by content keyword."""
    results = await search_memories(user.id, q, limit=limit)
    return {"results": results, "query": q}


@router.post("/")
async def api_create_memory(
    body: CreateMemoryRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Create a memory manually."""
    if body.category not in ("preference", "contact", "fact", "decision", "pattern"):
        raise HTTPException(status_code=400, detail="Invalid category")

    mem = Memory(
        user_id=user.id,
        category=body.category,
        key=body.key[:200],
        content=body.content,
        source="manual",
        importance=min(max(body.importance, 0.0), 1.0),
    )
    db.add(mem)
    await db.commit()
    await db.refresh(mem)
    return _memory_to_dict(mem)


@router.put("/{memory_id}")
async def api_update_memory(
    memory_id: str,
    body: UpdateMemoryRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Update a memory."""
    result = await db.execute(
        select(Memory).where(Memory.id == memory_id, Memory.user_id == user.id)
    )
    mem = result.scalar_one_or_none()
    if not mem:
        raise HTTPException(status_code=404, detail="Memory not found")

    if body.category is not None:
        if body.category not in ("preference", "contact", "fact", "decision", "pattern"):
            raise HTTPException(status_code=400, detail="Invalid category")
        mem.category = body.category
    if body.key is not None:
        mem.key = body.key[:200]
    if body.content is not None:
        mem.content = body.content
    if body.importance is not None:
        mem.importance = min(max(body.importance, 0.0), 1.0)

    await db.commit()
    await db.refresh(mem)
    return _memory_to_dict(mem)


@router.delete("/{memory_id}")
async def api_delete_memory(
    memory_id: str,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Delete a memory."""
    result = await db.execute(
        select(Memory).where(Memory.id == memory_id, Memory.user_id == user.id)
    )
    mem = result.scalar_one_or_none()
    if not mem:
        raise HTTPException(status_code=404, detail="Memory not found")

    await db.delete(mem)
    await db.commit()
    return {"status": "deleted", "id": memory_id}


@router.post("/extract")
async def api_extract_memories(
    body: ExtractMemoriesRequest,
    user: User = Depends(get_current_user_required),
):
    """Extract memories from a conversation text using LLM."""
    if len(body.conversation_text) < 50:
        return {"extracted": [], "message": "Conversation too short"}

    extracted = await auto_extract_memories(
        user.id,
        body.conversation_text,
        conversation_id=body.conversation_id,
    )
    return {"extracted": extracted, "count": len(extracted)}
