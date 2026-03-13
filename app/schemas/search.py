from __future__ import annotations

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    intent: str
    category: str | None = None
    transport: str | None = None
    limit: int = Field(default=10, ge=1, le=100)


class WorkflowStep(BaseModel):
    action_id: str
    action_name: str
    description: str
    step_number: int
    input_schema: dict | None = None


class SearchResultItem(BaseModel):
    tool_name: str           # internal unique slug
    display_name: str = ""   # human-readable name shown in UI (provider)
    tool_id: str
    transport: str
    base_url: str
    page_url: str | None = None
    description: str
    similarity: float
    status: str = "active"
    auth_type: str = "none"
    rank: int = 0
    workflow: list[WorkflowStep] = []

    model_config = {"from_attributes": True}


class SearchResponse(BaseModel):
    intent: str
    results: list[SearchResultItem]
    count: int


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ImageInput(BaseModel):
    base64: str
    mime_type: str = "image/png"


class DocumentInput(BaseModel):
    """Uploaded document (PDF, DOCX, TXT, CSV, etc.)."""
    base64: str
    mime_type: str
    filename: str = ""
    text_content: str = ""  # Pre-extracted text (for text files parsed on frontend)


class SkillInstruction(BaseModel):
    """Enabled custom skill's instructions to inject into system prompt."""
    id: str
    name: str
    instructions: str


class AskRequest(BaseModel):
    query: str
    category: str | None = None
    transport: str | None = None
    history: list[ChatMessage] = []
    images: list[ImageInput] = []
    documents: list[DocumentInput] = []
    mode: str = "agentnet"  # "agentnet" | "web" | "both"
    enabled_skills: list[SkillInstruction] = []


class AskResponse(BaseModel):
    query: str
    answer: str
    sources: list[SearchResultItem]
