# ── Stage 1: Build Next.js frontend ──────────────────────────────
FROM node:22-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps

COPY frontend/ ./
RUN npm run build
# Output is in /frontend/out (static export)


# ── Stage 2: Python backend ───────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Install Python dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy application code
COPY app/ ./app/

# Copy built frontend into backend static dir
COPY --from=frontend-builder /frontend/out/ ./app/static/

# Copy entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Persistent data directory for SQLite
RUN mkdir -p /data

ENV PATH="/app/.venv/bin:$PATH"
ENV AGENTNET_DATABASE_URL="sqlite+aiosqlite:////data/agentnet.db"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

ENTRYPOINT ["./entrypoint.sh"]
