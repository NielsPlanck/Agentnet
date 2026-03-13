"""Meeting intelligence model — post-meeting debriefs with action items."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.tool import Base


class MeetingDebrief(Base):
    """A post-meeting debrief with action items, follow-ups, and notes."""
    __tablename__ = "meeting_debriefs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_id: Mapped[str] = mapped_column(String(200), nullable=False)  # Google Calendar event ID
    event_title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    event_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    event_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attendees_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON list of attendee emails
    action_items_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON: [{task, assignee, due}]
    follow_up_emails_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON: [{to, subject, body}]
    notes_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")  # pending | processed | dismissed
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
