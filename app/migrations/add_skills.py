"""Migration: add custom_skills table for user-created skills."""

import sqlite3
import sys


def migrate(db_path: str = "agentnet.db"):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS custom_skills (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(100) NOT NULL,
            description VARCHAR(500) NOT NULL DEFAULT '',
            icon VARCHAR(50) NOT NULL DEFAULT 'Zap',
            instructions TEXT NOT NULL DEFAULT '',
            mcp_server_url VARCHAR(2048),
            enabled BOOLEAN NOT NULL DEFAULT 1,
            is_public BOOLEAN NOT NULL DEFAULT 0,
            share_code VARCHAR(36) UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("[OK] custom_skills table created")

    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_custom_skills_user_id
        ON custom_skills(user_id)
    """)
    print("[OK] idx_custom_skills_user_id index created")

    conn.commit()
    conn.close()
    print("\nCustom skills migration complete!")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "agentnet.db"
    migrate(path)
