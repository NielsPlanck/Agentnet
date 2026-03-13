"""OAuth flow endpoints — handles both API connections and Google sign-in."""

import logging
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.session_utils import SESSION_COOKIE, get_or_create_session
from app.config import settings
from app.database import async_session
from app.models.user import OAuthConnection, Session, User
from app.services.oauth import (
    build_google_auth_url,
    build_oauth_state,
    decrypt_token,
    encrypt_token,
    exchange_google_code,
    refresh_google_token,
    verify_oauth_state,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/oauth", tags=["oauth"])

GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


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
    """Handle Google OAuth callback — routes to sign-in or API token flow."""
    # Try sign-in state first (has "purpose": "signin")
    from app.api.auth import _verify_google_sign_in_state

    sign_in_data = _verify_google_sign_in_state(state)
    if sign_in_data:
        return await _handle_sign_in_callback(code, sign_in_data, db)

    # Otherwise it's a regular API OAuth flow
    state_data = verify_oauth_state(state)
    if not state_data:
        return RedirectResponse(f"{settings.frontend_url}?oauth_error=invalid_state")

    return await _handle_api_oauth_callback(code, state_data, db)


async def _handle_sign_in_callback(
    code: str, state_data: dict, db: AsyncSession
) -> RedirectResponse:
    """Handle Google sign-in: create/find user, set JWT cookie."""
    from app.api.auth import _set_auth_cookie
    from app.api.deps import create_access_token

    session_id = state_data["sid"]

    # Exchange code for tokens
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": settings.google_redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            resp.raise_for_status()
            tokens = resp.json()
    except Exception as e:
        log.error(f"Google sign-in token exchange failed: {e}")
        return RedirectResponse(f"{settings.frontend_url}/login?error=token_exchange_failed")

    # Get user info from Google
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
            resp.raise_for_status()
            google_user = resp.json()
    except Exception as e:
        log.error(f"Google userinfo failed: {e}")
        return RedirectResponse(f"{settings.frontend_url}/login?error=userinfo_failed")

    google_id = google_user.get("id", "")
    email = google_user.get("email", "")
    name = google_user.get("name", "")
    picture = google_user.get("picture", "")

    if not email:
        return RedirectResponse(f"{settings.frontend_url}/login?error=no_email")

    # Find or create user
    result = await db.execute(
        select(User).where((User.google_id == google_id) | (User.email == email))
    )
    user = result.scalar_one_or_none()

    if user:
        if not user.google_id:
            user.google_id = google_id
        if not user.avatar_url and picture:
            user.avatar_url = picture
        if not user.display_name and name:
            user.display_name = name
    else:
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            google_id=google_id,
            display_name=name,
            avatar_url=picture,
            auth_provider="google",
        )
        db.add(user)
        await db.flush()

    # Link session to user
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if session and session.user_id is None:
        session.user_id = user.id

    await db.commit()

    # Set JWT cookie and redirect
    token = create_access_token(user.id)
    redirect = RedirectResponse(f"{settings.frontend_url}?auth_success=true")
    _set_auth_cookie(redirect, token)

    redirect.set_cookie(
        SESSION_COOKIE,
        session_id,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 365,
    )

    return redirect


async def _handle_api_oauth_callback(
    code: str, state_data: dict, db: AsyncSession
) -> RedirectResponse:
    """Handle API OAuth: store access/refresh tokens for tool access."""
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

    expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=expires_in)

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
