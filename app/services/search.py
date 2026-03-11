import json
import logging

import numpy as np
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.tool import Action, Tool
from app.schemas.search import (
    SearchRequest,
    SearchResponse,
    SearchResultItem,
    WorkflowStep,
)
from app.models.domain import Domain, DomainTool
from app.services.discovery import discover_and_create
from app.services.embeddings import get_embedding

log = logging.getLogger(__name__)

MIN_SIMILARITY = 0.5

_client: AsyncOpenAI | None = None

INTENT_REWRITE_PROMPT = """\
You are an intent decomposition engine for AgentNet (a tool search engine).

Given a user's raw query, figure out what KIND of tool/platform they actually need.

Think step-by-step:
1. What is the user's GOAL?
2. What is their CONTEXT? (location, time constraints, specific brand mentioned?)
3. What does that context IMPLY? (e.g., "at home" + "eat food" = needs delivery)
4. What is the RIGHT tool category? Be specific — distinguish between:
   - Flight aggregators (compare prices across airlines): Skyscanner, Kayak, Google Flights
   - Direct airline booking (user mentions a specific airline or wants to book direct): Air France, United, Delta, Emirates, British Airways, Lufthansa
   - Hotels (not flights): Booking.com, Hotels.com
   - Short-term rentals/stays (not flights): Airbnb, Vrbo

Examples:
- "I want to eat a burger at home" → "food delivery app order burger"
- "I want to buy McDonald's, I'm at home" → "food delivery app McDonald's delivery"
- "I want to buy an iPhone" → "buy iPhone online retail store"
- "cheapest flight to Paris next week" → "flight search compare prices aggregator cheapest fare"
- "fly Air France to Paris" → "Air France book flight directly airline"
- "book a United flight to New York" → "United Airlines book flight directly"
- "find me a hotel in Rome" → "hotel search booking accommodation"
- "rent an apartment in Lisbon" → "short-term rental accommodation Airbnb Vrbo"
- "I want to invest in Tesla stock" → "stock brokerage trading app"
- "send a message to my team" → "team messaging app"
- "contact VCs and send my pitch deck" → "email pitch deck VC outreach investor database"
- "post on social media" → "social media management posting tool"
- "analyze my sales data" → "data analytics spreadsheet dashboard tool"
- "hire a developer" → "job posting recruitment platform hiring"

Return ONLY a JSON object (no markdown):
{"rewritten_query": "the rewritten search query", "reasoning": "brief explanation"}
"""


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


async def rewrite_intent(raw_query: str) -> str:
    """Use LLM to rewrite user intent into the right tool-search query."""
    if not settings.openai_api_key:
        return raw_query
    # Skip rewrite for short queries — the chat LLM handles clarification
    if len(raw_query.split()) <= 4:
        return raw_query

    try:
        client = _get_client()
        response = await client.chat.completions.create(
            model=settings.openai_fast_model,
            messages=[
                {"role": "system", "content": INTENT_REWRITE_PROMPT},
                {"role": "user", "content": raw_query},
            ],
            temperature=0.1,
            max_tokens=200,
        )
        raw = response.choices[0].message.content or ""
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]
        parsed = json.loads(raw.strip())
        rewritten = parsed.get("rewritten_query", raw_query)
        log.info("Intent rewrite: %r → %r (%s)", raw_query, rewritten, parsed.get("reasoning", ""))
        return rewritten
    except Exception:
        log.exception("Intent rewrite failed, using raw query")
        return raw_query


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    a_arr, b_arr = np.array(a), np.array(b)
    dot = np.dot(a_arr, b_arr)
    norm = np.linalg.norm(a_arr) * np.linalg.norm(b_arr)
    return float(dot / norm) if norm > 0 else 0.0


def _group_by_tool(scored: list[tuple]) -> list[SearchResultItem]:
    """Group scored (action, tool, similarity) tuples into per-tool results with workflow steps."""
    tool_map: dict[str, dict] = {}

    for action, tool, sim in scored:
        if tool.id not in tool_map:
            tool_map[tool.id] = {
                "tool": tool,
                "best_sim": sim,
                "actions": [],
            }
        # Track best similarity for ranking
        if sim > tool_map[tool.id]["best_sim"]:
            tool_map[tool.id]["best_sim"] = sim
        tool_map[tool.id]["actions"].append((action, sim))

    # Sort tools by priority boost + similarity (priority adds up to 0.2 bonus)
    def _score(entry: dict) -> float:
        boost = min(entry["tool"].priority, 10) * 0.02  # priority 0-10 → 0.0-0.2 bonus
        return entry["best_sim"] + boost

    ranked = sorted(tool_map.values(), key=_score, reverse=True)

    items = []
    for rank, entry in enumerate(ranked, 1):
        tool = entry["tool"]
        actions = entry["actions"]
        # Sort actions within tool by similarity (most relevant first)
        actions.sort(key=lambda x: x[1], reverse=True)

        workflow = [
            WorkflowStep(
                action_id=action.id,
                action_name=action.name,
                description=action.description,
                step_number=step,
                input_schema=action.input_schema,
            )
            for step, (action, _sim) in enumerate(actions, 1)
        ]

        items.append(
            SearchResultItem(
                tool_name=tool.name,
                display_name=(
                    tool.name  # already a clean label (e.g. "AWS S3", "Booking.com", "Figma")
                    if "/" not in tool.name and tool.name[:1].isupper()
                    else tool.provider or tool.name  # slug needs human name
                ),
                tool_id=tool.id,
                transport=tool.transport,
                base_url=tool.base_url,
                page_url=tool.page_url,
                description=f"{tool.provider} — {tool.name}",
                similarity=round(entry["best_sim"], 4),
                status=tool.status,
                auth_type=tool.auth_type,
                rank=rank,
                workflow=workflow,
            )
        )

    return items


async def _embedding_search(
    db: AsyncSession, query: str, req: SearchRequest
) -> list[tuple]:
    """Run embedding similarity search for a single query string."""
    query_embedding = await get_embedding(query)

    stmt = (
        select(Action, Tool)
        .join(Tool, Action.tool_id == Tool.id)
        .where(Action.embedding.isnot(None))
        .where(Tool.status.in_(["active", "no_mcp"]))
    )

    if req.transport:
        stmt = stmt.where(Tool.transport == req.transport)

    result = await db.execute(stmt)
    rows = result.all()

    scored = []
    for action, tool in rows:
        if req.category and req.category not in (tool.tags or []):
            continue
        if not isinstance(action.embedding, list):
            continue
        similarity = _cosine_similarity(query_embedding, action.embedding)
        if similarity >= MIN_SIMILARITY:
            scored.append((action, tool, similarity))

    return scored


MIN_RESULTS = 4  # always show at least this many tools


async def _match_domain(db: AsyncSession, query: str) -> dict[str, int] | None:
    """
    Check if the query matches any domain's keywords.
    Returns {tool_id: rank} mapping if matched, else None.
    Rank 1 = highest priority (shown first).
    """
    q = query.lower()
    result = await db.execute(
        select(Domain).options(
            selectinload(Domain.tool_ranks).selectinload(DomainTool.tool)
        )
    )
    domains = result.scalars().all()

    for domain in domains:
        keywords = [kw.lower() for kw in (domain.keywords or [])]
        if any(kw in q for kw in keywords):
            # Convert rank to a priority boost: rank 1 → boost 1.0, rank 2 → 0.9, etc.
            return {
                dt.tool_id: max(0, 1.0 - (dt.rank - 1) * 0.1)
                for dt in domain.tool_ranks
            }
    return None


async def search_by_intent(db: AsyncSession, req: SearchRequest) -> SearchResponse:
    # Step 1: Rewrite intent to find the right abstraction level
    rewritten = await rewrite_intent(req.intent)

    # Step 2: Check if query matches a curated domain (admin-defined rankings)
    combined_query = f"{req.intent} {rewritten}".lower()
    domain_boosts = await _match_domain(db, combined_query)

    # Step 3: Search with both raw and rewritten queries, keep best scores
    raw_scored = await _embedding_search(db, req.intent, req)
    rewritten_scored = await _embedding_search(db, rewritten, req) if rewritten != req.intent else []

    # Merge: for each (action, tool), keep the highest similarity from either query
    best: dict[tuple[str, str], tuple] = {}
    for action, tool, sim in raw_scored + rewritten_scored:
        key = (action.id, tool.id)
        if key not in best or sim > best[key][2]:
            best[key] = (action, tool, sim)

    # Apply domain boosts: override similarity with domain rank score when matched
    if domain_boosts:
        boosted = []
        for (action_id, tool_id), (action, tool, sim) in best.items():
            if tool_id in domain_boosts:
                # Domain rank takes precedence — rank 1 gets sim=1.0, rank 2 gets 0.9, etc.
                boosted.append((action, tool, domain_boosts[tool_id]))
            else:
                boosted.append((action, tool, sim * 0.5))  # de-prioritize non-domain tools
        scored = sorted(boosted, key=lambda x: x[2], reverse=True)
    else:
        scored = sorted(best.values(), key=lambda x: x[2], reverse=True)

    # Group by tool, build workflow per tool
    items = _group_by_tool(scored)
    items = items[: req.limit]

    # If fewer than MIN_RESULTS, relax threshold and fill up with next best
    if len(items) < MIN_RESULTS:
        existing_tool_ids = {i.tool_id for i in items}
        relaxed = await _embedding_search_relaxed(db, rewritten or req.intent, req, existing_tool_ids)
        items.extend(relaxed[: MIN_RESULTS - len(items)])

    # If still nothing, use LLM to discover with the rewritten intent
    if not items:
        discovered = await discover_and_create(db, rewritten)
        items.extend(discovered)

    return SearchResponse(intent=req.intent, results=items, count=len(items))


async def _embedding_search_relaxed(
    db: AsyncSession, query: str, req: SearchRequest, exclude_tool_ids: set
) -> list[SearchResultItem]:
    """Search with a lower threshold (0.3) to fill gaps when results are scarce."""
    query_embedding = await get_embedding(query)

    stmt = (
        select(Action, Tool)
        .join(Tool, Action.tool_id == Tool.id)
        .where(Action.embedding.isnot(None))
        .where(Tool.status.in_(["active", "no_mcp"]))
    )
    result = await db.execute(stmt)
    rows = result.all()

    scored = []
    for action, tool in rows:
        if tool.id in exclude_tool_ids:
            continue
        if req.category and req.category not in (tool.tags or []):
            continue
        if not isinstance(action.embedding, list):
            continue
        similarity = _cosine_similarity(query_embedding, action.embedding)
        if similarity >= 0.3:
            scored.append((action, tool, similarity))

    return _group_by_tool(sorted(scored, key=lambda x: x[2], reverse=True))
