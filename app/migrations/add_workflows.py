"""Migration: add workflow tables for Workflow Builder feature."""

import sqlite3
import sys


def migrate(db_path: str = "agentnet.db"):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS workflows (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(200) NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            trigger_type VARCHAR(20) NOT NULL DEFAULT 'manual',
            trigger_config TEXT NOT NULL DEFAULT '{}',
            enabled BOOLEAN NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("[OK] workflows table created")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS workflow_steps (
            id VARCHAR(36) PRIMARY KEY,
            workflow_id VARCHAR(36) NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            step_type VARCHAR(30) NOT NULL,
            config_json TEXT NOT NULL DEFAULT '{}',
            on_success VARCHAR(36) NOT NULL DEFAULT 'next',
            on_failure VARCHAR(36) NOT NULL DEFAULT 'end',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("[OK] workflow_steps table created")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS workflow_runs (
            id VARCHAR(36) PRIMARY KEY,
            workflow_id VARCHAR(36) NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status VARCHAR(20) NOT NULL DEFAULT 'running',
            steps_completed INTEGER NOT NULL DEFAULT 0,
            result_json TEXT NOT NULL DEFAULT '{}',
            error TEXT,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME
        )
    """)
    print("[OK] workflow_runs table created")

    cur.execute("CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows(user_id)")
    print("[OK] idx_workflows_user index created")

    cur.execute("CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow ON workflow_steps(workflow_id)")
    print("[OK] idx_workflow_steps_workflow index created")

    cur.execute("CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id)")
    print("[OK] idx_workflow_runs_workflow index created")

    conn.commit()
    conn.close()
    print("\nWorkflow migration complete!")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "agentnet.db"
    migrate(path)
