"""Domain model — curated tool rankings per intent category."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.tool import Base, JSONList


class Domain(Base):
    __tablename__ = "domains"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)  # e.g. "Accommodation"
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)  # e.g. "accommodation"
    description: Mapped[str] = mapped_column(Text, default="")
    keywords: Mapped[list[str]] = mapped_column(JSONList, default=list)  # ["hotel", "airbnb", "stay", "room"]
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tool_ranks: Mapped[list["DomainTool"]] = relationship(
        back_populates="domain", cascade="all, delete-orphan", order_by="DomainTool.rank"
    )


class DomainTool(Base):
    __tablename__ = "domain_tools"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    domain_id: Mapped[str] = mapped_column(ForeignKey("domains.id", ondelete="CASCADE"), nullable=False)
    tool_id: Mapped[str] = mapped_column(ForeignKey("tools.id", ondelete="CASCADE"), nullable=False)
    rank: Mapped[int] = mapped_column(Integer, default=1)  # 1 = first, 2 = second, etc.

    domain: Mapped["Domain"] = relationship(back_populates="tool_ranks")
    tool: Mapped["app.models.tool.Tool"] = relationship()
