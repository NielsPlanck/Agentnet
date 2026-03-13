"""Migration: add routines and routine_runs tables."""

import sqlite3
import sys


def migrate(db_path: str = "agentnet.db"):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS routines (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(200) NOT NULL DEFAULT '',
            prompt TEXT NOT NULL DEFAULT '',
            schedule_type VARCHAR(20) NOT NULL DEFAULT 'cron',
            schedule_value VARCHAR(100) NOT NULL DEFAULT '',
            enabled BOOLEAN NOT NULL DEFAULT 1,
            last_run_at DATETIME,
            next_run_at DATETIME,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("[OK] routines table created")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS routine_runs (
            id VARCHAR(36) PRIMARY KEY,
            routine_id VARCHAR(36) NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
            user_id VARCHAR(36) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'running',
            result_text TEXT NOT NULL DEFAULT '',
            conversation_id VARCHAR(36),
            notified BOOLEAN NOT NULL DEFAULT 0,
            read_at DATETIME,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            error TEXT
        )
    """)
    print("[OK] routine_runs table created")

    conn.commit()
    conn.close()
    print("\nRoutines migration complete!")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "agentnet.db"
    migrate(path)
