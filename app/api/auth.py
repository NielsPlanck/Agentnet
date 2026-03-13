"""User authentication endpoints: signup, login, Google sign-in, logout."""

import hashlib
import hmac
import json
import logging
import time
import uuid
from urllib.parse import urlencode

import bcrypt as _bcrypt
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AUTH_COOKIE, create_access_token, get_current_user_optional, get_db
from app.api.session_utils import SESSION_COOKIE, get_or_create_session
from app.config import settings
from app.models.user import Session, User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/auth", tags=["auth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

# Minimal scopes for sign-in (not API access)
SIGN_IN_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]


# -- Request/Response schemas -----------------------------------------------

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str = ""


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    avatar_url: str
    auth_provider: str


# -- Helpers ----------------------------------------------------------------

def _set_auth_cookie(response: Response, token: str):
    """Set JWT as httpOnly cookie."""
    response.set_cookie(
        AUTH_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * settings.jwt_expiry_hours,
        path="/",
    )


async def _link_session_to_user(
    request: Request, response: Response, db: AsyncSession, user: User
):
    """Link current anonymous session to user (for data merge)."""
    session = await get_or_create_session(request, response, db)
    if session.user_id is None:
        session.user_id = user.id
        await db.flush()

    # Also link any other anonymous sessions that don't have a user yet
    # (in case of session_id mismatch)


def _build_google_sign_in_state(session_id: str) -> str:
    """HMAC-signed state for Google sign-in (separate from API OAuth)."""
    payload = json.dumps({"sid": session_id, "purpose": "signin", "ts": int(time.time())})
    sig = hmac.new(
        settings.session_secret.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()[:16]
    return f"{sig}.{payload}"


def _verify_google_sign_in_state(state: str) -> dict | None:
    """Verify Google sign-in state."""
    try:
        sig, payload = state.split(".", 1)
        expected = hmac.new(
            settings.session_secret.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()[:16]
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(payload)
        if data.get("purpose") != "signin":
            return None
        if time.time() - data["ts"] > 600:
            return None
        return data
    except Exception:
        return None


# -- Endpoints --------------------------------------------------------------

@router.post("/signup")
async def signup(
    body: SignupRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Create a new user account with email + password."""
    # Check if email already exists
    result = await db.execute(select(User).where(User.email == body.email))
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # Create user
    user = User(
        id=str(uuid.uuid4()),
        email=body.email,
        password_hash=_bcrypt.hashpw(body.password.encode(), _bcrypt.gensalt()).decode(),
        display_name=body.display_name or body.email.split("@")[0],
        auth_provider="email",
    )
    db.add(user)
    await db.flush()

    # Link current session to user
    await _link_session_to_user(request, response, db, user)

    await db.commit()

    # Set JWT cookie
    token = create_access_token(user.id)
    _set_auth_cookie(response, token)

    return UserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        auth_provider=user.auth_provider,
    )


@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Log in with email + password."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not _bcrypt.checkpw(body.password.encode(), user.password_hash.encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Link current session to user
    await _link_session_to_user(request, response, db, user)
    await db.commit()

    token = create_access_token(user.id)
    _set_auth_cookie(response, token)

    return UserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        auth_provider=user.auth_provider,
    )


@router.post("/logout")
async def logout(response: Response):
    """Clear auth cookie."""
    response.delete_cookie(AUTH_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(user: User | None = Depends(get_current_user_optional)):
    """Get current user info, or null if anonymous."""
    if user is None:
        return {"user": None}
    return {
        "user": UserResponse(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            avatar_url=user.avatar_url,
            auth_provider=user.auth_provider,
        )
    }


@router.get("/google/start")
async def google_sign_in_start(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Redirect to Google for sign-in."""
    session = await get_or_create_session(request, response, db)
    await db.commit()

    state = _build_google_sign_in_state(session.id)
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,  # reuse the registered OAuth redirect
        "response_type": "code",
        "scope": " ".join(SIGN_IN_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"
    return RedirectResponse(url)


    # NOTE: google sign-in callback is handled in oauth.py (same redirect_uri)
    # The state parameter with purpose="signin" tells the callback to create a user.
