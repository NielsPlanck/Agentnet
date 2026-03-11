from datetime import datetime

from pydantic import BaseModel


class CapabilityOut(BaseModel):
    id: str
    slug: str
    title: str
    description: str
    category: str
    created_at: datetime

    model_config = {"from_attributes": True}
