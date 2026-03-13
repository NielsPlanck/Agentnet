"""Google OAuth helpers and token encryption."""

import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet

from app.config import settings

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

GOOGLE_SCOPES = [
    # Gmail
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.labels",
    # Calendar
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
    # Contacts / People
    "https://www.googleapis.com/auth/contacts.readonly",
    # Drive (read-only for now)
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    # Sheets
    "https://www.googleapis.com/auth/spreadsheets",
    # User info
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]

# Keep backward compat alias
GMAIL_SCOPES = GOOGLE_SCOPES

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(settings.oauth_encryption_key.encode())
    return _fernet


def encrypt_token(token: str) -> bytes:
    return _get_fernet().encrypt(token.encode())


def decrypt_token(data: bytes) -> str:
    return _get_fernet().decrypt(data).decode()


def build_oauth_state(session_id: str, tool_id: str) -> str:
    """Create HMAC-signed state parameter for OAuth."""
    payload = json.dumps({"sid": session_id, "tid": tool_id, "ts": int(time.time())})
    sig = hmac.new(settings.session_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{sig}.{payload}"


def verify_oauth_state(state: str) -> dict | None:
    """Verify and decode OAuth state. Returns None if invalid."""
    try:
        sig, payload = state.split(".", 1)
        expected = hmac.new(settings.session_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(payload)
        # Reject states older than 10 minutes
        if time.time() - data["ts"] > 600:
            return None
        return data
    except Exception:
        return None


def build_google_auth_url(state: str) -> str:
    """Build Google OAuth consent URL."""
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": " ".join(GMAIL_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_google_code(code: str) -> dict:
    """Exchange authorization code for tokens."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def refresh_google_token(refresh_token: str) -> dict:
    """Refresh an expired access token."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "grant_type": "refresh_token",
            },
        )
        resp.raise_for_status()
        return resp.json()
