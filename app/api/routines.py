"""Routines API — CRUD for routines, Apple ecosystem proxy, notifications."""

import asyncio
import json
import logging
from datetime import datetime, timezone

from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_required, get_db
from app.models.routine import Routine, RoutineRun
from app.models.user import User
from app.services.routine_worker import _compute_next_run

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/routines", tags=["routines"])


# ── Schemas ──────────────────────────────────────────────────────────

class CreateRoutineRequest(BaseModel):
    name: str
    prompt: str
    schedule_type: str = "cron"  # cron | interval | one_shot
    schedule_value: str = ""     # "0 8 * * *" | "5h" | ISO datetime


class UpdateRoutineRequest(BaseModel):
    name: str | None = None
    prompt: str | None = None
    schedule_type: str | None = None
    schedule_value: str | None = None
    enabled: bool | None = None


class AppleCalendarEventRequest(BaseModel):
    title: str
    start: str
    end: str = ""
    calendar_name: str = ""
    notes: str = ""
    location: str = ""


class AppleReminderRequest(BaseModel):
    name: str
    due_date: str = ""
    notes: str = ""
    list_name: str = ""


class AppleNoteRequest(BaseModel):
    title: str
    body: str
    folder: str = "Notes"


# ── Routine CRUD ─────────────────────────────────────────────────────

@router.get("/")
async def list_routines(
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """List all routines for the current user."""
    result = await db.execute(
        select(Routine)
        .where(Routine.user_id == user.id)
        .order_by(Routine.created_at.desc())
    )
    routines = result.scalars().all()
    return {
        "routines": [
            {
                "id": r.id,
                "name": r.name,
                "prompt": r.prompt,
                "schedule_type": r.schedule_type,
                "schedule_value": r.schedule_value,
                "enabled": r.enabled,
                "last_run_at": r.last_run_at.isoformat() if r.last_run_at else None,
                "next_run_at": r.next_run_at.isoformat() if r.next_run_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in routines
        ]
    }


@router.post("/")
async def create_routine(
    req: CreateRoutineRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Create a new routine."""
    routine = Routine(
        user_id=user.id,
        name=req.name,
        prompt=req.prompt,
        schedule_type=req.schedule_type,
        schedule_value=req.schedule_value,
        enabled=True,
    )

    # Compute initial next_run_at
    routine.next_run_at = _compute_next_run(routine)

    db.add(routine)
    await db.commit()
    await db.refresh(routine)

    logger.info("Created routine %s for user %s: %s", routine.id, user.id, routine.name)
    return {
        "id": routine.id,
        "name": routine.name,
        "schedule_type": routine.schedule_type,
        "schedule_value": routine.schedule_value,
        "next_run_at": routine.next_run_at.isoformat() if routine.next_run_at else None,
        "status": "created",
    }


@router.put("/{routine_id}")
async def update_routine(
    routine_id: str,
    req: UpdateRoutineRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing routine."""
    result = await db.execute(
        select(Routine).where(Routine.id == routine_id, Routine.user_id == user.id)
    )
    routine = result.scalar_one_or_none()
    if not routine:
        raise HTTPException(404, "Routine not found")

    if req.name is not None:
        routine.name = req.name
    if req.prompt is not None:
        routine.prompt = req.prompt
    if req.schedule_type is not None:
        routine.schedule_type = req.schedule_type
    if req.schedule_value is not None:
        routine.schedule_value = req.schedule_value
    if req.enabled is not None:
        routine.enabled = req.enabled

    # Recompute next_run_at if schedule changed
    if any([req.schedule_type, req.schedule_value, req.enabled is not None]):
        if routine.enabled:
            routine.next_run_at = _compute_next_run(routine)
        else:
            routine.next_run_at = None

    await db.commit()
    return {"ok": True, "next_run_at": routine.next_run_at.isoformat() if routine.next_run_at else None}


@router.delete("/{routine_id}")
async def delete_routine(
    routine_id: str,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Delete a routine."""
    result = await db.execute(
        select(Routine).where(Routine.id == routine_id, Routine.user_id == user.id)
    )
    routine = result.scalar_one_or_none()
    if not routine:
        raise HTTPException(404, "Routine not found")

    await db.delete(routine)
    await db.commit()
    return {"ok": True}


@router.post("/{routine_id}/run")
async def trigger_routine(
    routine_id: str,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger a routine run (bypasses schedule)."""
    result = await db.execute(
        select(Routine).where(Routine.id == routine_id, Routine.user_id == user.id)
    )
    routine = result.scalar_one_or_none()
    if not routine:
        raise HTTPException(404, "Routine not found")

    # Run in background to avoid timeout
    from app.services.routine_worker import _run_routine
    asyncio.create_task(_run_routine(routine.id))

    return {"ok": True, "message": f"Routine '{routine.name}' triggered. Check notifications for results."}


@router.get("/{routine_id}/runs")
async def list_runs(
    routine_id: str,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """List run history for a routine."""
    # Verify ownership
    result = await db.execute(
        select(Routine).where(Routine.id == routine_id, Routine.user_id == user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Routine not found")

    result = await db.execute(
        select(RoutineRun)
        .where(RoutineRun.routine_id == routine_id)
        .order_by(RoutineRun.started_at.desc())
        .limit(20)
    )
    runs = result.scalars().all()
    return {
        "runs": [
            {
                "id": r.id,
                "status": r.status,
                "result_text": r.result_text[:500] if r.result_text else None,
                "conversation_id": r.conversation_id,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "error": r.error,
            }
            for r in runs
        ]
    }


# ── Apple Ecosystem Proxy ────────────────────────────────────────────

@router.post("/apple/calendar")
async def create_calendar_event(
    req: AppleCalendarEventRequest,
    user: User = Depends(get_current_user_required),
):
    """Create an Apple Calendar event."""
    from app.services.apple import apple_calendar_create_event
    result = await apple_calendar_create_event(
        title=req.title,
        start=req.start,
        end=req.end,
        calendar_name=req.calendar_name,
        notes=req.notes,
        location=req.location,
    )
    return result


@router.get("/apple/calendar")
async def get_calendar_events(
    days: int = 7,
    user: User = Depends(get_current_user_required),
):
    """List upcoming Apple Calendar events."""
    from app.services.apple import apple_calendar_list_events
    events = await apple_calendar_list_events(days_ahead=days)
    return {"events": events}


@router.post("/apple/reminders")
async def create_reminder(
    req: AppleReminderRequest,
    user: User = Depends(get_current_user_required),
):
    """Create an Apple Reminder."""
    from app.services.apple import apple_reminders_create
    result = await apple_reminders_create(
        name=req.name,
        due_date=req.due_date,
        notes=req.notes,
        list_name=req.list_name,
    )
    return result


@router.get("/apple/reminders")
async def get_reminders(
    list_name: str = "",
    user: User = Depends(get_current_user_required),
):
    """List incomplete Apple Reminders."""
    from app.services.apple import apple_reminders_list
    reminders = await apple_reminders_list(list_name=list_name)
    return {"reminders": reminders}


@router.post("/apple/notes")
async def create_note(
    req: AppleNoteRequest,
    user: User = Depends(get_current_user_required),
):
    """Create an Apple Note."""
    from app.services.apple import apple_notes_create
    result = await apple_notes_create(
        title=req.title,
        body=req.body,
        folder=req.folder,
    )
    return result


@router.get("/apple/notes")
async def get_notes(
    folder: str = "Notes",
    limit: int = 20,
    user: User = Depends(get_current_user_required),
):
    """List Apple Notes."""
    from app.services.apple import apple_notes_list
    notes = await apple_notes_list(folder=folder, limit=limit)
    return {"notes": notes}


@router.get("/apple/messages")
async def get_messages(
    hours: int = 24,
    limit: int = 50,
    user: User = Depends(get_current_user_required),
):
    """Read recent iMessages."""
    from app.services.apple import imessage_recent
    messages = await imessage_recent(hours=hours, limit=limit)
    return {"messages": messages}


# ── Notifications ────────────────────────────────────────────────────

@router.get("/notifications")
async def get_notifications(
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Get unread routine run results (for notification badge)."""
    result = await db.execute(
        select(RoutineRun)
        .where(
            RoutineRun.user_id == user.id,
            RoutineRun.status == "completed",
            RoutineRun.read_at.is_(None),
        )
        .order_by(RoutineRun.completed_at.desc())
        .limit(20)
    )
    runs = result.scalars().all()
    return {
        "unread_count": len(runs),
        "notifications": [
            {
                "id": r.id,
                "routine_id": r.routine_id,
                "result_preview": r.result_text[:200] if r.result_text else "",
                "conversation_id": r.conversation_id,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            }
            for r in runs
        ]
    }


@router.post("/notifications/read")
async def mark_notifications_read(
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Mark all notifications as read."""
    result = await db.execute(
        select(RoutineRun)
        .where(
            RoutineRun.user_id == user.id,
            RoutineRun.read_at.is_(None),
        )
    )
    runs = result.scalars().all()
    now = datetime.now(timezone.utc)
    for r in runs:
        r.read_at = now
    await db.commit()
    return {"ok": True, "marked": len(runs)}
