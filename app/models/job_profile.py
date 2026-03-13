"""Job profile and application tracking models."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.tool import Base


class JobProfile(Base):
    """Stores user's CV, contact info, and job preferences for the agent."""
    __tablename__ = "job_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    location: Mapped[str] = mapped_column(String(200), nullable=False, default="")

    # CV storage
    cv_text: Mapped[str] = mapped_column(Text, nullable=False, default="")  # extracted text
    cv_filename: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    cv_base64: Mapped[str] = mapped_column(Text, nullable=False, default="")  # original file for re-upload
    cv_mime_type: Mapped[str] = mapped_column(String(100), nullable=False, default="")

    # Links
    linkedin_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    portfolio_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")

    # Job preferences (stored as JSON strings)
    target_roles: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array
    target_locations: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array
    salary_range: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    job_type: Mapped[str] = mapped_column(String(50), nullable=False, default="full-time")

    # Free-text answers to common application questions
    additional_info: Mapped[str] = mapped_column(Text, nullable=False, default="")

    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class JobApplication(Base):
    """Tracks each job the agent has found or applied to."""
    __tablename__ = "job_applications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    job_title: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    company: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    job_url: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    board: Mapped[str] = mapped_column(String(50), nullable=False, default="unknown")  # linkedin|indeed|wttj|glassdoor|other
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="found")  # found|applying|submitted|failed|skipped
    applied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    screenshot_b64: Mapped[str | None] = mapped_column(Text, nullable=True)  # confirmation screenshot
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_data: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # JSON extra details
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
