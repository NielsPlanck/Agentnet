"""Person intelligence — research a person's recent activities across the web.

Uses Tavily for web search and Gemini for extraction/summarization.
"""

import asyncio
import json
import logging
import re

import httpx
from google import genai

from app.config import settings

log = logging.getLogger(__name__)

_SEMAPHORE = asyncio.Semaphore(3)


async def _tavily_search(query: str, max_results: int = 8) -> list[dict]:
    """Run a Tavily search."""
    if not settings.tavily_api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": settings.tavily_api_key,
                    "query": query,
                    "max_results": max_results,
                    "include_answer": False,
                },
            )
            resp.raise_for_status()
            return resp.json().get("results", [])
    except Exception:
        log.exception("Tavily search failed: %s", query)
        return []


async def research_person(
    name: str,
    company: str = "",
    role: str = "",
    topics: list[str] | None = None,
) -> dict:
    """Research a person by searching multiple angles in parallel.

    Returns structured intel: bio, recent activities, social posts, news mentions,
    interests, and talking points for outreach.
    """
    # Build targeted search queries
    base = f"{name}"
    if company:
        base += f" {company}"
    if role:
        base += f" {role}"

    queries = [
        f"{base} recent news interview podcast 2025 2026",
        f"{base} LinkedIn activity posts",
        f"{name} {company} funding investment announcement" if company else f"{name} business announcement",
    ]
    if topics:
        for t in topics[:2]:
            queries.append(f"{base} {t}")

    # Run all searches in parallel
    async def _search(q: str) -> list[dict]:
        async with _SEMAPHORE:
            return await _tavily_search(q, max_results=5)

    all_results_lists = await asyncio.gather(*[_search(q) for q in queries])

    # Deduplicate by URL
    seen_urls: set[str] = set()
    all_results: list[dict] = []
    for results in all_results_lists:
        for r in results:
            url = r.get("url", "")
            if url not in seen_urls:
                seen_urls.add(url)
                all_results.append(r)

    if not all_results:
        return {
            "name": name,
            "company": company,
            "summary": f"No recent public information found for {name}.",
            "activities": [],
            "talking_points": [],
            "sources": [],
        }

    # Build context for Gemini
    context_parts = []
    sources = []
    for r in all_results[:15]:
        title = r.get("title", "")
        content = r.get("content", "")[:600]
        url = r.get("url", "")
        context_parts.append(f"Source: {title}\nURL: {url}\n{content}")
        sources.append({"title": title, "url": url})

    context = "\n\n---\n\n".join(context_parts)

    prompt = f"""Analyze these search results about "{name}" {f'at {company}' if company else ''} and extract a comprehensive intelligence report.

SEARCH RESULTS:
{context}

Return ONLY a JSON object with these fields:
{{
  "summary": "2-3 sentence bio/overview of who this person is and what they do",
  "recent_activities": [
    {{"date": "approximate date or 'Recent'", "activity": "what they did", "source": "source name", "url": "source URL", "type": "news|social|interview|funding|partnership|speaking|publication"}}
  ],
  "interests": ["list of topics/areas they care about based on their activity"],
  "talking_points": ["3-5 personalized conversation starters or email hooks based on their recent activities — be specific, reference actual events/posts"],
  "social_profiles": {{
    "linkedin": "URL if found",
    "twitter": "URL if found"
  }}
}}

RULES:
- recent_activities: list 5-10 most recent/notable activities, sorted by recency
- talking_points: each should be a specific, personalized hook you could use to start a conversation or email. Reference a REAL activity.
- Only include information actually found in the search results
- If something isn't found, use null or empty array
- Return valid JSON only, no markdown"""

    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        response = await client.aio.models.generate_content(
            model=settings.gemini_chat_model,
            contents=prompt,
        )
        text = response.text.strip()
        # Extract JSON from response
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            data = json.loads(match.group())
            data["name"] = name
            data["company"] = company or data.get("company", "")
            data["sources"] = sources
            return data
    except Exception:
        log.exception("Gemini person intel extraction failed for: %s", name)

    # Fallback: return raw sources
    return {
        "name": name,
        "company": company,
        "summary": f"Found {len(all_results)} results about {name}.",
        "recent_activities": [
            {"activity": r.get("title", ""), "url": r.get("url", ""), "type": "news"}
            for r in all_results[:5]
        ],
        "talking_points": [],
        "interests": [],
        "sources": sources,
    }
