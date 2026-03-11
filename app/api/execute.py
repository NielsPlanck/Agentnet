"""Action execution endpoint."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.session_utils import get_or_create_session
from app.database import async_session
from app.models.tool import Action, Tool
from app.models.user import OAuthConnection
from app.services.gmail import list_labels, search_emails, send_email
from app.services.oauth import decrypt_token, encrypt_token, refresh_google_token

router = APIRouter(prefix="/v1/actions", tags=["execute"])


async def get_db():
    async with async_session() as session:
        yield session


class ExecuteRequest(BaseModel):
    params: dict = {}


class ExecuteResponse(BaseModel):
    success: bool
    data: dict | list | None = None
    error: str | None = None


# Map action names to gmail functions
GMAIL_ACTIONS = {
    "list_labels": lambda token, params: list_labels(token),
    "search_emails": lambda token, params: search_emails(
        token, params.get("query", ""), params.get("max_results", 10)
    ),
    "send_email": lambda token, params: send_email(
        token, params["to"], params["subject"], params.get("body", "")
    ),
}


async def _get_valid_token(conn: OAuthConnection, db: AsyncSession) -> str:
    """Get a valid access token, refreshing if expired."""
    token = decrypt_token(conn.access_token_enc)

    # Check if token is expired
    if conn.token_expires_at and conn.token_expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
        if not conn.refresh_token_enc:
            raise ValueError("Token expired and no refresh token available")

        refresh = decrypt_token(conn.refresh_token_enc)
        new_tokens = await refresh_google_token(refresh)

        conn.access_token_enc = encrypt_token(new_tokens["access_token"])
        if "refresh_token" in new_tokens:
            conn.refresh_token_enc = encrypt_token(new_tokens["refresh_token"])

        from datetime import timedelta
        conn.token_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(
            seconds=new_tokens.get("expires_in", 3600)
        )
        await db.flush()
        token = new_tokens["access_token"]

    return token


@router.post("/{action_id}/execute", response_model=ExecuteResponse)
async def execute_action(
    action_id: str,
    body: ExecuteRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Execute a tool action with the user's OAuth connection."""
    session = await get_or_create_session(request, response, db)

    # Load the action and its tool
    result = await db.execute(
        select(Action).where(Action.id == action_id)
    )
    action = result.scalar_one_or_none()
    if not action:
        return ExecuteResponse(success=False, error="Action not found")

    result = await db.execute(select(Tool).where(Tool.id == action.tool_id))
    tool = result.scalar_one_or_none()
    if not tool:
        return ExecuteResponse(success=False, error="Tool not found")

    # Find OAuth connection
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.session_id == session.id,
            OAuthConnection.tool_id == tool.id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        return ExecuteResponse(success=False, error="Not connected. Please connect first.")

    # Get valid token
    try:
        token = await _get_valid_token(conn, db)
    except ValueError as e:
        return ExecuteResponse(success=False, error=str(e))

    # Route to correct handler
    handler = GMAIL_ACTIONS.get(action.name)
    if not handler:
        return ExecuteResponse(success=False, error=f"No handler for action: {action.name}")

    try:
        data = await handler(token, body.params)
        await db.commit()
        return ExecuteResponse(success=True, data=data)
    except Exception as e:
        await db.commit()
        return ExecuteResponse(success=False, error=str(e))
