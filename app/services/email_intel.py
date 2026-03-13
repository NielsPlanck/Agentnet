"""Email intelligence service — categorize inbox, suggest drafts, summarize."""

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.database import async_session
from app.models.email_intel import EmailDigest

log = logging.getLogger(__name__)


async def process_inbox(user_id: str, token: str, since_hours: int = 4, max_emails: int = 20) -> dict:
    """Fetch recent emails, categorize by priority, suggest drafts.

    Returns the full digest dict.
    """
    from app.services.gmail import search_emails

    # Build Gmail query for recent emails
    query = f"newer_than:{since_hours}h -category:promotions -category:social"
    try:
        emails = await search_emails(token, query, max_results=max_emails)
    except Exception as e:
        log.error("Failed to fetch emails: %s", e)
        return {"error": str(e), "emails_processed": 0}

    if not emails:
        return {
            "emails_processed": 0,
            "urgent_count": 0,
            "summary": "No new emails in the last few hours.",
            "categories": {"urgent": [], "important": [], "normal": [], "low": []},
            "drafts": [],
        }

    # Use LLM to categorize
    email_text = "\n".join(
        f"- ID: {e['id']} | From: {e['from']} | Subject: {e['subject']} | Date: {e['date']} | Preview: {e['snippet'][:150]}"
        for e in emails
    )

    try:
        from google import genai
        from google.genai import types
        from app.config import settings

        client = genai.Client(api_key=settings.gemini_api_key)

        categorize_prompt = f"""Analyze these emails and categorize them by priority. Also suggest brief draft replies for urgent emails.

EMAILS:
{email_text}

Return a JSON object with this exact structure:
{{
  "summary": "Brief 1-2 sentence summary of inbox state",
  "categories": {{
    "urgent": [{{"id": "...", "from": "...", "subject": "...", "reason": "why urgent", "suggested_action": "reply|forward|archive"}}],
    "important": [{{"id": "...", "from": "...", "subject": "...", "reason": "why important"}}],
    "normal": [{{"id": "...", "from": "...", "subject": "..."}}],
    "low": [{{"id": "...", "from": "...", "subject": "..."}}]
  }},
  "drafts": [{{"for_email_id": "...", "to": "...", "subject": "Re: ...", "body": "brief professional reply"}}]
}}

Rules:
- Urgent: time-sensitive, requires immediate response (boss, client deadlines, emergencies)
- Important: should respond today (colleagues, business inquiries, scheduled items)
- Normal: can wait a day or two (newsletters from humans, casual conversations)
- Low: can ignore (automated notifications, marketing, social)
- Generate draft replies ONLY for urgent emails that need a quick response
- Keep draft replies professional and brief (2-3 sentences)
- Return ONLY valid JSON, no markdown"""

        response = await client.aio.models.generate_content(
            model=settings.gemini_chat_model,
            contents=[types.Content(role="user", parts=[types.Part.from_text(text=categorize_prompt)])],
            config=types.GenerateContentConfig(
                max_output_tokens=2048,
                temperature=0.1,
            ),
        )

        raw = (response.text or "").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

        result = json.loads(raw)

        # Count urgent
        urgent_count = len(result.get("categories", {}).get("urgent", []))

        # Store digest in DB
        digest_id = None
        async with async_session() as db:
            digest = EmailDigest(
                user_id=user_id,
                emails_processed=len(emails),
                urgent_count=urgent_count,
                summary_text=result.get("summary", ""),
                categories_json=json.dumps(result.get("categories", {})),
                draft_suggestions_json=json.dumps(result.get("drafts", [])),
            )
            db.add(digest)
            await db.commit()
            digest_id = digest.id

        return {
            "digest_id": digest_id,
            "emails_processed": len(emails),
            "urgent_count": urgent_count,
            "summary": result.get("summary", ""),
            "categories": result.get("categories", {}),
            "drafts": result.get("drafts", []),
        }

    except json.JSONDecodeError:
        log.warning("Failed to parse email categorization JSON")
        # Fallback: return simplified structure (don't leak raw email dicts)
        simplified = [{"id": e.get("id", ""), "from": e.get("from", ""), "subject": e.get("subject", "")} for e in emails]
        return {
            "emails_processed": len(emails),
            "urgent_count": 0,
            "summary": f"{len(emails)} new emails (categorization failed)",
            "categories": {"urgent": [], "important": [], "normal": simplified, "low": []},
            "drafts": [],
        }
    except Exception:
        log.exception("Email categorization failed")
        simplified = [{"id": e.get("id", ""), "from": e.get("from", ""), "subject": e.get("subject", "")} for e in emails]
        return {
            "emails_processed": len(emails),
            "urgent_count": 0,
            "summary": f"{len(emails)} new emails (analysis unavailable)",
            "categories": {"urgent": [], "important": [], "normal": simplified, "low": []},
            "drafts": [],
        }


async def get_latest_digest(user_id: str) -> dict | None:
    """Get the most recent email digest for a user."""
    async with async_session() as db:
        stmt = (
            select(EmailDigest)
            .where(EmailDigest.user_id == user_id)
            .order_by(EmailDigest.created_at.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        digest = result.scalar_one_or_none()
        if not digest:
            return None

        return {
            "id": digest.id,
            "emails_processed": digest.emails_processed,
            "urgent_count": digest.urgent_count,
            "summary": digest.summary_text,
            "categories": json.loads(digest.categories_json),
            "drafts": json.loads(digest.draft_suggestions_json),
            "created_at": digest.created_at.isoformat() if digest.created_at else None,
        }


async def list_digests(user_id: str, limit: int = 20) -> list[dict]:
    """List past email digests."""
    async with async_session() as db:
        stmt = (
            select(EmailDigest)
            .where(EmailDigest.user_id == user_id)
            .order_by(EmailDigest.created_at.desc())
            .limit(limit)
        )
        result = await db.execute(stmt)
        digests = result.scalars().all()
        return [
            {
                "id": d.id,
                "emails_processed": d.emails_processed,
                "urgent_count": d.urgent_count,
                "summary": d.summary_text,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in digests
        ]
