"""Routine and routine run models for the proactive AI assistant."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.tool import Base


class Routine(Base):
    """A recurring or one-shot task the AI runs in the background."""
    __tablename__ = "routines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    schedule_type: Mapped[str] = mapped_column(String(20), nullable=False, default="cron")  # cron | interval | one_shot
    schedule_value: Mapped[str] = mapped_column(String(100), nullable=False, default="")  # cron expr | "5h" | ISO datetime
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    runs: Mapped[list["RoutineRun"]] = relationship("RoutineRun", back_populates="routine", cascade="all, delete-orphan")


class RoutineRun(Base):
    """A single execution of a routine."""
    __tablename__ = "routine_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    routine_id: Mapped[str] = mapped_column(ForeignKey("routines.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")  # running | completed | failed
    result_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # FK to conversations.id
    notified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    routine: Mapped["Routine"] = relationship("Routine", back_populates="runs")
