"""Follow-up sequence models for tracking outreach to people."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.tool import Base


class TrackedPerson(Base):
    """A person the user wants to track / follow up with."""
    __tablename__ = "tracked_people"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), default="")
    company: Mapped[str] = mapped_column(String(255), default="")
    title: Mapped[str] = mapped_column(String(255), default="")
    linkedin: Mapped[str] = mapped_column(String(500), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    # Intel summary from research
    intel_summary: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    steps: Mapped[list["FollowUpStep"]] = relationship(
        back_populates="person", cascade="all, delete-orphan",
        order_by="FollowUpStep.step_order",
    )


class FollowUpStep(Base):
    """A single step in a follow-up sequence (email, LinkedIn, reminder)."""
    __tablename__ = "followup_steps"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    person_id: Mapped[str] = mapped_column(
        ForeignKey("tracked_people.id", ondelete="CASCADE"), nullable=False
    )
    step_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # "email" | "linkedin" | "reminder" | "call"
    step_type: Mapped[str] = mapped_column(String(50), nullable=False, default="email")
    # Delay in days from previous step (0 = same day)
    delay_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # "pending" | "sent" | "skipped" | "due"
    status: Mapped[str] = mapped_column(String(50), default="pending")
    # Content
    subject: Mapped[str] = mapped_column(String(500), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    # When this step should be executed
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # When it was actually done
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    person: Mapped["TrackedPerson"] = relationship(back_populates="steps")
