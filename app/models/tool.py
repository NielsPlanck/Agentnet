import json
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator


class JSONList(TypeDecorator):
    """Store a Python list as a JSON string in SQLite."""
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return json.dumps(value) if value is not None else "[]"

    def process_result_value(self, value, dialect):
        return json.loads(value) if value else []


class JSONDict(TypeDecorator):
    """Store a Python dict as a JSON string in SQLite."""
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return json.dumps(value) if value is not None else None

    def process_result_value(self, value, dialect):
        return json.loads(value) if value else None


class Base(DeclarativeBase):
    pass


class Tool(Base):
    __tablename__ = "tools"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    provider: Mapped[str] = mapped_column(String(255), nullable=False)
    transport: Mapped[str] = mapped_column(String(20), nullable=False)  # mcp, rest, webmcp
    base_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    page_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)  # for webmcp: the webpage URL
    auth_type: Mapped[str] = mapped_column(String(20), default="none")
    status: Mapped[str] = mapped_column(String(20), default="active")
    tags: Mapped[list[str]] = mapped_column(JSONList, default=list)
    priority: Mapped[int] = mapped_column(default=0)  # manual boost: higher = shown first
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    actions: Mapped[list["Action"]] = relationship(back_populates="tool", cascade="all, delete-orphan")
    versions: Mapped[list["ToolVersion"]] = relationship(back_populates="tool", cascade="all, delete-orphan")


class Action(Base):
    __tablename__ = "actions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tool_id: Mapped[str] = mapped_column(ForeignKey("tools.id", ondelete="CASCADE"), nullable=False)
    capability_id: Mapped[str | None] = mapped_column(
        ForeignKey("capabilities.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    operation_type: Mapped[str] = mapped_column(String(20), default="read")
    input_schema: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)
    output_schema: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(JSONList, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tool: Mapped["Tool"] = relationship(back_populates="actions")


class ToolVersion(Base):
    __tablename__ = "tool_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tool_id: Mapped[str] = mapped_column(ForeignKey("tools.id", ondelete="CASCADE"), nullable=False)
    version_label: Mapped[str] = mapped_column(String(100), nullable=False)
    schema_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tool: Mapped["Tool"] = relationship(back_populates="versions")
