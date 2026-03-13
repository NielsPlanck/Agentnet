"""Campaign API — B2B multichannel prospecting system.

CRUD for campaigns, prospects, sequence steps, and AI copy generation.
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.api.session_utils import get_or_create_session
from app.models.campaign import Campaign, CampaignProspect, OutreachLog, SequenceStep

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/campaigns", tags=["campaigns"])


# ── Schemas ───────────────────────────────────────────────────────

class CreateCampaignRequest(BaseModel):
    name: str
    description: str = ""
    default_tier: int = 2
    target_industry: str = ""
    target_role: str = ""
    target_company_size: str = ""
    target_location: str = ""


class UpdateCampaignRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    default_tier: int | None = None
    target_industry: str | None = None
    target_role: str | None = None
    target_company_size: str | None = None
    target_location: str | None = None


class AddProspectRequest(BaseModel):
    name: str
    email: str = ""
    company: str = ""
    title: str = ""
    linkedin: str = ""
    phone: str = ""
    website: str = ""
    tier: int | None = None  # None = use campaign default
    personalization: str = ""
    notes: str = ""


class BulkAddProspectsRequest(BaseModel):
    prospects: list[AddProspectRequest]


class UpdateProspectRequest(BaseModel):
    name: str | None = None
    email: str | None = None
    company: str | None = None
    title: str | None = None
    linkedin: str | None = None
    phone: str | None = None
    tier: int | None = None
    prospect_status: str | None = None
    personalization: str | None = None
    notes: str | None = None


class AddSequenceStepRequest(BaseModel):
    step_order: int
    step_type: str  # email, linkedin_connect, linkedin_message, linkedin_voice_note, call, reminder
    delay_days: int = 0
    subject_template: str = ""
    body_template: str = ""
    instructions: str = ""


class GenerateCopyRequest(BaseModel):
    channel: str
    prospect_id: str | None = None  # if provided, uses prospect context
    sender_name: str = ""
    sender_company: str = ""
    value_proposition: str = ""
    step_number: int = 1
    is_followup: bool = False


class GenerateSequenceRequest(BaseModel):
    tier: int = 2
    value_proposition: str = ""
    target_industry: str = ""
    target_role: str = ""


class LogOutreachRequest(BaseModel):
    step_order: int
    step_type: str
    action: str = "sent"  # sent, skipped, bounced, replied
    subject: str = ""
    body: str = ""


class EnrichProspectRequest(BaseModel):
    """Request to enrich a prospect with person intelligence."""
    topics: list[str] | None = None


# ── Helpers ───────────────────────────────────────────────────────

async def _get_session_id(request: Request, response: Response, db: AsyncSession) -> str:
    session = await get_or_create_session(request, response, db)
    return session.id


def _campaign_to_dict(c: Campaign, include_details: bool = False) -> dict:
    # Use __dict__ to avoid async lazy-loading errors
    prospects = c.__dict__.get("prospects") or []
    seq_steps = c.__dict__.get("sequence_steps") or []
    data = {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "status": c.status,
        "default_tier": c.default_tier,
        "target_industry": c.target_industry,
        "target_role": c.target_role,
        "target_company_size": c.target_company_size,
        "target_location": c.target_location,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "prospect_count": len(prospects),
        "step_count": len(seq_steps),
    }
    if include_details:
        data["prospects"] = [_prospect_to_dict(p) for p in prospects]
        data["sequence_steps"] = [_step_to_dict(s) for s in seq_steps]
    return data


def _prospect_to_dict(p: CampaignProspect) -> dict:
    # Use __dict__ to avoid async lazy-loading errors
    logs = p.__dict__.get("outreach_logs") or []
    return {
        "id": p.id,
        "name": p.name,
        "email": p.email,
        "company": p.company,
        "title": p.title,
        "linkedin": p.linkedin,
        "phone": p.phone,
        "website": p.website,
        "tier": p.tier,
        "prospect_status": p.prospect_status,
        "current_step": p.current_step,
        "personalization": p.personalization,
        "notes": p.notes,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "outreach_logs": [
            {
                "id": log.id,
                "step_order": log.step_order,
                "step_type": log.step_type,
                "action": log.action,
                "subject": log.subject,
                "body": log.body,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
    }


def _step_to_dict(s: SequenceStep) -> dict:
    return {
        "id": s.id,
        "step_order": s.step_order,
        "step_type": s.step_type,
        "delay_days": s.delay_days,
        "subject_template": s.subject_template,
        "body_template": s.body_template,
        "instructions": s.instructions,
    }


# ── Campaign CRUD ─────────────────────────────────────────────────

@router.get("")
async def list_campaigns(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """List all campaigns for the current session/user."""
    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign)
        .where(Campaign.session_id == session_id)
        .options(selectinload(Campaign.prospects), selectinload(Campaign.sequence_steps))
        .order_by(Campaign.created_at.desc())
    )
    campaigns = result.scalars().all()

    # Calculate stats per campaign
    output = []
    for c in campaigns:
        data = _campaign_to_dict(c)
        # Stats
        prospects = c.__dict__.get("prospects") or []
        data["stats"] = {
            "total": len(prospects),
            "not_started": sum(1 for p in prospects if p.prospect_status == "not_started"),
            "in_progress": sum(1 for p in prospects if p.prospect_status == "in_progress"),
            "replied": sum(1 for p in prospects if p.prospect_status == "replied"),
            "meeting_booked": sum(1 for p in prospects if p.prospect_status == "meeting_booked"),
            "converted": sum(1 for p in prospects if p.prospect_status == "converted"),
            "dropped": sum(1 for p in prospects if p.prospect_status == "dropped"),
        }
        output.append(data)

    await db.commit()
    return output


@router.post("")
async def create_campaign(
    body: CreateCampaignRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Create a new prospecting campaign."""
    session_id = await _get_session_id(request, response, db)
    campaign = Campaign(
        session_id=session_id,
        name=body.name,
        description=body.description,
        default_tier=body.default_tier,
        target_industry=body.target_industry,
        target_role=body.target_role,
        target_company_size=body.target_company_size,
        target_location=body.target_location,
    )
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)
    return _campaign_to_dict(campaign)


@router.get("/{campaign_id}")
async def get_campaign(
    campaign_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Get campaign details with prospects and sequence steps."""
    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == campaign_id, Campaign.session_id == session_id)
        .options(
            selectinload(Campaign.prospects).selectinload(CampaignProspect.outreach_logs),
            selectinload(Campaign.sequence_steps),
        )
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    await db.commit()
    return _campaign_to_dict(campaign, include_details=True)


@router.patch("/{campaign_id}")
async def update_campaign(
    campaign_id: str,
    body: UpdateCampaignRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Update campaign metadata or status."""
    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    for field in ["name", "description", "status", "default_tier", "target_industry", "target_role", "target_company_size", "target_location"]:
        val = getattr(body, field, None)
        if val is not None:
            setattr(campaign, field, val)

    await db.commit()
    await db.refresh(campaign)
    return _campaign_to_dict(campaign)


@router.delete("/{campaign_id}")
async def delete_campaign(
    campaign_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Delete a campaign and all its prospects/steps."""
    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    await db.delete(campaign)
    await db.commit()
    return {"ok": True}


# ── Prospects ─────────────────────────────────────────────────────

@router.post("/{campaign_id}/prospects")
async def add_prospect(
    campaign_id: str,
    body: AddProspectRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Add a prospect to a campaign."""
    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    prospect = CampaignProspect(
        campaign_id=campaign_id,
        name=body.name,
        email=body.email,
        company=body.company,
        title=body.title,
        linkedin=body.linkedin,
        phone=body.phone,
        website=body.website,
        tier=body.tier if body.tier is not None else campaign.default_tier,
        personalization=body.personalization,
        notes=body.notes,
    )
    db.add(prospect)
    await db.commit()
    await db.refresh(prospect)
    return _prospect_to_dict(prospect)


@router.post("/{campaign_id}/prospects/bulk")
async def bulk_add_prospects(
    campaign_id: str,
    body: BulkAddProspectsRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Bulk-add prospects to a campaign."""
    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    added = []
    for p in body.prospects:
        prospect = CampaignProspect(
            campaign_id=campaign_id,
            name=p.name,
            email=p.email,
            company=p.company,
            title=p.title,
            linkedin=p.linkedin,
            phone=p.phone,
            website=p.website,
            tier=p.tier if p.tier is not None else campaign.default_tier,
            personalization=p.personalization,
            notes=p.notes,
        )
        db.add(prospect)
        added.append(prospect)

    await db.commit()
    return {"added": len(added), "campaign_id": campaign_id}


@router.patch("/{campaign_id}/prospects/{prospect_id}")
async def update_prospect(
    campaign_id: str,
    prospect_id: str,
    body: UpdateProspectRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Update a prospect's info, tier, or status."""
    session_id = await _get_session_id(request, response, db)
    # Verify campaign ownership
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")

    result = await db.execute(
        select(CampaignProspect).where(
            CampaignProspect.id == prospect_id,
            CampaignProspect.campaign_id == campaign_id,
        )
    )
    prospect = result.scalar_one_or_none()
    if not prospect:
        raise HTTPException(status_code=404, detail="Prospect not found")

    for field in ["name", "email", "company", "title", "linkedin", "phone", "tier", "prospect_status", "personalization", "notes"]:
        val = getattr(body, field, None)
        if val is not None:
            setattr(prospect, field, val)

    await db.commit()
    await db.refresh(prospect)
    return _prospect_to_dict(prospect)


@router.delete("/{campaign_id}/prospects/{prospect_id}")
async def delete_prospect(
    campaign_id: str,
    prospect_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Remove a prospect from a campaign."""
    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")

    result = await db.execute(
        select(CampaignProspect).where(
            CampaignProspect.id == prospect_id,
            CampaignProspect.campaign_id == campaign_id,
        )
    )
    prospect = result.scalar_one_or_none()
    if not prospect:
        raise HTTPException(status_code=404, detail="Prospect not found")

    await db.delete(prospect)
    await db.commit()
    return {"ok": True}


# ── Sequence Steps ────────────────────────────────────────────────

@router.post("/{campaign_id}/steps")
async def add_sequence_step(
    campaign_id: str,
    body: AddSequenceStepRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Add a step to the campaign's outreach sequence."""
    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")

    step = SequenceStep(
        campaign_id=campaign_id,
        step_order=body.step_order,
        step_type=body.step_type,
        delay_days=body.delay_days,
        subject_template=body.subject_template,
        body_template=body.body_template,
        instructions=body.instructions,
    )
    db.add(step)
    await db.commit()
    await db.refresh(step)
    return _step_to_dict(step)


@router.put("/{campaign_id}/steps")
async def replace_sequence_steps(
    campaign_id: str,
    body: list[AddSequenceStepRequest],
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Replace all sequence steps (for drag-and-drop reordering or bulk edit)."""
    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Delete existing steps
    existing = await db.execute(
        select(SequenceStep).where(SequenceStep.campaign_id == campaign_id)
    )
    for s in existing.scalars().all():
        await db.delete(s)

    # Add new steps
    for step_data in body:
        step = SequenceStep(
            campaign_id=campaign_id,
            step_order=step_data.step_order,
            step_type=step_data.step_type,
            delay_days=step_data.delay_days,
            subject_template=step_data.subject_template,
            body_template=step_data.body_template,
            instructions=step_data.instructions,
        )
        db.add(step)

    await db.commit()
    return {"ok": True, "steps_count": len(body)}


@router.delete("/{campaign_id}/steps/{step_id}")
async def delete_sequence_step(
    campaign_id: str,
    step_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Delete a sequence step."""
    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")

    result = await db.execute(
        select(SequenceStep).where(
            SequenceStep.id == step_id, SequenceStep.campaign_id == campaign_id
        )
    )
    step = result.scalar_one_or_none()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    await db.delete(step)
    await db.commit()
    return {"ok": True}


# ── Outreach Logging ──────────────────────────────────────────────

@router.post("/{campaign_id}/prospects/{prospect_id}/log")
async def log_outreach(
    campaign_id: str,
    prospect_id: str,
    body: LogOutreachRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Log an outreach action for a prospect."""
    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")

    result = await db.execute(
        select(CampaignProspect).where(
            CampaignProspect.id == prospect_id,
            CampaignProspect.campaign_id == campaign_id,
        )
    )
    prospect = result.scalar_one_or_none()
    if not prospect:
        raise HTTPException(status_code=404, detail="Prospect not found")

    log_entry = OutreachLog(
        prospect_id=prospect_id,
        step_order=body.step_order,
        step_type=body.step_type,
        action=body.action,
        subject=body.subject,
        body=body.body,
    )
    db.add(log_entry)

    # Update prospect status and current step
    if body.action == "sent":
        prospect.current_step = max(prospect.current_step, body.step_order)
        if prospect.prospect_status == "not_started":
            prospect.prospect_status = "in_progress"
    elif body.action == "replied":
        prospect.prospect_status = "replied"

    await db.commit()
    return {"ok": True, "prospect_status": prospect.prospect_status, "current_step": prospect.current_step}


# ── AI Copy Generation ───────────────────────────────────────────

@router.post("/{campaign_id}/generate-copy")
async def generate_copy(
    campaign_id: str,
    body: GenerateCopyRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Generate AI-personalized outreach copy for a channel/prospect."""
    from app.services.copywriter import generate_outreach_copy

    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Get prospect context if specified
    prospect_name = ""
    prospect_company = ""
    prospect_title = ""
    personalization = ""

    if body.prospect_id:
        result = await db.execute(
            select(CampaignProspect).where(
                CampaignProspect.id == body.prospect_id,
                CampaignProspect.campaign_id == campaign_id,
            )
        )
        prospect = result.scalar_one_or_none()
        if prospect:
            prospect_name = prospect.name
            prospect_company = prospect.company
            prospect_title = prospect.title
            personalization = prospect.personalization

    await db.commit()

    copy = await generate_outreach_copy(
        channel=body.channel,
        prospect_name=prospect_name,
        prospect_company=prospect_company,
        prospect_title=prospect_title,
        personalization=personalization,
        sender_name=body.sender_name,
        sender_company=body.sender_company,
        value_proposition=body.value_proposition,
        step_number=body.step_number,
        is_followup=body.is_followup,
    )
    return copy


@router.post("/{campaign_id}/generate-sequence")
async def generate_sequence(
    campaign_id: str,
    body: GenerateSequenceRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Generate AI-powered sequence template for a campaign."""
    from app.services.copywriter import generate_sequence_templates

    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    steps = await generate_sequence_templates(
        tier=body.tier or campaign.default_tier,
        value_proposition=body.value_proposition,
        target_industry=body.target_industry or campaign.target_industry,
        target_role=body.target_role or campaign.target_role,
    )

    # Save the generated steps to the campaign (replace existing)
    existing = await db.execute(
        select(SequenceStep).where(SequenceStep.campaign_id == campaign_id)
    )
    for s in existing.scalars().all():
        await db.delete(s)

    for step_data in steps:
        step = SequenceStep(
            campaign_id=campaign_id,
            step_order=step_data.get("step_order", 1),
            step_type=step_data.get("step_type", "email"),
            delay_days=step_data.get("delay_days", 0),
            subject_template=step_data.get("subject_template", ""),
            body_template=step_data.get("body_template", ""),
        )
        db.add(step)

    await db.commit()

    return {"steps": steps, "saved": True}


# ── Prospect Enrichment ──────────────────────────────────────────

@router.post("/{campaign_id}/prospects/{prospect_id}/enrich")
async def enrich_prospect(
    campaign_id: str,
    prospect_id: str,
    body: EnrichProspectRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Enrich a prospect with person intelligence (web research + AI analysis)."""
    from app.services.person_intel import research_person

    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.session_id == session_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campaign not found")

    result = await db.execute(
        select(CampaignProspect).where(
            CampaignProspect.id == prospect_id,
            CampaignProspect.campaign_id == campaign_id,
        )
    )
    prospect = result.scalar_one_or_none()
    if not prospect:
        raise HTTPException(status_code=404, detail="Prospect not found")

    # Research the person
    intel = await research_person(
        name=prospect.name,
        company=prospect.company,
        role=prospect.title,
        topics=body.topics,
    )

    # Build personalization from talking points
    talking_points = intel.get("talking_points", [])
    personalization = "; ".join(talking_points[:3]) if talking_points else intel.get("summary", "")

    # Update prospect
    prospect.personalization = personalization
    await db.commit()

    return {
        "prospect_id": prospect_id,
        "intel": intel,
        "personalization": personalization,
    }


# ── Campaign Stats ───────────────────────────────────────────────

@router.get("/{campaign_id}/stats")
async def get_campaign_stats(
    campaign_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Get campaign analytics."""
    session_id = await _get_session_id(request, response, db)
    result = await db.execute(
        select(Campaign)
        .where(Campaign.id == campaign_id, Campaign.session_id == session_id)
        .options(selectinload(Campaign.prospects).selectinload(CampaignProspect.outreach_logs))
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    prospects = campaign.__dict__.get("prospects") or []
    total = len(prospects)

    # Status breakdown
    status_counts = {}
    tier_counts = {}
    channel_counts = {}
    total_outreach = 0

    for p in prospects:
        status_counts[p.prospect_status] = status_counts.get(p.prospect_status, 0) + 1
        tier_key = f"tier_{p.tier}"
        tier_counts[tier_key] = tier_counts.get(tier_key, 0) + 1
        for log_entry in (p.__dict__.get("outreach_logs") or []):
            total_outreach += 1
            channel_counts[log_entry.step_type] = channel_counts.get(log_entry.step_type, 0) + 1

    await db.commit()

    return {
        "campaign_id": campaign_id,
        "total_prospects": total,
        "status_breakdown": status_counts,
        "tier_breakdown": tier_counts,
        "channel_breakdown": channel_counts,
        "total_outreach_actions": total_outreach,
        "reply_rate": round(status_counts.get("replied", 0) / total * 100, 1) if total else 0,
        "conversion_rate": round(
            (status_counts.get("converted", 0) + status_counts.get("meeting_booked", 0))
            / total * 100, 1
        ) if total else 0,
    }
