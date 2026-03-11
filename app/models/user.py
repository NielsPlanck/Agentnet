import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.tool import Base


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    connections: Mapped[list["OAuthConnection"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class OAuthConnection(Base):
    __tablename__ = "oauth_connections"
    __table_args__ = (
        UniqueConstraint("session_id", "provider", "tool_id", name="uq_session_provider_tool"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    tool_id: Mapped[str] = mapped_column(
        ForeignKey("tools.id", ondelete="CASCADE"), nullable=False
    )
    access_token_enc: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    refresh_token_enc: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    scopes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    session: Mapped["Session"] = relationship(back_populates="connections")
