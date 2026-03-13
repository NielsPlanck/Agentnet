"""User settings API — preferences, profile, account management."""

import json
import logging

import bcrypt as _bcrypt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_required, get_db
from app.models.preference import PREFERENCE_DEFAULTS, UserPreference
from app.models.training import Conversation, Message
from app.models.user import OAuthConnection, Session, User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/settings", tags=["settings"])


# ── Schemas ──────────────────────────────────────────────────────

class UpdatePreferencesRequest(BaseModel):
    color_mode: str | None = None
    chat_font: str | None = None
    voice: str | None = None


class UpdateProfileRequest(BaseModel):
    display_name: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ── Preferences ──────────────────────────────────────────────────

@router.get("/preferences")
async def get_preferences(
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Get all user preferences with defaults."""
    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == user.id)
    )
    prefs = {p.key: p.value for p in result.scalars().all()}

    # Fill in defaults for missing keys
    merged = {**PREFERENCE_DEFAULTS, **prefs}
    return merged


@router.put("/preferences")
async def update_preferences(
    body: UpdatePreferencesRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Upsert user preferences."""
    updates = {k: v for k, v in body.model_dump().items() if v is not None}

    for key, value in updates.items():
        # Find existing
        result = await db.execute(
            select(UserPreference).where(
                UserPreference.user_id == user.id, UserPreference.key == key
            )
        )
        pref = result.scalar_one_or_none()

        if pref:
            pref.value = value
        else:
            db.add(UserPreference(user_id=user.id, key=key, value=value))

    await db.commit()

    # Return updated preferences
    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == user.id)
    )
    prefs = {p.key: p.value for p in result.scalars().all()}
    return {**PREFERENCE_DEFAULTS, **prefs}


# ── Profile ──────────────────────────────────────────────────────

@router.put("/profile")
async def update_profile(
    body: UpdateProfileRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Update user profile."""
    if body.display_name is not None:
        user.display_name = body.display_name

    await db.commit()
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "auth_provider": user.auth_provider,
    }


# ── Password ─────────────────────────────────────────────────────

@router.put("/password")
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Change password (email auth users only)."""
    if user.auth_provider != "email" or not user.password_hash:
        raise HTTPException(status_code=400, detail="Password change not available for Google accounts")

    if not _bcrypt.checkpw(body.current_password.encode(), user.password_hash.encode()):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    user.password_hash = _bcrypt.hashpw(body.new_password.encode(), _bcrypt.gensalt()).decode()
    await db.commit()
    return {"ok": True}


# ── Connections ──────────────────────────────────────────────────

@router.get("/connections")
async def list_connections(
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """List OAuth connections for the user's sessions."""
    # Get all sessions for this user
    result = await db.execute(
        select(Session.id).where(Session.user_id == user.id)
    )
    session_ids = [row[0] for row in result.all()]

    if not session_ids:
        return []

    result = await db.execute(
        select(OAuthConnection).where(OAuthConnection.session_id.in_(session_ids))
    )
    connections = result.scalars().all()

    return [
        {
            "id": c.id,
            "provider": c.provider,
            "tool_id": c.tool_id,
            "scopes": c.scopes,
            "expires_at": c.token_expires_at.isoformat() if c.token_expires_at else None,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in connections
    ]


# ── History Management ───────────────────────────────────────────

@router.delete("/history")
async def clear_history(
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Clear all conversation history for the user."""
    await db.execute(
        delete(Conversation).where(Conversation.user_id == user.id)
    )
    await db.commit()
    return {"ok": True}


# ── Data Export ──────────────────────────────────────────────────

@router.post("/export")
async def export_data(
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Export all user data as JSON."""
    from sqlalchemy.orm import selectinload

    # Conversations with messages
    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == user.id)
        .options(selectinload(Conversation.messages))
        .order_by(Conversation.started_at.desc())
    )
    conversations = result.scalars().all()

    # Preferences
    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == user.id)
    )
    prefs = {p.key: p.value for p in result.scalars().all()}

    export = {
        "user": {
            "email": user.email,
            "display_name": user.display_name,
            "auth_provider": user.auth_provider,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "preferences": {**PREFERENCE_DEFAULTS, **prefs},
        "conversations": [
            {
                "id": c.id,
                "title": c.title,
                "started_at": c.started_at.isoformat() if c.started_at else None,
                "messages": [
                    {
                        "seq": m.seq,
                        "role": m.role,
                        "content": m.content,
                        "created_at": m.created_at.isoformat() if m.created_at else None,
                    }
                    for m in (c.__dict__.get("messages") or [])
                ],
            }
            for c in conversations
        ],
    }

    from fastapi.responses import Response
    return Response(
        content=json.dumps(export, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=agentnet_export.json"},
    )
