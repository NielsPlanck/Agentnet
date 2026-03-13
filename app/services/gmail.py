"""Gmail API calls via httpx (no SDK)."""

import base64
from email.mime.text import MIMEText

import httpx

GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def list_labels(token: str) -> list[dict]:
    """List all Gmail labels."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{GMAIL_BASE}/labels", headers=_headers(token))
        resp.raise_for_status()
        labels = resp.json().get("labels", [])
        return [{"id": l["id"], "name": l["name"], "type": l.get("type", "")} for l in labels]


async def search_emails(token: str, query: str, max_results: int = 10) -> list[dict]:
    """Search emails and return metadata."""
    async with httpx.AsyncClient() as client:
        # List message IDs
        resp = await client.get(
            f"{GMAIL_BASE}/messages",
            headers=_headers(token),
            params={"q": query, "maxResults": max_results},
        )
        resp.raise_for_status()
        messages = resp.json().get("messages", [])

        # Fetch metadata for each
        results = []
        for msg in messages:
            detail = await client.get(
                f"{GMAIL_BASE}/messages/{msg['id']}",
                headers=_headers(token),
                params={"format": "metadata", "metadataHeaders": ["From", "Subject", "Date"]},
            )
            if detail.status_code != 200:
                continue
            data = detail.json()
            headers = {h["name"]: h["value"] for h in data.get("payload", {}).get("headers", [])}
            results.append({
                "id": data["id"],
                "snippet": data.get("snippet", ""),
                "from": headers.get("From", ""),
                "subject": headers.get("Subject", ""),
                "date": headers.get("Date", ""),
            })
        return results


async def send_email(token: str, to: str, subject: str, body: str) -> dict:
    """Send an email."""
    msg = MIMEText(body)
    msg["to"] = to
    msg["subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{GMAIL_BASE}/messages/send",
            headers=_headers(token),
            json={"raw": raw},
        )
        resp.raise_for_status()
        data = resp.json()
        return {"id": data["id"], "status": "sent"}


async def create_draft(token: str, to: str, subject: str, body: str) -> dict:
    """Create a draft email in Gmail.

    Returns {"id": draft_id, "message_id": msg_id, "status": "draft_created"}
    """
    msg = MIMEText(body)
    msg["to"] = to
    msg["subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{GMAIL_BASE}/drafts",
            headers=_headers(token),
            json={"message": {"raw": raw}},
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "id": data["id"],
            "message_id": data.get("message", {}).get("id", ""),
            "status": "draft_created",
        }


async def get_profile(token: str) -> dict:
    """Get the authenticated user's Gmail profile (email address)."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{GMAIL_BASE}/profile",
            headers=_headers(token),
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "email": data.get("emailAddress", ""),
            "messages_total": data.get("messagesTotal", 0),
        }
