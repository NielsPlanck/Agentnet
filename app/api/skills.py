"""Custom Skills API — CRUD, import/export, share."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_optional, get_current_user_required, get_db
from app.models.skill import CustomSkill
from app.models.user import User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/skills", tags=["skills"])


# ── Schemas ────────────────────────────────────────────────────────────

class CreateSkillRequest(BaseModel):
    name: str
    description: str = ""
    icon: str = "Zap"
    instructions: str = ""
    mcp_server_url: str | None = None
    enabled: bool = True


class UpdateSkillRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    instructions: str | None = None
    mcp_server_url: str | None = None
    enabled: bool | None = None


class SkillOut(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    instructions: str
    mcp_server_url: str | None
    enabled: bool
    is_public: bool
    share_code: str | None
    created_at: str | None
    updated_at: str | None


class SkillExport(BaseModel):
    """Portable skill format for import/export."""
    name: str
    description: str
    icon: str
    instructions: str
    mcp_server_url: str | None = None


class ImportSkillRequest(BaseModel):
    """Import from JSON or share_code."""
    share_code: str | None = None
    skill_data: SkillExport | None = None


# ── CRUD ──────────────────────────────────────────────────────────────

@router.get("/")
async def list_skills(
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
) -> list[SkillOut]:
    result = await db.execute(
        select(CustomSkill)
        .where(CustomSkill.user_id == user.id)
        .order_by(CustomSkill.created_at.desc())
    )
    skills = result.scalars().all()
    return [_skill_to_out(s) for s in skills]


@router.post("/")
async def create_skill(
    body: CreateSkillRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
) -> SkillOut:
    # Limit instructions to 5000 chars
    instructions = (body.instructions or "")[:5000]
    skill = CustomSkill(
        user_id=user.id,
        name=body.name[:100],
        description=(body.description or "")[:500],
        icon=body.icon or "Zap",
        instructions=instructions,
        mcp_server_url=body.mcp_server_url,
        enabled=body.enabled,
    )
    db.add(skill)
    await db.commit()
    await db.refresh(skill)
    return _skill_to_out(skill)


@router.get("/{skill_id}")
async def get_skill(
    skill_id: str,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
) -> SkillOut:
    skill = await _get_user_skill(db, user.id, skill_id)
    return _skill_to_out(skill)


@router.put("/{skill_id}")
async def update_skill(
    skill_id: str,
    body: UpdateSkillRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
) -> SkillOut:
    skill = await _get_user_skill(db, user.id, skill_id)
    updates = body.model_dump(exclude_unset=True)
    if "instructions" in updates and updates["instructions"]:
        updates["instructions"] = updates["instructions"][:5000]
    if "name" in updates and updates["name"]:
        updates["name"] = updates["name"][:100]
    if "description" in updates and updates["description"]:
        updates["description"] = updates["description"][:500]
    for field, value in updates.items():
        setattr(skill, field, value)
    await db.commit()
    await db.refresh(skill)
    return _skill_to_out(skill)


@router.delete("/{skill_id}")
async def delete_skill(
    skill_id: str,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    skill = await _get_user_skill(db, user.id, skill_id)
    await db.delete(skill)
    await db.commit()
    return {"ok": True}


# ── Share / Export ──────────────────────────────────────────────────────

@router.post("/{skill_id}/share")
async def share_skill(
    skill_id: str,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
):
    """Generate a share_code for a skill, return shareable JSON."""
    skill = await _get_user_skill(db, user.id, skill_id)
    if not skill.share_code:
        skill.share_code = str(uuid.uuid4())
        await db.commit()
    return {
        "share_code": skill.share_code,
        "export": {
            "name": skill.name,
            "description": skill.description,
            "icon": skill.icon,
            "instructions": skill.instructions,
            "mcp_server_url": skill.mcp_server_url,
        },
    }


@router.get("/shared/{share_code}")
async def get_shared_skill(
    share_code: str,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint: get a shared skill by share_code."""
    result = await db.execute(
        select(CustomSkill).where(CustomSkill.share_code == share_code)
    )
    skill = result.scalar_one_or_none()
    if not skill:
        raise HTTPException(status_code=404, detail="Shared skill not found")
    return {
        "name": skill.name,
        "description": skill.description,
        "icon": skill.icon,
        "instructions": skill.instructions,
        "mcp_server_url": skill.mcp_server_url,
    }


# ── Import ──────────────────────────────────────────────────────────────

@router.post("/import")
async def import_skill(
    body: ImportSkillRequest,
    user: User = Depends(get_current_user_required),
    db: AsyncSession = Depends(get_db),
) -> SkillOut:
    """Import a skill from share_code or raw JSON data."""
    if body.share_code:
        result = await db.execute(
            select(CustomSkill).where(CustomSkill.share_code == body.share_code)
        )
        source = result.scalar_one_or_none()
        if not source:
            raise HTTPException(status_code=404, detail="Shared skill not found")
        data = SkillExport(
            name=source.name,
            description=source.description,
            icon=source.icon,
            instructions=source.instructions,
            mcp_server_url=source.mcp_server_url,
        )
    elif body.skill_data:
        data = body.skill_data
    else:
        raise HTTPException(status_code=400, detail="Provide share_code or skill_data")

    skill = CustomSkill(
        user_id=user.id,
        name=data.name[:100],
        description=(data.description or "")[:500],
        icon=data.icon or "Zap",
        instructions=(data.instructions or "")[:5000],
        mcp_server_url=data.mcp_server_url,
        enabled=True,
    )
    db.add(skill)
    await db.commit()
    await db.refresh(skill)
    return _skill_to_out(skill)


# ── Helpers ──────────────────────────────────────────────────────────────

async def _get_user_skill(db: AsyncSession, user_id: str, skill_id: str) -> CustomSkill:
    result = await db.execute(
        select(CustomSkill).where(
            CustomSkill.id == skill_id,
            CustomSkill.user_id == user_id,
        )
    )
    skill = result.scalar_one_or_none()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill


def _skill_to_out(skill: CustomSkill) -> SkillOut:
    return SkillOut(
        id=skill.id,
        name=skill.name,
        description=skill.description,
        icon=skill.icon,
        instructions=skill.instructions,
        mcp_server_url=skill.mcp_server_url,
        enabled=skill.enabled,
        is_public=skill.is_public,
        share_code=skill.share_code,
        created_at=skill.created_at.isoformat() if skill.created_at else None,
        updated_at=skill.updated_at.isoformat() if skill.updated_at else None,
    )
