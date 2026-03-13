"""Migration: add memories table for persistent AI memory."""

import sqlite3
import sys


def migrate(db_path: str = "agentnet.db"):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS memories (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category VARCHAR(30) NOT NULL DEFAULT 'fact',
            key VARCHAR(200) NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            source VARCHAR(100) NOT NULL DEFAULT 'auto',
            importance REAL NOT NULL DEFAULT 0.5,
            last_used_at DATETIME,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("[OK] memories table created")

    # Index for fast user lookup
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)
    """)
    print("[OK] idx_memories_user_id index created")

    # Index for category filtering
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(user_id, category)
    """)
    print("[OK] idx_memories_category index created")

    conn.commit()
    conn.close()
    print("\nMemories migration complete!")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "agentnet.db"
    migrate(path)
