"""Google Calendar API calls via httpx (no SDK)."""

from datetime import datetime, timedelta

import httpx

CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def list_calendars(token: str) -> list[dict]:
    """List all calendars for the user."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{CALENDAR_BASE}/users/me/calendarList",
            headers=_headers(token),
        )
        resp.raise_for_status()
        items = resp.json().get("items", [])
        return [
            {
                "id": c["id"],
                "summary": c.get("summary", ""),
                "primary": c.get("primary", False),
                "color": c.get("backgroundColor", ""),
            }
            for c in items
        ]


async def list_events(
    token: str,
    calendar_id: str = "primary",
    days_ahead: int = 7,
    max_results: int = 20,
) -> list[dict]:
    """List upcoming events."""
    now = datetime.utcnow()
    time_min = now.isoformat() + "Z"
    time_max = (now + timedelta(days=days_ahead)).isoformat() + "Z"

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{CALENDAR_BASE}/calendars/{calendar_id}/events",
            headers=_headers(token),
            params={
                "timeMin": time_min,
                "timeMax": time_max,
                "maxResults": max_results,
                "singleEvents": "true",
                "orderBy": "startTime",
            },
        )
        resp.raise_for_status()
        events = resp.json().get("items", [])
        return [
            {
                "id": e["id"],
                "summary": e.get("summary", "(No title)"),
                "start": e.get("start", {}).get("dateTime") or e.get("start", {}).get("date", ""),
                "end": e.get("end", {}).get("dateTime") or e.get("end", {}).get("date", ""),
                "location": e.get("location", ""),
                "description": e.get("description", ""),
                "attendees": [
                    a.get("email", "") for a in e.get("attendees", [])
                ],
                "html_link": e.get("htmlLink", ""),
                "status": e.get("status", ""),
            }
            for e in events
        ]


async def create_event(
    token: str,
    summary: str,
    start: str,
    end: str,
    description: str = "",
    location: str = "",
    attendees: list[str] | None = None,
    calendar_id: str = "primary",
    send_notifications: bool = True,
) -> dict:
    """Create a calendar event.

    start/end should be ISO 8601 datetime strings (e.g. "2024-03-15T10:00:00-05:00")
    or date strings for all-day events (e.g. "2024-03-15").
    """
    # Detect all-day vs timed event
    is_all_day = len(start) <= 10  # "2024-03-15" = 10 chars

    event_body: dict = {
        "summary": summary,
        "start": {"date": start} if is_all_day else {"dateTime": start},
        "end": {"date": end} if is_all_day else {"dateTime": end},
    }
    if description:
        event_body["description"] = description
    if location:
        event_body["location"] = location
    if attendees:
        event_body["attendees"] = [{"email": e} for e in attendees]

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{CALENDAR_BASE}/calendars/{calendar_id}/events",
            headers=_headers(token),
            json=event_body,
            params={"sendUpdates": "all" if send_notifications else "none"},
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "id": data["id"],
            "summary": data.get("summary", ""),
            "html_link": data.get("htmlLink", ""),
            "start": data.get("start", {}),
            "end": data.get("end", {}),
            "status": "created",
        }


async def find_free_slots(
    token: str,
    days_ahead: int = 7,
    calendar_id: str = "primary",
) -> dict:
    """Get free/busy information for the user."""
    now = datetime.utcnow()
    time_min = now.isoformat() + "Z"
    time_max = (now + timedelta(days=days_ahead)).isoformat() + "Z"

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{CALENDAR_BASE}/freeBusy",
            headers=_headers(token),
            json={
                "timeMin": time_min,
                "timeMax": time_max,
                "items": [{"id": calendar_id}],
            },
        )
        resp.raise_for_status()
        data = resp.json()
        busy = data.get("calendars", {}).get(calendar_id, {}).get("busy", [])
        return {
            "time_min": time_min,
            "time_max": time_max,
            "busy_slots": busy,
        }
