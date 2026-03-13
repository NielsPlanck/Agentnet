#!/bin/bash
set -e

echo "=== AgentNet starting ==="

# Run all migrations (idempotent — each uses IF NOT EXISTS)
echo "Running migrations..."
python -m app.migrations.add_auth 2>/dev/null || true
python -m app.migrations.add_campaigns 2>/dev/null || true
python -m app.migrations.add_settings 2>/dev/null || true
python -m app.migrations.add_job_agent 2>/dev/null || true
python -m app.migrations.add_routines 2>/dev/null || true
python -m app.migrations.add_memories 2>/dev/null || true
python -m app.migrations.add_email_intel 2>/dev/null || true
python -m app.migrations.add_meeting_intel 2>/dev/null || true
python -m app.migrations.add_workflows 2>/dev/null || true
python -m app.migrations.add_skills 2>/dev/null || true
echo "Migrations done."

echo "Starting server on port ${PORT:-8000}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1
