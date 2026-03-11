"""RegisteredSite model — tracks domains submitted to AgentNet for crawling."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.tool import Base


class RegisteredSite(Base):
    __tablename__ = "registered_sites"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    domain: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    submitted_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Verification
    verified: Mapped[bool] = mapped_column(default=False)
    verification_token: Mapped[str] = mapped_column(String(64), nullable=False, default=lambda: str(uuid.uuid4()).replace("-", ""))

    # Crawl job queue
    crawl_status: Mapped[str] = mapped_column(String(20), default="pending")
    # pending → crawling → done | failed
    crawl_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_crawl_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # What was discovered
    discovered_tool_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    discovered_actions_count: Mapped[int] = mapped_column(default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
