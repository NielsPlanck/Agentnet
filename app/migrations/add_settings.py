"""Migration: add user_preferences table + title/user_id columns to conversations."""

import sqlite3
import sys


def migrate(db_path: str = "agentnet.db"):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # 1. Create user_preferences table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_preferences (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            key VARCHAR(100) NOT NULL,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, key)
        )
    """)
    print("[OK] user_preferences table created")

    # 2. Add title to conversations
    try:
        cur.execute("ALTER TABLE conversations ADD COLUMN title VARCHAR(255)")
        print("[OK] conversations.title column added")
    except sqlite3.OperationalError as e:
        if "duplicate column" in str(e).lower():
            print("[SKIP] conversations.title already exists")
        else:
            raise

    # 3. Add user_id to conversations
    try:
        cur.execute("ALTER TABLE conversations ADD COLUMN user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL")
        print("[OK] conversations.user_id column added")
    except sqlite3.OperationalError as e:
        if "duplicate column" in str(e).lower():
            print("[SKIP] conversations.user_id already exists")
        else:
            raise

    # 4. Backfill titles from first user message
    cur.execute("""
        UPDATE conversations SET title = (
            SELECT SUBSTR(content, 1, 80) FROM messages
            WHERE messages.conversation_id = conversations.id
            AND messages.role = 'user' AND messages.seq = 1
        ) WHERE title IS NULL
    """)
    updated = cur.rowcount
    print(f"[OK] Backfilled {updated} conversation titles")

    # 5. Backfill user_id from session → user link
    cur.execute("""
        UPDATE conversations SET user_id = (
            SELECT sessions.user_id FROM sessions
            WHERE sessions.id = conversations.session_id
            AND sessions.user_id IS NOT NULL
        ) WHERE conversations.user_id IS NULL AND conversations.session_id IS NOT NULL
    """)
    updated = cur.rowcount
    print(f"[OK] Backfilled {updated} conversation user_ids")

    conn.commit()
    conn.close()
    print("\nMigration complete!")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "agentnet.db"
    migrate(path)
