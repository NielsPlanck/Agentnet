"""Background crawl worker — polls DB for pending/due crawl jobs and processes them."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select

from app.database import async_session
from app.models.registered_site import RegisteredSite

log = logging.getLogger(__name__)

POLL_INTERVAL = 30       # seconds between queue polls
RECRAWL_DAYS  = 7        # re-crawl registered sites every 7 days
MAX_CONCURRENT = 3       # max parallel crawls


async def _process_site(site_id: str):
    """Crawl a single site and update its record."""
    from app.crawlers.site import crawl_site

    async with async_session() as db:
        result = await db.execute(select(RegisteredSite).where(RegisteredSite.id == site_id))
        site = result.scalar_one_or_none()
        if not site:
            return

        site.crawl_status = "crawling"
        await db.commit()

        try:
            tool, count = await crawl_site(db, site)
            site.crawl_status = "done"
            site.crawl_error = None
            site.last_crawled_at = datetime.now(timezone.utc)
            site.next_crawl_at = datetime.now(timezone.utc) + timedelta(days=RECRAWL_DAYS)
            site.discovered_actions_count = count
            if tool:
                site.discovered_tool_id = tool.id
            await db.commit()
            log.info("Crawled %s: %d actions", site.domain, count)
        except Exception as e:
            await db.rollback()
            async with async_session() as db2:
                result2 = await db2.execute(select(RegisteredSite).where(RegisteredSite.id == site_id))
                site2 = result2.scalar_one_or_none()
                if site2:
                    site2.crawl_status = "failed"
                    site2.crawl_error = str(e)[:1000]
                    site2.last_crawled_at = datetime.now(timezone.utc)
                    site2.next_crawl_at = datetime.now(timezone.utc) + timedelta(days=1)
                    await db2.commit()
            log.exception("Crawl failed for site %s", site_id)


async def run_worker():
    """Main worker loop — polls for pending/due crawl jobs."""
    log.info("Crawl worker started (poll interval: %ds)", POLL_INTERVAL)

    while True:
        try:
            now = datetime.now(timezone.utc)
            async with async_session() as db:
                stmt = (
                    select(RegisteredSite)
                    .where(
                        or_(
                            RegisteredSite.crawl_status == "pending",
                            (RegisteredSite.crawl_status == "done") & (RegisteredSite.next_crawl_at <= now),
                            (RegisteredSite.crawl_status == "failed") & (RegisteredSite.next_crawl_at <= now),
                        )
                    )
                    .limit(MAX_CONCURRENT)
                )
                result = await db.execute(stmt)
                due = result.scalars().all()
                site_ids = [s.id for s in due]

            if site_ids:
                log.info("Processing %d crawl job(s)", len(site_ids))
                await asyncio.gather(*[_process_site(sid) for sid in site_ids])

        except Exception:
            log.exception("Crawl worker loop error")

        await asyncio.sleep(POLL_INTERVAL)
