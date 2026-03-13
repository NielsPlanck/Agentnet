"""Meeting Intelligence API — debrief meetings, action items, follow-ups."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_required, get_db
from app.models.user import User
from app.services.meeting_intel import (
    check_ended_meetings,
    debrief_meeting,
    execute_debrief_actions,
    get_debrief,
    list_debriefs,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/meetings", tags=["meetings"])


# ── Schemas ──────────────────────────────────────────────────────────

class DebriefRequest(BaseModel):
    """Manual debrief request — pass event details directly."""
    event_id: str
    title: str = ""
    start: str = ""
    end: str = ""
    attendees: list[str] = []
    description: str = ""
    location: str = ""


# ── Endpoints ────────────────────────────────────────────────────────

@router.get("/recent")
async def api_recent_debriefs(
    limit: int = Query(20, ge=1, le=50),
    user: User = Depends(get_current_user_required),
):
    """List recent meeting debriefs."""
    debriefs = await list_debriefs(user.id, limit=limit)
    return {"debriefs": debriefs, "count": len(debriefs)}


@router.get("/check")
async def api_check_ended_meetings(
    request: Request,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Check for recently ended meetings that need debriefing."""
    from app.api.routes import _get_google_token

    try:
        token = await _get_google_token(request, db)
    except HTTPException:
        return {"ended_meetings": [], "message": "Google Calendar not connected"}

    ended = await check_ended_meetings(user.id, token)
    return {"ended_meetings": ended, "count": len(ended)}


@router.post("/debrief")
async def api_debrief_meeting(
    body: DebriefRequest,
    request: Request,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Generate a debrief for a specific meeting."""
    event = {
        "id": body.event_id,
        "title": body.title,
        "start": body.start,
        "end": body.end,
        "attendees": body.attendees,
        "description": body.description,
        "location": body.location,
    }
    result = await debrief_meeting(user.id, event)
    return result


@router.post("/debrief/auto")
async def api_auto_debrief(
    request: Request,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Auto-debrief all recently ended meetings."""
    from app.api.routes import _get_google_token

    try:
        token = await _get_google_token(request, db)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Google Calendar not connected")

    ended = await check_ended_meetings(user.id, token)
    if not ended:
        return {"debriefs": [], "message": "No recently ended meetings to debrief"}

    debriefs = []
    for event in ended:
        try:
            result = await debrief_meeting(user.id, event)
            debriefs.append(result)
        except Exception as e:
            log.error("Failed to debrief meeting %s: %s", event.get("title"), e)

    return {"debriefs": debriefs, "count": len(debriefs)}


@router.get("/debrief/{debrief_id}")
async def api_get_debrief(
    debrief_id: str,
    user: User = Depends(get_current_user_required),
):
    """Get a specific debrief."""
    result = await get_debrief(user.id, debrief_id)
    if not result:
        raise HTTPException(status_code=404, detail="Debrief not found")
    return result


@router.post("/debrief/{debrief_id}/execute")
async def api_execute_debrief(
    debrief_id: str,
    user: User = Depends(get_current_user_required),
):
    """Execute all actions from a debrief (create reminders, notes, drafts)."""
    actions = await execute_debrief_actions(user.id, debrief_id)
    return {"actions_taken": actions, "count": len(actions)}


@router.delete("/debrief/{debrief_id}")
async def api_dismiss_debrief(
    debrief_id: str,
    user: User = Depends(get_current_user_required),
):
    """Dismiss a debrief."""
    from sqlalchemy import select

    from app.database import async_session
    from app.models.meeting_intel import MeetingDebrief

    async with async_session() as db:
        result = await db.execute(
            select(MeetingDebrief).where(
                MeetingDebrief.id == debrief_id,
                MeetingDebrief.user_id == user.id,
            )
        )
        debrief = result.scalar_one_or_none()
        if not debrief:
            raise HTTPException(status_code=404, detail="Debrief not found")

        debrief.status = "dismissed"
        await db.commit()

    return {"status": "dismissed", "id": debrief_id}
