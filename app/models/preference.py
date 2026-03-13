"""User preference model — key-value storage for settings."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.tool import Base


class UserPreference(Base):
    """Stores user preferences as flexible key-value pairs."""
    __tablename__ = "user_preferences"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_user_pref_key"),)


# Default preference values — used when a key is missing
PREFERENCE_DEFAULTS = {
    "color_mode": "dark",
    "chat_font": "default",
    "voice": "alloy",
}
