"""Job application agent API — profile management + agent control."""

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_required, get_db
from app.models.job_profile import JobApplication, JobProfile
from app.models.user import User
from app.services.job_agent import run_job_agent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/jobs", tags=["jobs"])


# ── Request / Response Schemas ────────────────────────────────────────


class SaveProfileRequest(BaseModel):
    full_name: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    linkedin_url: str = ""
    portfolio_url: str = ""
    target_roles: list[str] = []
    target_locations: list[str] = []
    salary_range: str = ""
    job_type: str = "full-time"
    additional_info: str = ""


class UploadCVRequest(BaseModel):
    base64: str
    filename: str
    mime_type: str
    text_content: str = ""  # pre-extracted text (frontend does this for PDFs)


class StartAgentRequest(BaseModel):
    board: str = "linkedin"  # linkedin | indeed | wttj | glassdoor | ycombinator
    search_query: str = ""
    location: str = ""
    job_type: str = "full-time"
    max_results: int = 5
    url: str = ""  # optional: direct URL to a specific job board page


class JobApplicationOut(BaseModel):
    id: str
    job_title: str
    company: str
    job_url: str
    board: str
    status: str
    applied_at: str | None
    created_at: str


# ── Profile Endpoints ─────────────────────────────────────────────────


@router.get("/profile")
async def get_profile(
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Get the user's job profile."""
    result = await db.execute(
        select(JobProfile).where(JobProfile.user_id == user.id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        return {"exists": False}

    return {
        "exists": True,
        "full_name": profile.full_name,
        "email": profile.email,
        "phone": profile.phone,
        "location": profile.location,
        "linkedin_url": profile.linkedin_url,
        "portfolio_url": profile.portfolio_url,
        "target_roles": json.loads(profile.target_roles) if profile.target_roles else [],
        "target_locations": json.loads(profile.target_locations) if profile.target_locations else [],
        "salary_range": profile.salary_range,
        "job_type": profile.job_type,
        "additional_info": profile.additional_info,
        "cv_filename": profile.cv_filename,
        "has_cv": bool(profile.cv_base64),
    }


@router.post("/profile")
async def save_profile(
    req: SaveProfileRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Save or update the user's job profile."""
    result = await db.execute(
        select(JobProfile).where(JobProfile.user_id == user.id)
    )
    profile = result.scalar_one_or_none()

    if not profile:
        profile = JobProfile(user_id=user.id)
        db.add(profile)

    profile.full_name = req.full_name
    profile.email = req.email
    profile.phone = req.phone
    profile.location = req.location
    profile.linkedin_url = req.linkedin_url
    profile.portfolio_url = req.portfolio_url
    profile.target_roles = json.dumps(req.target_roles)
    profile.target_locations = json.dumps(req.target_locations)
    profile.salary_range = req.salary_range
    profile.job_type = req.job_type
    profile.additional_info = req.additional_info
    profile.updated_at = datetime.utcnow()

    await db.commit()
    return {"ok": True}


@router.post("/profile/cv")
async def upload_cv(
    req: UploadCVRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Upload a CV/resume file."""
    result = await db.execute(
        select(JobProfile).where(JobProfile.user_id == user.id)
    )
    profile = result.scalar_one_or_none()

    if not profile:
        profile = JobProfile(user_id=user.id)
        db.add(profile)

    profile.cv_base64 = req.base64
    profile.cv_filename = req.filename
    profile.cv_mime_type = req.mime_type
    profile.cv_text = req.text_content
    profile.updated_at = datetime.utcnow()

    await db.commit()
    return {"ok": True, "filename": req.filename}


# ── Agent Control ─────────────────────────────────────────────────────


@router.post("/agent/start")
async def start_agent(
    req: StartAgentRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Start the job application agent. Returns SSE stream with live progress."""
    # Load profile
    result = await db.execute(
        select(JobProfile).where(JobProfile.user_id == user.id)
    )
    profile = result.scalar_one_or_none()

    if not profile:
        raise HTTPException(400, "No job profile found. Please set up your profile first.")

    if not profile.cv_text and not profile.cv_base64:
        raise HTTPException(400, "No CV uploaded. Please upload your resume first.")

    criteria = req.model_dump()
    logger.info(
        "Starting job agent for user %s: board=%s, query='%s', location='%s'",
        user.id, req.board, req.search_query, req.location,
    )

    async def event_generator():
        async for event in run_job_agent(
            user_id=user.id,
            profile=profile,
            criteria=criteria,
            db=db,
        ):
            yield event
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Application Tracking ──────────────────────────────────────────────


@router.get("/applications")
async def list_applications(
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """List all tracked job applications."""
    result = await db.execute(
        select(JobApplication)
        .where(JobApplication.user_id == user.id)
        .order_by(JobApplication.created_at.desc())
    )
    apps = result.scalars().all()

    return {
        "applications": [
            {
                "id": a.id,
                "job_title": a.job_title,
                "company": a.company,
                "job_url": a.job_url,
                "board": a.board,
                "status": a.status,
                "applied_at": a.applied_at.isoformat() if a.applied_at else None,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in apps
        ]
    }
