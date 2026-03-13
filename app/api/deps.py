"""Database and auth dependencies for FastAPI routes."""

from collections.abc import AsyncGenerator
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.user import User

ALGORITHM = "HS256"
AUTH_COOKIE = "agentnet_auth"


async def get_db() -> AsyncGenerator[AsyncSession]:
    async with async_session() as session:
        yield session


# -- JWT helpers -----------------------------------------------------------

def create_access_token(user_id: str) -> str:
    """Create a JWT token for a user."""
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiry_hours)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> str | None:
    """Decode JWT and return user_id, or None if invalid."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


# -- Auth dependencies -----------------------------------------------------

async def get_current_user_optional(
    request: Request, db: AsyncSession = Depends(get_db)
) -> User | None:
    """Get user from JWT cookie if present. Returns None for anonymous."""
    token = request.cookies.get(AUTH_COOKIE)
    if not token:
        return None

    user_id = decode_token(token)
    if not user_id:
        return None

    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_current_user_required(
    user: User | None = Depends(get_current_user_optional),
) -> User:
    """Require authenticated user. Raises 401 if not logged in."""
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user
