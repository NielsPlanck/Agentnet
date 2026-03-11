"""OAuth flow endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.session_utils import get_or_create_session
from app.config import settings
from app.database import async_session
from app.models.user import OAuthConnection
from app.services.oauth import (
    build_google_auth_url,
    build_oauth_state,
    decrypt_token,
    encrypt_token,
    exchange_google_code,
    refresh_google_token,
    verify_oauth_state,
)

router = APIRouter(prefix="/v1/oauth", tags=["oauth"])


async def get_db():
    async with async_session() as session:
        yield session


@router.get("/google/start")
async def google_start(
    tool_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Redirect user to Google OAuth consent screen."""
    session = await get_or_create_session(request, response, db)
    state = build_oauth_state(session.id, tool_id)
    await db.commit()
    url = build_google_auth_url(state)
    return RedirectResponse(url)


@router.get("/google/callback")
async def google_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
):
    """Handle Google OAuth callback — exchange code, store tokens."""
    state_data = verify_oauth_state(state)
    if not state_data:
        return RedirectResponse(f"{settings.frontend_url}?oauth_error=invalid_state")

    session_id = state_data["sid"]
    tool_id = state_data["tid"]

    try:
        tokens = await exchange_google_code(code)
    except Exception:
        return RedirectResponse(f"{settings.frontend_url}?oauth_error=token_exchange_failed")

    access_token = tokens["access_token"]
    refresh_token = tokens.get("refresh_token")
    expires_in = tokens.get("expires_in", 3600)
    scopes = tokens.get("scope", "")

    expires_at = datetime.now(timezone.utc).replace(tzinfo=None)
    from datetime import timedelta
    expires_at += timedelta(seconds=expires_in)

    # Upsert connection
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.session_id == session_id,
            OAuthConnection.provider == "google",
            OAuthConnection.tool_id == tool_id,
        )
    )
    conn = result.scalar_one_or_none()

    if conn:
        conn.access_token_enc = encrypt_token(access_token)
        if refresh_token:
            conn.refresh_token_enc = encrypt_token(refresh_token)
        conn.token_expires_at = expires_at
        conn.scopes = scopes
    else:
        conn = OAuthConnection(
            session_id=session_id,
            provider="google",
            tool_id=tool_id,
            access_token_enc=encrypt_token(access_token),
            refresh_token_enc=encrypt_token(refresh_token) if refresh_token else None,
            token_expires_at=expires_at,
            scopes=scopes,
        )
        db.add(conn)

    await db.commit()
    return RedirectResponse(f"{settings.frontend_url}?oauth_success=true&tool_id={tool_id}")


@router.get("/status/{tool_id}")
async def connection_status(
    tool_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Check if current session has a connection for this tool."""
    session = await get_or_create_session(request, response, db)
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.session_id == session.id,
            OAuthConnection.tool_id == tool_id,
        )
    )
    conn = result.scalar_one_or_none()
    await db.commit()

    if not conn:
        return {"connected": False}

    return {
        "connected": True,
        "provider": conn.provider,
        "scopes": conn.scopes,
        "expires_at": conn.token_expires_at.isoformat() if conn.token_expires_at else None,
    }


@router.delete("/disconnect/{tool_id}")
async def disconnect(
    tool_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Remove OAuth connection for this tool."""
    session = await get_or_create_session(request, response, db)
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.session_id == session.id,
            OAuthConnection.tool_id == tool_id,
        )
    )
    conn = result.scalar_one_or_none()
    if conn:
        await db.delete(conn)
    await db.commit()
    return {"disconnected": True}
