"""Memory model — persistent AI memory across conversations."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.tool import Base


class Memory(Base):
    """A single memory item the AI remembers about the user."""
    __tablename__ = "memories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False, default="fact")  # preference | contact | fact | decision | pattern
    key: Mapped[str] = mapped_column(String(200), nullable=False, default="")  # short label
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")  # full detail
    source: Mapped[str] = mapped_column(String(100), nullable=False, default="auto")  # auto | manual | conversation:{id}
    importance: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)  # 0-1, for context priority
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
