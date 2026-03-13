"""Migration: add email_digests table for Smart Inbox feature."""

import sqlite3
import sys


def migrate(db_path: str = "agentnet.db"):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS email_digests (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            routine_run_id VARCHAR(36),
            emails_processed INTEGER NOT NULL DEFAULT 0,
            urgent_count INTEGER NOT NULL DEFAULT 0,
            summary_text TEXT NOT NULL DEFAULT '',
            categories_json TEXT NOT NULL DEFAULT '{}',
            draft_suggestions_json TEXT NOT NULL DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("[OK] email_digests table created")

    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_email_digests_user ON email_digests(user_id)
    """)
    print("[OK] idx_email_digests_user index created")

    conn.commit()
    conn.close()
    print("\nEmail intel migration complete!")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "agentnet.db"
    migrate(path)
