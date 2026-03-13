"""Workflow API — CRUD + steps + execution for the Workflow Builder."""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_required, get_db
from app.models.user import User
from app.models.workflow import Workflow, WorkflowRun, WorkflowStep
from app.services.workflow_engine import run_workflow

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/workflows", tags=["workflows"])


# ── Schemas ──────────────────────────────────────────────────────────

class CreateWorkflowRequest(BaseModel):
    name: str
    description: str = ""
    trigger_type: str = "manual"
    trigger_config: dict = {}


class UpdateWorkflowRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    trigger_type: str | None = None
    trigger_config: dict | None = None
    enabled: bool | None = None


class AddStepRequest(BaseModel):
    step_type: str
    config: dict = {}
    position: int | None = None
    on_success: str = "next"
    on_failure: str = "end"


class UpdateStepRequest(BaseModel):
    step_type: str | None = None
    config: dict | None = None
    position: int | None = None
    on_success: str | None = None
    on_failure: str | None = None


# ── Helpers ──────────────────────────────────────────────────────────

def _safe_json_loads(s: str | None, default=None):
    """Parse JSON string, returning default on failure."""
    if not s:
        return default if default is not None else {}
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else {}


def _workflow_to_dict(w: Workflow, steps: list[WorkflowStep] | None = None) -> dict:
    d = {
        "id": w.id,
        "name": w.name,
        "description": w.description,
        "trigger_type": w.trigger_type,
        "trigger_config": _safe_json_loads(w.trigger_config),
        "enabled": w.enabled,
        "created_at": w.created_at.isoformat() if w.created_at else None,
        "updated_at": w.updated_at.isoformat() if w.updated_at else None,
    }
    if steps is not None:
        d["steps"] = [
            {
                "id": s.id,
                "position": s.position,
                "step_type": s.step_type,
                "config": _safe_json_loads(s.config_json),
                "on_success": s.on_success,
                "on_failure": s.on_failure,
            }
            for s in sorted(steps, key=lambda x: x.position)
        ]
    return d


def _run_to_dict(r: WorkflowRun) -> dict:
    return {
        "id": r.id,
        "workflow_id": r.workflow_id,
        "status": r.status,
        "steps_completed": r.steps_completed,
        "result": _safe_json_loads(r.result_json),
        "error": r.error,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "completed_at": r.completed_at.isoformat() if r.completed_at else None,
    }


VALID_STEP_TYPES = {"email_check", "calendar_check", "apple_action", "whatsapp_check", "llm_call", "notification", "condition", "memory_save"}
VALID_TRIGGER_TYPES = {"manual", "schedule", "event"}


# ── Workflow CRUD ────────────────────────────────────────────────────

@router.get("/")
async def api_list_workflows(
    limit: int = Query(50, ge=1, le=100),
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """List all workflows for the current user."""
    result = await db.execute(
        select(Workflow)
        .where(Workflow.user_id == user.id)
        .order_by(Workflow.updated_at.desc())
        .limit(limit)
    )
    workflows = result.scalars().all()
    return {"workflows": [_workflow_to_dict(w) for w in workflows], "count": len(workflows)}


@router.post("/")
async def api_create_workflow(
    body: CreateWorkflowRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Create a new workflow."""
    if body.trigger_type not in VALID_TRIGGER_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid trigger_type. Use: {', '.join(VALID_TRIGGER_TYPES)}")

    wf = Workflow(
        user_id=user.id,
        name=body.name[:200],
        description=body.description,
        trigger_type=body.trigger_type,
        trigger_config=json.dumps(body.trigger_config),
    )
    db.add(wf)
    await db.commit()
    await db.refresh(wf)
    return _workflow_to_dict(wf, steps=[])


@router.get("/{workflow_id}")
async def api_get_workflow(
    workflow_id: str,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Get a workflow with all its steps."""
    result = await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.user_id == user.id)
    )
    wf = result.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    steps_result = await db.execute(
        select(WorkflowStep).where(WorkflowStep.workflow_id == workflow_id).order_by(WorkflowStep.position)
    )
    steps = steps_result.scalars().all()
    return _workflow_to_dict(wf, steps=list(steps))


@router.put("/{workflow_id}")
async def api_update_workflow(
    workflow_id: str,
    body: UpdateWorkflowRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Update a workflow."""
    result = await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.user_id == user.id)
    )
    wf = result.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if body.name is not None:
        wf.name = body.name[:200]
    if body.description is not None:
        wf.description = body.description
    if body.trigger_type is not None:
        if body.trigger_type not in VALID_TRIGGER_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid trigger_type")
        wf.trigger_type = body.trigger_type
    if body.trigger_config is not None:
        wf.trigger_config = json.dumps(body.trigger_config)
    if body.enabled is not None:
        wf.enabled = body.enabled

    await db.commit()
    await db.refresh(wf)
    return _workflow_to_dict(wf)


@router.delete("/{workflow_id}")
async def api_delete_workflow(
    workflow_id: str,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Delete a workflow and all its steps."""
    result = await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.user_id == user.id)
    )
    wf = result.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Delete runs first
    runs_result = await db.execute(
        select(WorkflowRun).where(WorkflowRun.workflow_id == workflow_id)
    )
    for run in runs_result.scalars().all():
        await db.delete(run)

    # Delete steps
    steps_result = await db.execute(
        select(WorkflowStep).where(WorkflowStep.workflow_id == workflow_id)
    )
    for step in steps_result.scalars().all():
        await db.delete(step)

    await db.delete(wf)
    await db.commit()
    return {"status": "deleted", "id": workflow_id}


# ── Step CRUD ────────────────────────────────────────────────────────

@router.post("/{workflow_id}/steps")
async def api_add_step(
    workflow_id: str,
    body: AddStepRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Add a step to a workflow."""
    result = await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.user_id == user.id)
    )
    wf = result.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if body.step_type not in VALID_STEP_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid step_type. Use: {', '.join(VALID_STEP_TYPES)}")

    # Auto-position at end if not specified
    if body.position is None:
        count_result = await db.execute(
            select(WorkflowStep).where(WorkflowStep.workflow_id == workflow_id)
        )
        existing = count_result.scalars().all()
        body.position = len(existing)

    step = WorkflowStep(
        workflow_id=workflow_id,
        position=body.position,
        step_type=body.step_type,
        config_json=json.dumps(body.config),
        on_success=body.on_success,
        on_failure=body.on_failure,
    )
    db.add(step)
    await db.commit()
    await db.refresh(step)

    return {
        "id": step.id,
        "position": step.position,
        "step_type": step.step_type,
        "config": json.loads(step.config_json),
        "on_success": step.on_success,
        "on_failure": step.on_failure,
    }


@router.put("/{workflow_id}/steps/{step_id}")
async def api_update_step(
    workflow_id: str,
    step_id: str,
    body: UpdateStepRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Update a workflow step."""
    # Verify workflow ownership
    wf_result = await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.user_id == user.id)
    )
    if not wf_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Workflow not found")

    result = await db.execute(
        select(WorkflowStep).where(WorkflowStep.id == step_id, WorkflowStep.workflow_id == workflow_id)
    )
    step = result.scalar_one_or_none()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    if body.step_type is not None:
        if body.step_type not in VALID_STEP_TYPES:
            raise HTTPException(status_code=400, detail="Invalid step_type")
        step.step_type = body.step_type
    if body.config is not None:
        step.config_json = json.dumps(body.config)
    if body.position is not None:
        step.position = body.position
    if body.on_success is not None:
        step.on_success = body.on_success
    if body.on_failure is not None:
        step.on_failure = body.on_failure

    await db.commit()
    await db.refresh(step)

    return {
        "id": step.id,
        "position": step.position,
        "step_type": step.step_type,
        "config": json.loads(step.config_json),
        "on_success": step.on_success,
        "on_failure": step.on_failure,
    }


@router.delete("/{workflow_id}/steps/{step_id}")
async def api_delete_step(
    workflow_id: str,
    step_id: str,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Delete a workflow step."""
    # Verify workflow ownership
    wf_result = await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.user_id == user.id)
    )
    if not wf_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Workflow not found")

    result = await db.execute(
        select(WorkflowStep).where(WorkflowStep.id == step_id, WorkflowStep.workflow_id == workflow_id)
    )
    step = result.scalar_one_or_none()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    await db.delete(step)
    await db.commit()
    return {"status": "deleted", "id": step_id}


# ── Execution ────────────────────────────────────────────────────────

@router.post("/{workflow_id}/run")
async def api_run_workflow(
    workflow_id: str,
    user: User = Depends(get_current_user_required),
):
    """Manually run a workflow."""
    result = await run_workflow(workflow_id, user.id)
    return result


@router.get("/{workflow_id}/runs")
async def api_list_runs(
    workflow_id: str,
    limit: int = Query(20, ge=1, le=50),
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """List past runs of a workflow."""
    # Verify ownership
    wf_result = await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.user_id == user.id)
    )
    if not wf_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Workflow not found")

    result = await db.execute(
        select(WorkflowRun)
        .where(WorkflowRun.workflow_id == workflow_id)
        .order_by(WorkflowRun.started_at.desc())
        .limit(limit)
    )
    runs = result.scalars().all()
    return {"runs": [_run_to_dict(r) for r in runs], "count": len(runs)}
