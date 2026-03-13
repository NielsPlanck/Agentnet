"""Campaign models for B2B multichannel prospecting.

Supports tier-based segmentation (Tier 1/2/3), multichannel sequences
(email + LinkedIn + phone), and prospect lifecycle tracking.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.tool import Base


class Campaign(Base):
    """A prospecting campaign grouping prospects under a shared strategy."""
    __tablename__ = "campaigns"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")

    # "draft" | "active" | "paused" | "completed"
    status: Mapped[str] = mapped_column(String(50), default="draft")

    # Default tier for new prospects in this campaign (1=high-touch, 2=semi-auto, 3=automated)
    default_tier: Mapped[int] = mapped_column(Integer, default=2)

    # Targeting criteria (informational)
    target_industry: Mapped[str] = mapped_column(String(255), default="")
    target_role: Mapped[str] = mapped_column(String(255), default="")
    target_company_size: Mapped[str] = mapped_column(String(100), default="")
    target_location: Mapped[str] = mapped_column(String(255), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    prospects: Mapped[list["CampaignProspect"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan",
        order_by="CampaignProspect.created_at",
    )
    sequence_steps: Mapped[list["SequenceStep"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan",
        order_by="SequenceStep.step_order",
    )


class CampaignProspect(Base):
    """A prospect enrolled in a campaign with tier and lifecycle status."""
    __tablename__ = "campaign_prospects"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False
    )
    # Link to TrackedPerson for intel, contact info, existing follow-up steps
    person_id: Mapped[str | None] = mapped_column(
        ForeignKey("tracked_people.id", ondelete="SET NULL"), nullable=True
    )

    # Prospect info (denormalized for quick display / CSV import without needing TrackedPerson)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), default="")
    company: Mapped[str] = mapped_column(String(255), default="")
    title: Mapped[str] = mapped_column(String(255), default="")
    linkedin: Mapped[str] = mapped_column(String(500), default="")
    phone: Mapped[str] = mapped_column(String(100), default="")
    website: Mapped[str] = mapped_column(String(500), default="")

    # Tier override (1=manual/high-touch, 2=email+LinkedIn, 3=email-only automated)
    tier: Mapped[int] = mapped_column(Integer, default=2)

    # Lifecycle: "not_started" | "in_progress" | "replied" | "meeting_booked" | "converted" | "dropped" | "bounced"
    prospect_status: Mapped[str] = mapped_column(String(50), default="not_started")

    # Which sequence step this prospect is currently on (0 = hasn't started)
    current_step: Mapped[int] = mapped_column(Integer, default=0)

    # AI-generated personalization snippet (from person intel)
    personalization: Mapped[str] = mapped_column(Text, default="")

    # Notes
    notes: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    campaign: Mapped["Campaign"] = relationship(back_populates="prospects")
    outreach_logs: Mapped[list["OutreachLog"]] = relationship(
        back_populates="prospect", cascade="all, delete-orphan",
        order_by="OutreachLog.created_at",
    )


class SequenceStep(Base):
    """A step in a campaign's outreach sequence (template for all prospects).

    Step types:
    - email: Cold email outreach
    - linkedin_connect: LinkedIn connection request with note
    - linkedin_message: LinkedIn DM (after connected)
    - linkedin_voice_note: LinkedIn voice note reminder
    - call: Phone call
    - reminder: Internal reminder / task
    """
    __tablename__ = "sequence_steps"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False
    )
    step_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # "email" | "linkedin_connect" | "linkedin_message" | "linkedin_voice_note" | "call" | "reminder"
    step_type: Mapped[str] = mapped_column(String(50), nullable=False, default="email")

    # Delay in days from campaign start (day 0) or from previous step
    delay_days: Mapped[int] = mapped_column(Integer, default=0)

    # Content templates (with {{name}}, {{company}}, {{personalization}} placeholders)
    subject_template: Mapped[str] = mapped_column(String(500), default="")
    body_template: Mapped[str] = mapped_column(Text, default="")

    # Channel-specific settings
    # For LinkedIn: max 300 chars for connection request
    # For email: no hard limit but keep it concise
    max_length: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Notes/instructions for manual steps (tier 1)
    instructions: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    campaign: Mapped["Campaign"] = relationship(back_populates="sequence_steps")


class OutreachLog(Base):
    """Log of actual outreach actions taken for a prospect in a campaign."""
    __tablename__ = "outreach_logs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    prospect_id: Mapped[str] = mapped_column(
        ForeignKey("campaign_prospects.id", ondelete="CASCADE"), nullable=False
    )
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    step_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # "sent" | "skipped" | "bounced" | "replied" | "opened"
    action: Mapped[str] = mapped_column(String(50), nullable=False, default="sent")

    # Actual content sent (after personalization)
    subject: Mapped[str] = mapped_column(String(500), default="")
    body: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    prospect: Mapped["CampaignProspect"] = relationship(back_populates="outreach_logs")
