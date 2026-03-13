"""Background routine worker — polls for due routines every 30s, runs them via LLM.

Follows the same pattern as crawl_worker.py:
  async loop → find due routines → gather context → call LLM → save result → send notification.
"""

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from croniter import croniter
from sqlalchemy import select

from app.database import async_session
from app.models.routine import Routine, RoutineRun
from app.models.training import Conversation, Message

log = logging.getLogger(__name__)

POLL_INTERVAL = 30  # seconds between polls


# ── Schedule helpers ─────────────────────────────────────────────────

def _compute_next_run(routine: Routine) -> datetime | None:
    """Compute the next run time based on schedule_type and schedule_value."""
    now = datetime.now(timezone.utc)

    if routine.schedule_type == "cron":
        try:
            cron = croniter(routine.schedule_value, now)
            return cron.get_next(datetime)
        except Exception:
            log.error("Invalid cron expression for routine %s: %s", routine.id, routine.schedule_value)
            return None

    elif routine.schedule_type == "interval":
        delta = _parse_interval(routine.schedule_value)
        if delta:
            return now + delta
        log.error("Invalid interval for routine %s: %s", routine.id, routine.schedule_value)
        return None

    elif routine.schedule_type == "one_shot":
        # One-shot routines don't repeat
        return None

    return None


def _parse_interval(value: str) -> timedelta | None:
    """Parse interval strings like '5h', '30m', '1d', '2h30m'."""
    total = timedelta()
    found = False

    for match in re.finditer(r"(\d+)\s*([dhms])", value.lower()):
        found = True
        num = int(match.group(1))
        unit = match.group(2)
        if unit == "d":
            total += timedelta(days=num)
        elif unit == "h":
            total += timedelta(hours=num)
        elif unit == "m":
            total += timedelta(minutes=num)
        elif unit == "s":
            total += timedelta(seconds=num)

    return total if found else None


# ── Context gathering ────────────────────────────────────────────────

async def _gather_apple_context(prompt: str) -> str:
    """Based on keywords in the routine prompt, gather relevant Apple data."""
    from app.services.apple import (
        apple_calendar_list_events,
        apple_notes_list,
        apple_reminders_list,
        imessage_recent,
    )

    prompt_lower = prompt.lower()
    context_parts: list[str] = []

    # Current date/time
    now = datetime.now()
    context_parts.append(f"Current date/time: {now.strftime('%A, %B %d, %Y at %I:%M %p')}")
    context_parts.append("")

    # Calendar events
    calendar_keywords = ["calendar", "meeting", "schedule", "today", "briefing", "morning", "daily", "agenda", "event"]
    if any(kw in prompt_lower for kw in calendar_keywords):
        try:
            events = await apple_calendar_list_events(days_ahead=2)
            if events:
                context_parts.append("UPCOMING CALENDAR EVENTS:")
                for e in events[:15]:
                    context_parts.append(f"  - {e['title']} | {e['start']} → {e['end']} | Calendar: {e['calendar']}")
                    if e.get("location"):
                        context_parts.append(f"    Location: {e['location']}")
                    if e.get("notes"):
                        context_parts.append(f"    Notes: {e['notes'][:100]}")
            else:
                context_parts.append("CALENDAR: No upcoming events in the next 2 days.")
            context_parts.append("")
        except Exception as e:
            log.warning("Failed to fetch calendar events: %s", e)

    # Reminders
    reminder_keywords = ["reminder", "task", "todo", "to-do", "to do"]
    if any(kw in prompt_lower for kw in reminder_keywords):
        try:
            reminders = await apple_reminders_list()
            if reminders:
                context_parts.append("PENDING REMINDERS:")
                for r in reminders[:15]:
                    due = f" (due: {r['due_date']})" if r.get("due_date") else ""
                    context_parts.append(f"  - {r['name']}{due}")
                    if r.get("notes"):
                        context_parts.append(f"    Notes: {r['notes'][:100]}")
            else:
                context_parts.append("REMINDERS: No pending reminders.")
            context_parts.append("")
        except Exception as e:
            log.warning("Failed to fetch reminders: %s", e)

    # iMessages
    message_keywords = ["message", "imessage", "text", "sms", "whatsapp", "conversation"]
    if any(kw in prompt_lower for kw in message_keywords):
        try:
            messages = await imessage_recent(hours=24, limit=30)
            if messages:
                context_parts.append("RECENT MESSAGES (last 24h):")
                for m in messages[:20]:
                    sender = "Me" if m["from"] == "me" else m["from"]
                    context_parts.append(f"  [{m['time']}] {sender}: {m['text'][:150]}")
            else:
                context_parts.append("MESSAGES: No recent messages.")
            context_parts.append("")
        except Exception as e:
            log.warning("Failed to fetch iMessages: %s", e)

    # Notes
    notes_keywords = ["note", "notes"]
    if any(kw in prompt_lower for kw in notes_keywords):
        try:
            notes = await apple_notes_list(limit=10)
            if notes:
                context_parts.append("RECENT NOTES:")
                for n in notes[:10]:
                    context_parts.append(f"  - {n['title']} (modified: {n['modified']})")
                    if n.get("preview"):
                        context_parts.append(f"    Preview: {n['preview'][:100]}")
            context_parts.append("")
        except Exception as e:
            log.warning("Failed to fetch notes: %s", e)

    # Email / Inbox
    email_keywords = ["email", "inbox", "gmail", "mail", "unread"]
    if any(kw in prompt_lower for kw in email_keywords):
        try:
            from app.services.email_intel import get_latest_digest
            from app.models.routine import Routine
            # Get user_id from the routine being run — we add it to context_parts
            context_parts.append("EMAIL DIGEST: (use /v1/inbox/scan to fetch fresh data)")
            context_parts.append("")
        except Exception as e:
            log.warning("Failed to gather email context: %s", e)

    return "\n".join(context_parts)


# ── LLM call ─────────────────────────────────────────────────────────

ROUTINE_SYSTEM_PROMPT = """You are a proactive AI assistant running a scheduled routine.
You have access to the user's Apple Calendar, Reminders, Notes, and iMessages.

Based on the context provided, fulfill the routine's instructions.

You can CREATE actions by emitting these tags in your response:

Calendar event:
[APPLE_CALENDAR]{"title":"...","start":"YYYY-MM-DD HH:MM","end":"YYYY-MM-DD HH:MM","location":"...","notes":"...","calendar_name":"..."}[/APPLE_CALENDAR]

Reminder:
[APPLE_REMINDER]{"name":"...","due_date":"YYYY-MM-DD HH:MM","notes":"...","list_name":"Reminders"}[/APPLE_REMINDER]

Note:
[APPLE_NOTE]{"title":"...","body":"...","folder":"Notes"}[/APPLE_NOTE]

Rules:
- Be concise and actionable. The user will read this as a notification.
- Summarize what matters, skip what doesn't.
- If the routine asks for a briefing, prioritize: upcoming meetings, pending tasks, important messages.
- If creating calendar events or reminders, emit the appropriate tags.
- Use natural language dates in the tags (the backend parses them).
- Keep your response under 500 words.
- NEVER use emojis."""


async def _call_llm(prompt: str, context: str) -> str:
    """Call Gemini with the routine prompt and gathered context."""
    from google import genai
    from google.genai import types

    from app.config import settings

    client = genai.Client(api_key=settings.gemini_api_key)

    user_text = f"""ROUTINE INSTRUCTIONS:
{prompt}

CONTEXT:
{context}

Execute this routine now. Be concise and actionable."""

    contents = [
        types.Content(
            role="user",
            parts=[types.Part.from_text(text=user_text)],
        )
    ]

    response = await client.aio.models.generate_content(
        model=settings.gemini_chat_model,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=ROUTINE_SYSTEM_PROMPT,
            max_output_tokens=2048,
            temperature=0.3,
        ),
    )
    return response.text or ""


# ── Action parsing & execution ───────────────────────────────────────

async def _execute_apple_actions(text: str) -> list[str]:
    """Parse LLM output for Apple action tags and execute them. Returns list of action descriptions."""
    from app.services.apple import (
        apple_calendar_create_event,
        apple_notes_create,
        apple_reminders_create,
    )

    actions_taken: list[str] = []

    # Calendar events
    for match in re.finditer(r"\[APPLE_CALENDAR\](.*?)\[/APPLE_CALENDAR\]", text, re.DOTALL):
        try:
            data = json.loads(match.group(1))
            await apple_calendar_create_event(
                title=data.get("title", "Untitled"),
                start=data.get("start", ""),
                end=data.get("end", ""),
                calendar_name=data.get("calendar_name", ""),
                notes=data.get("notes", ""),
                location=data.get("location", ""),
            )
            actions_taken.append(f"Created calendar event: {data.get('title', 'Untitled')}")
        except Exception as e:
            log.error("Failed to create calendar event: %s", e)

    # Reminders
    for match in re.finditer(r"\[APPLE_REMINDER\](.*?)\[/APPLE_REMINDER\]", text, re.DOTALL):
        try:
            data = json.loads(match.group(1))
            await apple_reminders_create(
                name=data.get("name", "Untitled"),
                due_date=data.get("due_date", ""),
                notes=data.get("notes", ""),
                list_name=data.get("list_name", ""),
            )
            actions_taken.append(f"Created reminder: {data.get('name', 'Untitled')}")
        except Exception as e:
            log.error("Failed to create reminder: %s", e)

    # Notes
    for match in re.finditer(r"\[APPLE_NOTE\](.*?)\[/APPLE_NOTE\]", text, re.DOTALL):
        try:
            data = json.loads(match.group(1))
            await apple_notes_create(
                title=data.get("title", "Untitled"),
                body=data.get("body", ""),
                folder=data.get("folder", "Notes"),
            )
            actions_taken.append(f"Created note: {data.get('title', 'Untitled')}")
        except Exception as e:
            log.error("Failed to create note: %s", e)

    return actions_taken


# ── Routine execution ────────────────────────────────────────────────

async def _run_routine(routine_id: str):
    """Execute a single routine: gather context, call LLM, save result, notify."""
    from app.services.apple import send_notification

    async with async_session() as db:
        result = await db.execute(select(Routine).where(Routine.id == routine_id))
        routine = result.scalar_one_or_none()
        if not routine:
            return

        # Create run record
        run = RoutineRun(
            routine_id=routine.id,
            user_id=routine.user_id,
            status="running",
        )
        db.add(run)
        routine.last_run_at = datetime.now(timezone.utc)
        await db.commit()

        try:
            # 1. Gather Apple context
            context = await _gather_apple_context(routine.prompt)

            # 2. Call LLM
            llm_result = await _call_llm(routine.prompt, context)
            log.info("Routine %s (%s) LLM result: %s", routine.id, routine.name, llm_result[:200])

            # 3. Execute any Apple actions from the response
            actions = await _execute_apple_actions(llm_result)
            if actions:
                log.info("Routine %s executed actions: %s", routine.id, actions)

            # 4. Strip action tags from display text
            display_text = re.sub(r"\[APPLE_CALENDAR\].*?\[/APPLE_CALENDAR\]", "", llm_result, flags=re.DOTALL)
            display_text = re.sub(r"\[APPLE_REMINDER\].*?\[/APPLE_REMINDER\]", "", display_text, flags=re.DOTALL)
            display_text = re.sub(r"\[APPLE_NOTE\].*?\[/APPLE_NOTE\]", "", display_text, flags=re.DOTALL)
            display_text = display_text.strip()

            # Add action summary if any
            if actions:
                display_text += "\n\n---\nActions taken:\n" + "\n".join(f"- {a}" for a in actions)

            # 5. Save as conversation in chat history
            conv = Conversation(
                user_id=routine.user_id,
                title=f"Routine: {routine.name}",
            )
            db.add(conv)
            await db.flush()

            # Add assistant message with the briefing
            db.add(Message(
                conversation_id=conv.id,
                seq=1,
                role="assistant",
                content=display_text,
            ))

            # 6. Update run record
            run.status = "completed"
            run.result_text = display_text
            run.conversation_id = conv.id
            run.completed_at = datetime.now(timezone.utc)

            # 7. Compute next run time
            routine.next_run_at = _compute_next_run(routine)
            if routine.schedule_type == "one_shot":
                routine.enabled = False

            await db.commit()

            # 8. Send macOS notification
            preview = display_text[:150].replace("\n", " ")
            try:
                await send_notification(
                    title=f"AgentNet: {routine.name}",
                    message=preview,
                )
                run.notified = True
                await db.commit()
            except Exception as e:
                log.warning("Failed to send notification for routine %s: %s", routine.id, e)

            log.info("Routine %s (%s) completed successfully", routine.id, routine.name)

        except Exception as e:
            log.exception("Routine %s failed: %s", routine.id, e)
            run.status = "failed"
            run.error = str(e)[:1000]
            run.completed_at = datetime.now(timezone.utc)

            # Still compute next run so it retries on schedule
            routine.next_run_at = _compute_next_run(routine)
            await db.commit()


# ── Main worker loop ─────────────────────────────────────────────────

async def _check_scheduled_workflows():
    """Check for scheduled workflows that are due and run them."""
    try:
        from app.models.workflow import Workflow
        from app.services.workflow_engine import run_workflow

        now = datetime.now(timezone.utc)
        async with async_session() as db:
            result = await db.execute(
                select(Workflow).where(
                    Workflow.enabled == True,  # noqa: E712
                    Workflow.trigger_type == "schedule",
                )
            )
            workflows = result.scalars().all()

        for wf in workflows:
            try:
                trigger_config = json.loads(wf.trigger_config) if wf.trigger_config else {}
                cron_expr = trigger_config.get("cron", "")
                if not cron_expr:
                    continue

                # Check if it's time to run
                cron = croniter(cron_expr, now - timedelta(seconds=POLL_INTERVAL))
                next_run = cron.get_next(datetime)
                if next_run <= now:
                    # Check if we already ran recently (within last POLL_INTERVAL * 2 seconds)
                    # to avoid double-runs
                    last_run_key = f"_wf_last_run_{wf.id}"
                    last_run = _workflow_last_runs.get(last_run_key)
                    if last_run and (now - last_run).total_seconds() < POLL_INTERVAL * 2:
                        continue

                    _workflow_last_runs[last_run_key] = now
                    log.info("Running scheduled workflow %s (%s)", wf.id, wf.name)
                    result = await run_workflow(wf.id, wf.user_id)
                    log.info("Scheduled workflow %s completed: %s", wf.id, result.get("status"))

                    # Send notification
                    try:
                        from app.services.apple import send_notification
                        status = result.get("status", "unknown")
                        await send_notification(
                            title=f"Workflow: {wf.name}",
                            message=f"Completed ({status}) — {result.get('steps_completed', 0)} steps run",
                        )
                    except Exception:
                        pass

            except Exception:
                log.exception("Error running scheduled workflow %s", wf.id)

    except ImportError:
        pass  # Workflow models not available
    except Exception:
        log.exception("Scheduled workflow check failed")


# Simple in-memory cache to prevent double-runs of scheduled workflows
_workflow_last_runs: dict[str, datetime] = {}


async def run_routine_worker():
    """Main worker loop — polls for due routines every 30s, also runs scheduled workflows."""
    log.info("Routine worker started (poll interval: %ds)", POLL_INTERVAL)

    while True:
        try:
            now = datetime.now(timezone.utc)
            async with async_session() as db:
                stmt = (
                    select(Routine)
                    .where(
                        Routine.enabled == True,  # noqa: E712
                        Routine.next_run_at <= now,
                        Routine.next_run_at.isnot(None),
                    )
                    .limit(5)
                )
                result = await db.execute(stmt)
                due = result.scalars().all()
                routine_ids = [r.id for r in due]

            if routine_ids:
                log.info("Running %d due routine(s)", len(routine_ids))
                # Run sequentially to avoid DB contention with SQLite
                for rid in routine_ids:
                    await _run_routine(rid)

            # Also check scheduled workflows
            await _check_scheduled_workflows()

        except Exception:
            log.exception("Routine worker loop error")

        await asyncio.sleep(POLL_INTERVAL)
