"""Workflow models — visual workflow builder with chainable steps."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.tool import Base


class Workflow(Base):
    """A user-created workflow that chains multiple actions together."""
    __tablename__ = "workflows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    trigger_type: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")  # manual | schedule | event
    trigger_config: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # JSON config (cron, event type)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class WorkflowStep(Base):
    """A single step in a workflow execution chain."""
    __tablename__ = "workflow_steps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    step_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # step_type options: email_check, calendar_check, apple_action, whatsapp_check, llm_call, notification, condition, memory_save
    config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # Step-specific params
    on_success: Mapped[str] = mapped_column(String(36), nullable=False, default="next")  # step id or "end" or "next"
    on_failure: Mapped[str] = mapped_column(String(36), nullable=False, default="end")  # step id or "end"
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class WorkflowRun(Base):
    """Tracks a single execution of a workflow."""
    __tablename__ = "workflow_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")  # running | completed | failed
    steps_completed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    result_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
