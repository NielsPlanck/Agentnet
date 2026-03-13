"""Apple ecosystem integrations — Calendar, Reminders, Notes, iMessage, Notifications.

All functions use osascript (AppleScript) via subprocess for zero external dependencies.
Async wrappers use run_in_executor so they never block the event loop.
"""

import asyncio
import json
import logging
import os
import re
import sqlite3
import subprocess
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────

def _escape(text: str) -> str:
    """Escape text for AppleScript string literals."""
    return text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _run_osascript_sync(script: str) -> str:
    """Execute AppleScript synchronously. Returns stdout."""
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            logger.warning("osascript error: %s", result.stderr.strip())
            return ""
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        logger.error("osascript timed out")
        return ""
    except Exception as e:
        logger.error("osascript failed: %s", e)
        return ""


async def _run_osascript(script: str) -> str:
    """Execute AppleScript asynchronously via run_in_executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _run_osascript_sync, script)


# ── Apple Calendar ───────────────────────────────────────────────────

async def apple_calendar_list_events(days_ahead: int = 7) -> list[dict]:
    """List upcoming calendar events for the next N days."""
    script = f"""
set startDate to current date
set endDate to startDate + ({days_ahead} * days)
set output to ""
tell application "Calendar"
    set allEvents to {{}}
    repeat with cal in calendars
        set calEvents to (every event of cal whose start date >= startDate and start date <= endDate)
        repeat with evt in calEvents
            set evtStart to start date of evt
            set evtEnd to end date of evt
            set evtTitle to summary of evt
            set evtLoc to ""
            try
                set evtLoc to location of evt
            end try
            set evtNotes to ""
            try
                set evtNotes to description of evt
            end try
            set output to output & evtTitle & "|||" & (evtStart as string) & "|||" & (evtEnd as string) & "|||" & evtLoc & "|||" & evtNotes & "|||" & (name of cal) & linefeed
        end repeat
    end repeat
end tell
return output
"""
    raw = await _run_osascript(script)
    events = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|||")
        if len(parts) >= 6:
            events.append({
                "title": parts[0].strip(),
                "start": parts[1].strip(),
                "end": parts[2].strip(),
                "location": parts[3].strip(),
                "notes": parts[4].strip(),
                "calendar": parts[5].strip(),
            })
    return events


async def apple_calendar_create_event(
    title: str,
    start: str,
    end: str = "",
    calendar_name: str = "",
    notes: str = "",
    location: str = "",
) -> dict:
    """Create an event in Apple Calendar.

    start/end: ISO-ish datetime strings or human-readable date strings.
    If end is empty, defaults to 1 hour after start.
    """
    # Parse start time
    start_applescript = f'date "{start}"'

    # If end is empty, default to 1 hour after start
    if end:
        end_applescript = f'date "{end}"'
    else:
        end_applescript = f'(date "{start}") + (1 * hours)'

    # Determine which calendar to use
    cal_line = ""
    if calendar_name:
        cal_line = f'tell calendar "{_escape(calendar_name)}"'
    else:
        cal_line = 'tell (first calendar whose name is not "")'

    props = f'summary:"{_escape(title)}", start date:({start_applescript}), end date:({end_applescript})'
    if location:
        props += f', location:"{_escape(location)}"'
    if notes:
        props += f', description:"{_escape(notes)}"'

    script = f"""
tell application "Calendar"
    {cal_line}
        make new event at end with properties {{{props}}}
    end tell
end tell
"""
    await _run_osascript(script)
    logger.info("Created calendar event: %s", title)
    return {"title": title, "start": start, "end": end or "(+1 hour)", "status": "created"}


# ── Apple Reminders ──────────────────────────────────────────────────

async def apple_reminders_list(list_name: str = "") -> list[dict]:
    """List incomplete reminders."""
    if list_name:
        target = f'list "{_escape(list_name)}"'
    else:
        target = "default list"

    script = f"""
set output to ""
tell application "Reminders"
    tell {target}
        set incompleteReminders to (every reminder whose completed is false)
        repeat with r in incompleteReminders
            set rName to name of r
            set rDue to ""
            try
                set rDue to (due date of r) as string
            end try
            set rNotes to ""
            try
                set rNotes to body of r
            end try
            set output to output & rName & "|||" & rDue & "|||" & rNotes & linefeed
        end repeat
    end tell
end tell
return output
"""
    raw = await _run_osascript(script)
    reminders = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|||")
        if len(parts) >= 3:
            reminders.append({
                "name": parts[0].strip(),
                "due_date": parts[1].strip(),
                "notes": parts[2].strip(),
            })
    return reminders


async def apple_reminders_create(
    name: str,
    due_date: str = "",
    notes: str = "",
    list_name: str = "",
) -> dict:
    """Create a reminder in Apple Reminders."""
    if list_name:
        target = f'list "{_escape(list_name)}"'
    else:
        target = "default list"

    props = f'name:"{_escape(name)}"'
    if due_date:
        props += f', due date:(date "{due_date}")'
    if notes:
        props += f', body:"{_escape(notes)}"'

    script = f"""
tell application "Reminders"
    tell {target}
        make new reminder at end with properties {{{props}}}
    end tell
end tell
"""
    await _run_osascript(script)
    logger.info("Created reminder: %s", name)
    return {"name": name, "due_date": due_date, "status": "created"}


async def apple_reminders_complete(name: str, list_name: str = "") -> dict:
    """Mark a reminder as completed."""
    if list_name:
        target = f'list "{_escape(list_name)}"'
    else:
        target = "default list"

    script = f"""
tell application "Reminders"
    tell {target}
        set targetReminder to (first reminder whose name is "{_escape(name)}")
        set completed of targetReminder to true
    end tell
end tell
"""
    await _run_osascript(script)
    logger.info("Completed reminder: %s", name)
    return {"name": name, "status": "completed"}


# ── Apple Notes ──────────────────────────────────────────────────────

async def apple_notes_create(title: str, body: str, folder: str = "Notes") -> dict:
    """Create a note in Apple Notes."""
    script = f"""
tell application "Notes"
    tell account "iCloud"
        tell folder "{_escape(folder)}"
            make new note at end with properties {{name:"{_escape(title)}", body:"{_escape(body)}"}}
        end tell
    end tell
end tell
"""
    result = await _run_osascript(script)
    # If iCloud fails, try "On My Mac"
    if not result and "error" in result.lower():
        script_local = f"""
tell application "Notes"
    tell account "On My Mac"
        tell folder "{_escape(folder)}"
            make new note at end with properties {{name:"{_escape(title)}", body:"{_escape(body)}"}}
        end tell
    end tell
end tell
"""
        await _run_osascript(script_local)

    logger.info("Created note: %s", title)
    return {"title": title, "folder": folder, "status": "created"}


async def apple_notes_list(folder: str = "Notes", limit: int = 20) -> list[dict]:
    """List recent notes from Apple Notes."""
    script = f"""
set output to ""
tell application "Notes"
    set noteCount to 0
    repeat with acct in accounts
        try
            tell acct
                tell folder "{_escape(folder)}"
                    repeat with n in notes
                        if noteCount >= {limit} then exit repeat
                        set nTitle to name of n
                        set nDate to (modification date of n) as string
                        set nBody to ""
                        try
                            set nBody to plaintext of n
                            if length of nBody > 200 then
                                set nBody to text 1 thru 200 of nBody
                            end if
                        end try
                        set output to output & nTitle & "|||" & nDate & "|||" & nBody & linefeed
                        set noteCount to noteCount + 1
                    end repeat
                end tell
            end tell
        end try
    end repeat
end tell
return output
"""
    raw = await _run_osascript(script)
    notes = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|||")
        if len(parts) >= 3:
            notes.append({
                "title": parts[0].strip(),
                "modified": parts[1].strip(),
                "preview": parts[2].strip()[:200],
            })
    return notes[:limit]


# ── iMessage (read-only) ────────────────────────────────────────────

async def imessage_recent(hours: int = 24, limit: int = 50) -> list[dict]:
    """Read recent iMessages from ~/Library/Messages/chat.db.

    Requires Full Disk Access permission for the process.
    Returns empty list if DB not accessible.
    """
    db_path = os.path.expanduser("~/Library/Messages/chat.db")
    if not os.path.exists(db_path):
        logger.warning("iMessage database not found at %s", db_path)
        return []

    def _read_messages():
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            cur = conn.cursor()

            # iMessage stores dates as seconds since 2001-01-01 (Mac epoch)
            # We need to convert to Unix epoch
            mac_epoch_offset = 978307200  # seconds between 1970-01-01 and 2001-01-01
            cutoff = (datetime.now() - timedelta(hours=hours)).timestamp() - mac_epoch_offset
            # iMessage dates are in nanoseconds since 2001
            cutoff_ns = int(cutoff * 1_000_000_000)

            cur.execute("""
                SELECT
                    m.text,
                    m.is_from_me,
                    m.date,
                    h.id as handle_id
                FROM message m
                LEFT JOIN handle h ON m.handle_id = h.ROWID
                WHERE m.text IS NOT NULL
                  AND m.text != ''
                  AND m.date > ?
                ORDER BY m.date DESC
                LIMIT ?
            """, (cutoff_ns, limit))

            messages = []
            for row in cur.fetchall():
                text, is_from_me, date_ns, handle_id = row
                # Convert to readable datetime
                ts = (date_ns / 1_000_000_000) + mac_epoch_offset
                dt = datetime.fromtimestamp(ts)
                messages.append({
                    "text": text[:500],  # truncate long messages
                    "from": "me" if is_from_me else (handle_id or "unknown"),
                    "time": dt.strftime("%Y-%m-%d %H:%M"),
                })
            conn.close()
            return messages
        except Exception as e:
            logger.warning("Failed to read iMessages: %s", e)
            return []

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _read_messages)


# ── macOS Notifications ──────────────────────────────────────────────

async def send_notification(title: str, message: str, sound: str = "default") -> None:
    """Send a macOS notification via osascript."""
    # Truncate message to avoid osascript issues
    msg = message[:300].replace("\n", " ")
    script = f'display notification "{_escape(msg)}" with title "{_escape(title)}" sound name "{sound}"'
    await _run_osascript(script)
    logger.info("Sent notification: %s", title)
