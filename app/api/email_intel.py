"""Email Intelligence API — inbox scan, digest, draft management."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_required, get_db
from app.api.routes import _get_google_token
from app.models.user import User
from app.services.email_intel import get_latest_digest, list_digests, process_inbox

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/inbox", tags=["inbox"])


# ── Schemas ──────────────────────────────────────────────────────

class DraftRequest(BaseModel):
    to: str
    subject: str
    body: str


class SendDraftRequest(BaseModel):
    email_id: str
    to: str
    subject: str
    body: str


# ── Endpoints ────────────────────────────────────────────────────

@router.post("/scan")
async def api_scan_inbox(
    request: Request,
    since_hours: int = Query(4, ge=1, le=72),
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Trigger inbox scan — fetches, categorizes, and suggests drafts."""
    token = await _get_google_token(request, db)
    result = await process_inbox(user.id, token, since_hours=since_hours)
    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])
    return result


@router.get("/latest")
async def api_latest_digest(
    user: User = Depends(get_current_user_required),
):
    """Get the most recent inbox digest."""
    digest = await get_latest_digest(user.id)
    if not digest:
        return {"message": "No digest available. Scan your inbox first.", "digest": None}
    return {"digest": digest}


@router.get("/digests")
async def api_list_digests(
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user_required),
):
    """List past inbox digests."""
    return await list_digests(user.id, limit=limit)


@router.post("/draft")
async def api_create_draft(
    body: DraftRequest,
    request: Request,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Create a Gmail draft."""
    from app.services.gmail import create_draft

    token = await _get_google_token(request, db)
    try:
        result = await create_draft(token, body.to, body.subject, body.body)
        return {**result, "gmail_url": "https://mail.google.com/mail/u/0/#drafts"}
    except Exception:
        log.exception("Failed to create email draft")
        raise HTTPException(status_code=500, detail="Failed to create draft")


@router.post("/send")
async def api_send_email(
    body: SendDraftRequest,
    request: Request,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Send an email reply."""
    from app.services.gmail import send_email

    token = await _get_google_token(request, db)
    try:
        result = await send_email(token, body.to, body.subject, body.body)
        return result
    except Exception:
        log.exception("Failed to send email")
        raise HTTPException(status_code=500, detail="Failed to send email")
