"""Migration: add meeting_debriefs table for Meeting Intelligence feature."""

import sqlite3
import sys


def migrate(db_path: str = "agentnet.db"):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS meeting_debriefs (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            event_id VARCHAR(200) NOT NULL,
            event_title VARCHAR(500) NOT NULL DEFAULT '',
            event_start DATETIME,
            event_end DATETIME,
            attendees_json TEXT NOT NULL DEFAULT '[]',
            action_items_json TEXT NOT NULL DEFAULT '[]',
            follow_up_emails_json TEXT NOT NULL DEFAULT '[]',
            notes_text TEXT NOT NULL DEFAULT '',
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("[OK] meeting_debriefs table created")

    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_meeting_debriefs_user ON meeting_debriefs(user_id)
    """)
    print("[OK] idx_meeting_debriefs_user index created")

    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_meeting_debriefs_event ON meeting_debriefs(event_id)
    """)
    print("[OK] idx_meeting_debriefs_event index created")

    conn.commit()
    conn.close()
    print("\nMeeting intel migration complete!")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "agentnet.db"
    migrate(path)
