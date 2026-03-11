from datetime import datetime

from pydantic import BaseModel


class ActionOut(BaseModel):
    id: str
    name: str
    description: str
    operation_type: str
    input_schema: dict | None = None
    output_schema: dict | None = None

    model_config = {"from_attributes": True}


class ToolOut(BaseModel):
    id: str
    name: str
    provider: str
    transport: str
    base_url: str
    page_url: str | None = None
    auth_type: str
    status: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ToolDetailOut(ToolOut):
    actions: list[ActionOut] = []
