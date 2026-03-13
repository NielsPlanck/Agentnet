"""Memory service — inject persistent memories into context, auto-extract from conversations."""

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select, func as sa_func

from app.database import async_session
from app.models.memory import Memory

log = logging.getLogger(__name__)

# Maximum memories to inject into context
MAX_INJECT = 20
# Maximum memories total per user
MAX_MEMORIES_PER_USER = 200


async def inject_memories(user_id: str, query: str = "") -> str:
    """Retrieve the most relevant memories and format as context string.

    Strategy:
    - Always inject up to MAX_INJECT memories, sorted by importance then recency
    - If a query is provided, prefer memories whose key/content matches query keywords
    - Bump last_used_at for injected memories
    """
    async with async_session() as db:
        # Get all user memories, ordered by importance desc, then most recently used
        stmt = (
            select(Memory)
            .where(Memory.user_id == user_id)
            .order_by(Memory.importance.desc(), Memory.last_used_at.desc().nullslast(), Memory.created_at.desc())
            .limit(MAX_INJECT * 2)  # fetch extra for keyword filtering
        )
        result = await db.execute(stmt)
        all_memories = result.scalars().all()

        if not all_memories:
            return ""

        # If query provided, score memories by keyword relevance
        if query:
            query_words = set(query.lower().split())
            scored: list[tuple[float, Memory]] = []
            for m in all_memories:
                text = f"{m.key} {m.content}".lower()
                matches = sum(1 for w in query_words if w in text and len(w) > 2)
                # Combine importance with keyword match score
                score = m.importance + (matches * 0.3)
                scored.append((score, m))
            scored.sort(key=lambda x: x[0], reverse=True)
            selected = [m for _, m in scored[:MAX_INJECT]]
        else:
            selected = all_memories[:MAX_INJECT]

        if not selected:
            return ""

        # Format as context
        parts: list[str] = ["## Your Memories About This User\n"]
        for m in selected:
            cat_label = m.category.upper() if m.category else "FACT"
            parts.append(f"- [{cat_label}] **{m.key}**: {m.content}")

        # Bump last_used_at
        now = datetime.now(timezone.utc)
        for m in selected:
            m.last_used_at = now
        await db.commit()

        return "\n".join(parts)


async def auto_extract_memories(user_id: str, conversation_text: str, conversation_id: str = "") -> list[dict]:
    """Use LLM to extract memorable facts from a conversation.

    Returns list of extracted memory dicts.
    """
    if not conversation_text or len(conversation_text) < 50:
        return []

    # Truncate very long conversations
    text = conversation_text[:8000]

    try:
        from google import genai
        from google.genai import types
        from app.config import settings

        client = genai.Client(api_key=settings.gemini_api_key)

        extraction_prompt = f"""Analyze this conversation and extract important facts, preferences, contacts, or decisions the user revealed. Only extract genuinely useful, memorable information.

CONVERSATION:
{text}

Return a JSON array of objects. Each object must have:
- "category": one of "preference", "contact", "fact", "decision", "pattern"
- "key": short label (2-6 words), e.g. "Favorite cuisine", "Manager's name"
- "content": full detail (1-2 sentences)
- "importance": float 0-1 (1 = critical personal info, 0.3 = minor detail)

Rules:
- Only extract genuinely NEW and USEFUL information
- Skip generic conversation filler
- Skip anything that's temporary or time-sensitive (today's weather, current time)
- Contacts: include name, relationship, and any details mentioned
- Preferences: be specific (not "likes food" but "prefers Italian restaurants, especially seafood")
- Decisions: record what was decided and why
- Return empty array [] if nothing worth remembering
- Maximum 5 items per conversation

Return ONLY valid JSON array, no markdown formatting."""

        response = await client.aio.models.generate_content(
            model=settings.gemini_chat_model,
            contents=[types.Content(role="user", parts=[types.Part.from_text(text=extraction_prompt)])],
            config=types.GenerateContentConfig(
                max_output_tokens=1024,
                temperature=0.1,
            ),
        )

        raw = (response.text or "").strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

        memories_data = json.loads(raw)
        if not isinstance(memories_data, list):
            return []

        # Validate and store
        source = f"conversation:{conversation_id}" if conversation_id else "auto"
        stored: list[dict] = []

        async with async_session() as db:
            # Check current count
            count_result = await db.execute(
                select(sa_func.count(Memory.id)).where(Memory.user_id == user_id)
            )
            current_count = count_result.scalar() or 0

            for item in memories_data[:5]:
                if current_count >= MAX_MEMORIES_PER_USER:
                    log.warning("User %s hit memory limit (%d)", user_id, MAX_MEMORIES_PER_USER)
                    break

                category = item.get("category", "fact")
                if category not in ("preference", "contact", "fact", "decision", "pattern"):
                    category = "fact"

                key = str(item.get("key", ""))[:200]
                content = str(item.get("content", ""))
                importance = min(max(float(item.get("importance", 0.5)), 0.0), 1.0)

                if not key or not content:
                    continue

                # Check for duplicate (same user + similar key)
                dup_check = await db.execute(
                    select(Memory).where(
                        Memory.user_id == user_id,
                        Memory.key == key,
                    )
                )
                existing = dup_check.scalar_one_or_none()

                if existing:
                    # Update existing memory with new content
                    existing.content = content
                    existing.importance = max(existing.importance, importance)
                    existing.source = source
                    stored.append({"id": existing.id, "key": key, "content": content, "updated": True})
                else:
                    mem = Memory(
                        user_id=user_id,
                        category=category,
                        key=key,
                        content=content,
                        source=source,
                        importance=importance,
                    )
                    db.add(mem)
                    current_count += 1
                    stored.append({"id": mem.id, "key": key, "content": content, "updated": False})

            await db.commit()

        log.info("Extracted %d memories from conversation for user %s", len(stored), user_id)
        return stored

    except json.JSONDecodeError:
        log.warning("Failed to parse memory extraction JSON")
        return []
    except Exception:
        log.exception("Memory extraction failed")
        return []


async def search_memories(user_id: str, query: str, limit: int = 20) -> list[dict]:
    """Search memories by content (LIKE query)."""
    async with async_session() as db:
        stmt = (
            select(Memory)
            .where(
                Memory.user_id == user_id,
                (Memory.key.ilike(f"%{query}%")) | (Memory.content.ilike(f"%{query}%")),
            )
            .order_by(Memory.importance.desc())
            .limit(limit)
        )
        result = await db.execute(stmt)
        memories = result.scalars().all()
        return [_memory_to_dict(m) for m in memories]


async def list_memories(user_id: str, category: str | None = None, limit: int = 100, offset: int = 0) -> dict:
    """List all memories, optionally filtered by category."""
    async with async_session() as db:
        stmt = select(Memory).where(Memory.user_id == user_id)
        if category:
            stmt = stmt.where(Memory.category == category)
        stmt = stmt.order_by(Memory.importance.desc(), Memory.created_at.desc())

        # Count
        count_stmt = select(sa_func.count(Memory.id)).where(Memory.user_id == user_id)
        if category:
            count_stmt = count_stmt.where(Memory.category == category)
        count_result = await db.execute(count_stmt)
        total = count_result.scalar() or 0

        # Paginate
        stmt = stmt.offset(offset).limit(limit)
        result = await db.execute(stmt)
        memories = result.scalars().all()

        return {
            "memories": [_memory_to_dict(m) for m in memories],
            "total": total,
        }


def _memory_to_dict(m: Memory) -> dict:
    return {
        "id": m.id,
        "category": m.category,
        "key": m.key,
        "content": m.content,
        "source": m.source,
        "importance": m.importance,
        "last_used_at": m.last_used_at.isoformat() if m.last_used_at else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }
