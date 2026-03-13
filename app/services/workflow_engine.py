"""Workflow Engine — executes workflow steps sequentially with context passing."""

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.workflow import Workflow, WorkflowRun, WorkflowStep

log = logging.getLogger(__name__)


# ── Step executors ──────────────────────────────────────────────────

async def _execute_email_check(config: dict, context: dict, user_id: str) -> dict:
    """Check inbox and return categorized emails."""
    try:
        from app.services.email_intel import get_latest_digest
        digest = await get_latest_digest(user_id)
        if digest:
            return {"status": "ok", "digest": digest, "urgent_count": digest.get("urgent_count", 0)}
        return {"status": "ok", "digest": None, "message": "No recent digest"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _execute_calendar_check(config: dict, context: dict, user_id: str) -> dict:
    """Check calendar events."""
    try:
        from app.services.apple import apple_calendar_list_events
        days = config.get("days_ahead", 2)
        events = await apple_calendar_list_events(days_ahead=days)
        return {"status": "ok", "events": events, "count": len(events)}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _execute_apple_action(config: dict, context: dict, user_id: str) -> dict:
    """Create Apple Calendar event, Reminder, or Note."""
    action_type = config.get("action_type", "")
    try:
        if action_type == "reminder":
            from app.services.apple import apple_reminders_create
            await apple_reminders_create(
                name=config.get("name", ""),
                due_date=config.get("due_date", ""),
                notes=config.get("notes", ""),
                list_name=config.get("list_name", ""),
            )
            return {"status": "ok", "action": f"Created reminder: {config.get('name', '')}"}
        elif action_type == "calendar":
            from app.services.apple import apple_calendar_create_event
            await apple_calendar_create_event(
                title=config.get("title", ""),
                start=config.get("start", ""),
                end=config.get("end", ""),
                notes=config.get("notes", ""),
            )
            return {"status": "ok", "action": f"Created event: {config.get('title', '')}"}
        elif action_type == "note":
            from app.services.apple import apple_notes_create
            await apple_notes_create(
                title=config.get("title", ""),
                body=config.get("body", ""),
                folder=config.get("folder", "Notes"),
            )
            return {"status": "ok", "action": f"Created note: {config.get('title', '')}"}
        return {"status": "error", "error": f"Unknown action_type: {action_type}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _execute_whatsapp_check(config: dict, context: dict, user_id: str) -> dict:
    """Check WhatsApp recent chats."""
    try:
        from app.services.whatsapp import get_whatsapp_session
        session = await get_whatsapp_session(user_id)
        if not await session.is_authenticated():
            return {"status": "error", "error": "WhatsApp not authenticated"}
        chats = await session.list_chats(limit=config.get("limit", 10))
        return {"status": "ok", "chats": chats, "count": len(chats)}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _execute_llm_call(config: dict, context: dict, user_id: str) -> dict:
    """Call LLM with a prompt and accumulated context."""
    from google import genai
    from google.genai import types

    from app.config import settings

    client = genai.Client(api_key=settings.gemini_api_key)

    prompt = config.get("prompt", "")
    # Inject accumulated context from previous steps
    if context:
        prompt += f"\n\nContext from previous steps:\n{json.dumps(context, indent=2, default=str)[:3000]}"

    try:
        response = await client.aio.models.generate_content(
            model=settings.gemini_chat_model,
            contents=[types.Content(role="user", parts=[types.Part.from_text(text=prompt)])],
            config=types.GenerateContentConfig(max_output_tokens=1024, temperature=0.3),
        )
        return {"status": "ok", "result": response.text or ""}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _execute_notification(config: dict, context: dict, user_id: str) -> dict:
    """Send macOS notification."""
    try:
        from app.services.apple import send_notification
        title = config.get("title", "AgentNet Workflow")
        message = config.get("message", "")
        # Interpolate context into message
        if "{result}" in message and context.get("result"):
            message = message.replace("{result}", str(context["result"])[:200])
        await send_notification(title=title, message=message[:200])
        return {"status": "ok", "action": f"Sent notification: {title}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _execute_condition(config: dict, context: dict, user_id: str) -> dict:
    """Evaluate a simple condition on the accumulated context."""
    field = config.get("field", "")
    operator = config.get("operator", "exists")
    value = config.get("value", "")

    # Navigate into context
    ctx_value = context.get(field)

    if operator == "exists":
        result = ctx_value is not None and ctx_value != "" and ctx_value != 0
    elif operator == "gt":
        result = (ctx_value or 0) > float(value)
    elif operator == "lt":
        result = (ctx_value or 0) < float(value)
    elif operator == "eq":
        result = str(ctx_value) == str(value)
    elif operator == "contains":
        result = str(value).lower() in str(ctx_value or "").lower()
    else:
        result = False

    return {"status": "ok", "condition_met": result, "branch": "success" if result else "failure"}


async def _execute_memory_save(config: dict, context: dict, user_id: str) -> dict:
    """Store a result in the Memory system."""
    try:
        from app.models.memory import Memory

        key = config.get("key", "Workflow result")
        content = config.get("content", "")
        if "{result}" in content and context.get("result"):
            content = content.replace("{result}", str(context["result"])[:500])
        category = config.get("category", "fact")

        async with async_session() as db:
            mem = Memory(
                user_id=user_id,
                category=category,
                key=key[:200],
                content=content,
                source="workflow",
                importance=0.5,
            )
            db.add(mem)
            await db.commit()

        return {"status": "ok", "action": f"Saved memory: {key}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ── Step dispatcher ─────────────────────────────────────────────────

STEP_EXECUTORS = {
    "email_check": _execute_email_check,
    "calendar_check": _execute_calendar_check,
    "apple_action": _execute_apple_action,
    "whatsapp_check": _execute_whatsapp_check,
    "llm_call": _execute_llm_call,
    "notification": _execute_notification,
    "condition": _execute_condition,
    "memory_save": _execute_memory_save,
}


async def execute_step(step: WorkflowStep, context: dict, user_id: str) -> dict:
    """Execute a single workflow step."""
    try:
        config = json.loads(step.config_json)
    except json.JSONDecodeError:
        config = {}

    executor = STEP_EXECUTORS.get(step.step_type)
    if not executor:
        return {"status": "error", "error": f"Unknown step type: {step.step_type}"}

    return await executor(config, context, user_id)


# ── Workflow runner ─────────────────────────────────────────────────

async def run_workflow(workflow_id: str, user_id: str) -> dict:
    """Execute a workflow's steps sequentially, passing context between steps."""
    # Load workflow, steps, and create run record inside a single session.
    # Capture all needed scalar values so we don't access detached ORM objects later.
    step_data: list[dict] = []
    run_id: str = ""

    async with async_session() as db:
        # Load workflow
        result = await db.execute(
            select(Workflow).where(Workflow.id == workflow_id, Workflow.user_id == user_id)
        )
        workflow = result.scalar_one_or_none()
        if not workflow:
            return {"status": "error", "error": "Workflow not found"}

        # Load steps — capture as plain dicts to avoid detached ORM issues
        result = await db.execute(
            select(WorkflowStep)
            .where(WorkflowStep.workflow_id == workflow_id)
            .order_by(WorkflowStep.position)
        )
        steps = result.scalars().all()
        if not steps:
            return {"status": "error", "error": "Workflow has no steps"}

        for s in steps:
            step_data.append({
                "id": s.id,
                "position": s.position,
                "step_type": s.step_type,
                "config_json": s.config_json,
                "on_success": s.on_success,
                "on_failure": s.on_failure,
            })

        # Create run record
        run = WorkflowRun(
            workflow_id=workflow_id,
            user_id=user_id,
            status="running",
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        run_id = run.id

    # Execute steps — use plain dicts instead of detached ORM objects
    accumulated_context: dict = {}
    steps_completed = 0

    try:
        for sd in step_data:
            log.info("Workflow %s: executing step %d (%s)", workflow_id, sd["position"], sd["step_type"])

            # Build a lightweight step-like object for execute_step
            step_result = await _execute_step_from_dict(sd, accumulated_context, user_id)

            # Namespace the result by step position to avoid key collisions
            step_key = f"step_{sd['position']}_{sd['step_type']}"
            accumulated_context[step_key] = step_result
            # Also keep latest top-level values for backward compat & condition checks
            accumulated_context.update(step_result)
            steps_completed += 1

            # Check for condition branching
            if sd["step_type"] == "condition":
                if not step_result.get("condition_met", True):
                    if sd["on_failure"] == "end":
                        log.info("Workflow %s: condition not met, ending", workflow_id)
                        break
                else:
                    if sd["on_success"] == "end":
                        break

            # Check for step failure
            if step_result.get("status") == "error":
                if sd["on_failure"] == "end":
                    log.warning("Workflow %s: step failed, ending. Error: %s", workflow_id, step_result.get("error"))
                    break

        # Update run record
        async with async_session() as db:
            result = await db.execute(select(WorkflowRun).where(WorkflowRun.id == run_id))
            run = result.scalar_one()
            run.status = "completed"
            run.steps_completed = steps_completed
            run.result_json = json.dumps(accumulated_context, default=str)[:5000]
            run.completed_at = datetime.now(timezone.utc)
            await db.commit()

        return {
            "status": "completed",
            "run_id": run_id,
            "steps_completed": steps_completed,
            "result": accumulated_context,
        }

    except Exception as e:
        log.exception("Workflow %s failed: %s", workflow_id, e)
        async with async_session() as db:
            result = await db.execute(select(WorkflowRun).where(WorkflowRun.id == run_id))
            run = result.scalar_one()
            run.status = "failed"
            run.steps_completed = steps_completed
            run.error = str(e)[:1000]
            run.completed_at = datetime.now(timezone.utc)
            await db.commit()

        return {"status": "failed", "error": str(e), "steps_completed": steps_completed}


async def _execute_step_from_dict(sd: dict, context: dict, user_id: str) -> dict:
    """Execute a step from a plain dict (avoiding detached ORM objects)."""
    try:
        config = json.loads(sd["config_json"])
    except json.JSONDecodeError:
        config = {}

    executor = STEP_EXECUTORS.get(sd["step_type"])
    if not executor:
        return {"status": "error", "error": f"Unknown step type: {sd['step_type']}"}

    return await executor(config, context, user_id)
