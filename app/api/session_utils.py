"""Cookie-based session management."""

import uuid

from fastapi import Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Session

SESSION_COOKIE = "agentnet_session"


async def get_or_create_session(
    request: Request, response: Response, db: AsyncSession
) -> Session:
    """Get existing session from cookie or create a new one."""
    session_id = request.cookies.get(SESSION_COOKIE)

    if session_id:
        result = await db.execute(select(Session).where(Session.id == session_id))
        session = result.scalar_one_or_none()
        if session:
            return session

    # Create new session
    session = Session(id=str(uuid.uuid4()))
    db.add(session)
    await db.flush()

    response.set_cookie(
        SESSION_COOKIE,
        session.id,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 365,  # 1 year
    )
    return session
