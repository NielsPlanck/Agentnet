"""Migration: create campaign prospecting tables.

Run: python -m app.migrations.add_campaigns
"""

import asyncio
import logging

from app.database import engine
from app.models.tool import Base

# Register all models so metadata.create_all picks them up
from app.models.campaign import Campaign, CampaignProspect, SequenceStep, OutreachLog  # noqa: F401
from app.models.user import User, Session, OAuthConnection  # noqa: F401
from app.models.followup import TrackedPerson, FollowUpStep  # noqa: F401
from app.models.training import Conversation, Message, Feedback, ToolSuggestion  # noqa: F401
from app.models.registered_site import RegisteredSite  # noqa: F401
from app.models.domain import Domain, DomainTool  # noqa: F401

log = logging.getLogger(__name__)


async def run():
    """Create all new tables (SQLite CREATE TABLE IF NOT EXISTS is safe)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✓ Campaign tables created (campaigns, campaign_prospects, sequence_steps, outreach_logs)")


if __name__ == "__main__":
    asyncio.run(run())
