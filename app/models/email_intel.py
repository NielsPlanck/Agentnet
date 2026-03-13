"""Email intelligence model — inbox digest and priority categorization."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.tool import Base


class EmailDigest(Base):
    """A processed inbox digest with categorized emails."""
    __tablename__ = "email_digests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    routine_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # if triggered by routine
    emails_processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    urgent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    categories_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # JSON: {urgent:[], important:[], normal:[], low:[]}
    draft_suggestions_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array of draft objects
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
