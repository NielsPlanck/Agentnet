"""Meeting Intelligence — debrief meetings, generate action items and follow-ups."""

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.meeting_intel import MeetingDebrief

log = logging.getLogger(__name__)


# ── Check for ended meetings ────────────────────────────────────────

async def check_ended_meetings(user_id: str, token: str, lookback_minutes: int = 60) -> list[dict]:
    """Find meetings that ended in the last N minutes and haven't been debriefed."""
    import httpx

    now = datetime.now(timezone.utc)
    past_start = (now - timedelta(minutes=lookback_minutes)).isoformat() + "Z"
    past_end = now.isoformat() + "Z"

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers={"Authorization": f"Bearer {token}"},
            params={
                "timeMin": past_start,
                "timeMax": past_end,
                "maxResults": 20,
                "singleEvents": "true",
                "orderBy": "startTime",
            },
        )
        if resp.status_code == 200:
            past_events = resp.json().get("items", [])
        else:
            past_events = []

    # Filter to events that have ended
    ended = []
    async with async_session() as db:
        for e in past_events:
            end_str = e.get("end", {}).get("dateTime") or e.get("end", {}).get("date", "")
            if not end_str:
                continue
            try:
                end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            except Exception:
                continue
            if end_dt > now:
                continue  # hasn't ended yet

            event_id = e["id"]
            # Check if already debriefed
            existing = await db.execute(
                select(MeetingDebrief).where(
                    MeetingDebrief.user_id == user_id,
                    MeetingDebrief.event_id == event_id,
                )
            )
            if existing.scalar_one_or_none():
                continue

            attendees = [a.get("email", "") for a in e.get("attendees", []) if a.get("email")]
            # Skip events with no other attendees (solo blocks / focus time)
            if len(attendees) < 2:
                continue

            ended.append({
                "id": event_id,
                "title": e.get("summary", "(No title)"),
                "start": e.get("start", {}).get("dateTime") or e.get("start", {}).get("date", ""),
                "end": end_str,
                "attendees": attendees,
                "description": e.get("description", ""),
                "location": e.get("location", ""),
            })

    return ended


# ── Debrief a meeting ───────────────────────────────────────────────

DEBRIEF_PROMPT = """You are a meeting intelligence assistant. Given a meeting's details, generate a structured debrief.

Meeting: {title}
Time: {start} to {end}
Attendees: {attendees}
Description: {description}
Location: {location}

Based on this meeting, generate a JSON object with these fields:
- "action_items": array of {{"task": "...", "assignee": "...", "due": "YYYY-MM-DD"}} — infer reasonable action items based on the meeting topic and attendees
- "follow_ups": array of {{"to": "email@example.com", "subject": "Re: Meeting Title", "body": "..."}} — draft follow-up emails to key attendees
- "notes": string — concise meeting notes summarizing what was likely discussed

Rules:
- Be professional and concise
- For action items, assign to "me" for the user's tasks, or use attendee emails for others
- Due dates should be within 1-2 weeks of the meeting
- Follow-up emails should be brief and action-oriented
- Keep notes under 200 words
- Return ONLY valid JSON, no markdown fences"""


async def debrief_meeting(user_id: str, event: dict) -> dict:
    """Generate a meeting debrief using LLM."""
    from google import genai
    from google.genai import types

    from app.config import settings

    client = genai.Client(api_key=settings.gemini_api_key)

    prompt = DEBRIEF_PROMPT.format(
        title=event.get("title", ""),
        start=event.get("start", ""),
        end=event.get("end", ""),
        attendees=", ".join(event.get("attendees", [])),
        description=event.get("description", "")[:500],
        location=event.get("location", ""),
    )

    # Inject memory context if available
    try:
        from app.services.memory import inject_memories
        memory_ctx = await inject_memories(user_id, event.get("title", ""))
        if memory_ctx:
            prompt += f"\n\nRelevant user context:\n{memory_ctx}"
    except Exception:
        pass

    response = await client.aio.models.generate_content(
        model=settings.gemini_chat_model,
        contents=[types.Content(role="user", parts=[types.Part.from_text(text=prompt)])],
        config=types.GenerateContentConfig(
            max_output_tokens=2048,
            temperature=0.3,
        ),
    )

    result_text = (response.text or "").strip()
    # Strip markdown fences if present
    if result_text.startswith("```"):
        result_text = result_text.split("\n", 1)[1] if "\n" in result_text else result_text[3:]
    if result_text.endswith("```"):
        result_text = result_text[:-3]
    result_text = result_text.strip()

    try:
        data = json.loads(result_text)
    except json.JSONDecodeError:
        data = {"action_items": [], "follow_ups": [], "notes": result_text}

    # Save to DB
    start_dt = None
    end_dt = None
    try:
        start_dt = datetime.fromisoformat(event["start"].replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(event["end"].replace("Z", "+00:00"))
    except Exception:
        pass

    async with async_session() as db:
        debrief = MeetingDebrief(
            user_id=user_id,
            event_id=event["id"],
            event_title=event.get("title", ""),
            event_start=start_dt,
            event_end=end_dt,
            attendees_json=json.dumps(event.get("attendees", [])),
            action_items_json=json.dumps(data.get("action_items", [])),
            follow_up_emails_json=json.dumps(data.get("follow_ups", [])),
            notes_text=data.get("notes", ""),
            status="processed",
        )
        db.add(debrief)
        await db.commit()
        await db.refresh(debrief)

        return _debrief_to_dict(debrief)


# ── List recent debriefs ────────────────────────────────────────────

async def list_debriefs(user_id: str, limit: int = 20) -> list[dict]:
    """List recent meeting debriefs."""
    async with async_session() as db:
        result = await db.execute(
            select(MeetingDebrief)
            .where(MeetingDebrief.user_id == user_id)
            .order_by(MeetingDebrief.created_at.desc())
            .limit(limit)
        )
        debriefs = result.scalars().all()
        return [_debrief_to_dict(d) for d in debriefs]


async def get_debrief(user_id: str, debrief_id: str) -> dict | None:
    """Get a single debrief."""
    async with async_session() as db:
        result = await db.execute(
            select(MeetingDebrief).where(
                MeetingDebrief.id == debrief_id,
                MeetingDebrief.user_id == user_id,
            )
        )
        debrief = result.scalar_one_or_none()
        return _debrief_to_dict(debrief) if debrief else None


# ── Execute actions from a debrief ──────────────────────────────────

async def execute_debrief_actions(user_id: str, debrief_id: str) -> list[str]:
    """Execute all actions from a debrief: create reminders, notes, email drafts."""
    from app.services.apple import apple_notes_create, apple_reminders_create

    actions_taken: list[str] = []

    async with async_session() as db:
        result = await db.execute(
            select(MeetingDebrief).where(
                MeetingDebrief.id == debrief_id,
                MeetingDebrief.user_id == user_id,
            )
        )
        debrief = result.scalar_one_or_none()
        if not debrief:
            return ["Debrief not found"]

        # Create reminders for action items
        try:
            action_items = json.loads(debrief.action_items_json)
            for item in action_items:
                if item.get("assignee", "").lower() in ("me", "myself", user_id):
                    try:
                        await apple_reminders_create(
                            name=item["task"],
                            due_date=item.get("due", ""),
                            notes=f"From meeting: {debrief.event_title}",
                        )
                        actions_taken.append(f"Created reminder: {item['task']}")
                    except Exception as e:
                        log.warning("Failed to create reminder: %s", e)
        except json.JSONDecodeError:
            pass

        # Create notes
        if debrief.notes_text:
            try:
                await apple_notes_create(
                    title=f"Meeting Notes: {debrief.event_title}",
                    body=debrief.notes_text,
                    folder="Notes",
                )
                actions_taken.append(f"Created note: Meeting Notes: {debrief.event_title}")
            except Exception as e:
                log.warning("Failed to create note: %s", e)

        return actions_taken


# ── Helpers ─────────────────────────────────────────────────────────

def _debrief_to_dict(d: MeetingDebrief) -> dict:
    return {
        "id": d.id,
        "event_id": d.event_id,
        "event_title": d.event_title,
        "event_start": d.event_start.isoformat() if d.event_start else None,
        "event_end": d.event_end.isoformat() if d.event_end else None,
        "attendees": json.loads(d.attendees_json),
        "action_items": json.loads(d.action_items_json),
        "follow_ups": json.loads(d.follow_up_emails_json),
        "notes": d.notes_text,
        "status": d.status,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }
