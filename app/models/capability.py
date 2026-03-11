import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.tool import Base, JSONList


class Capability(Base):
    __tablename__ = "capabilities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(JSONList, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
