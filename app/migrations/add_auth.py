"""Migration: Add user auth tables and columns.

Run: python -m app.migrations.add_auth
"""

import sqlite3
import sys


DB_PATH = "agentnet.db"


def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 1. Create users table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(36) PRIMARY KEY,
            email VARCHAR(255) NOT NULL UNIQUE,
            password_hash VARCHAR(255),
            google_id VARCHAR(255) UNIQUE,
            display_name VARCHAR(255) DEFAULT '',
            avatar_url VARCHAR(2048) DEFAULT '',
            auth_provider VARCHAR(20) DEFAULT 'email',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("✓ Created 'users' table")

    # 2. Add user_id column to sessions (nullable)
    try:
        cur.execute("ALTER TABLE sessions ADD COLUMN user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL")
        print("✓ Added 'user_id' to sessions")
    except sqlite3.OperationalError as e:
        if "duplicate column" in str(e).lower():
            print("• sessions.user_id already exists, skipping")
        else:
            raise

    # 3. Add session_id column to conversations (nullable)
    try:
        cur.execute("ALTER TABLE conversations ADD COLUMN session_id VARCHAR(36) REFERENCES sessions(id) ON DELETE SET NULL")
        print("✓ Added 'session_id' to conversations")
    except sqlite3.OperationalError as e:
        if "duplicate column" in str(e).lower():
            print("• conversations.session_id already exists, skipping")
        else:
            raise

    conn.commit()
    conn.close()
    print("\n✅ Migration complete!")


if __name__ == "__main__":
    migrate()
