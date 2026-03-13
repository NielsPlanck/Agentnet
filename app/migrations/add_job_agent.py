"""Migration: add job_profiles and job_applications tables."""

import sqlite3
import sys


def migrate(db_path: str = "agentnet.db"):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # 1. Create job_profiles table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS job_profiles (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            full_name VARCHAR(200) NOT NULL DEFAULT '',
            email VARCHAR(200) NOT NULL DEFAULT '',
            phone VARCHAR(50) NOT NULL DEFAULT '',
            location VARCHAR(200) NOT NULL DEFAULT '',
            cv_text TEXT NOT NULL DEFAULT '',
            cv_filename VARCHAR(200) NOT NULL DEFAULT '',
            cv_base64 TEXT NOT NULL DEFAULT '',
            cv_mime_type VARCHAR(100) NOT NULL DEFAULT '',
            linkedin_url VARCHAR(500) NOT NULL DEFAULT '',
            portfolio_url VARCHAR(500) NOT NULL DEFAULT '',
            target_roles TEXT NOT NULL DEFAULT '[]',
            target_locations TEXT NOT NULL DEFAULT '[]',
            salary_range VARCHAR(100) NOT NULL DEFAULT '',
            job_type VARCHAR(50) NOT NULL DEFAULT 'full-time',
            additional_info TEXT NOT NULL DEFAULT '',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("[OK] job_profiles table created")

    # 2. Create job_applications table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS job_applications (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            job_title VARCHAR(300) NOT NULL DEFAULT '',
            company VARCHAR(300) NOT NULL DEFAULT '',
            job_url VARCHAR(2000) NOT NULL DEFAULT '',
            board VARCHAR(50) NOT NULL DEFAULT 'unknown',
            status VARCHAR(50) NOT NULL DEFAULT 'found',
            applied_at DATETIME,
            screenshot_b64 TEXT,
            error_message TEXT,
            extra_data TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("[OK] job_applications table created")

    conn.commit()
    conn.close()
    print("\nJob agent migration complete!")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "agentnet.db"
    migrate(path)
