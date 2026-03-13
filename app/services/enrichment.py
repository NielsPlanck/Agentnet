"""Real data enrichment for table rows.

Uses Hunter.io for email discovery (when API key configured),
Tavily web search + Gemini for everything else (LinkedIn, phone, revenue, etc.).
"""

import asyncio
import json
import logging
import re

import httpx
from google import genai

from app.config import settings

log = logging.getLogger(__name__)

# Max concurrent searches
_SEMAPHORE = asyncio.Semaphore(3)


# ── Hunter.io API ─────────────────────────────────────────────────

async def _hunter_domain_search(domain: str) -> list[dict]:
    """Search for all emails at a domain using Hunter.io Domain Search API.

    Returns list of dicts with keys: value (email), first_name, last_name,
    position, department, linkedin, phone_number, etc.
    """
    if not settings.hunter_api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://api.hunter.io/v2/domain-search",
                params={
                    "domain": domain,
                    "api_key": settings.hunter_api_key,
                    "limit": 10,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("data", {}).get("emails", [])
            log.warning("Hunter domain search %s → %d", domain, resp.status_code)
    except Exception:
        log.exception("Hunter domain search failed for: %s", domain)
    return []


async def _hunter_email_finder(
    domain: str, first_name: str = "", last_name: str = ""
) -> dict | None:
    """Find a specific person's email at a company using Hunter.io Email Finder.

    Returns dict with: email, score, position, linkedin, phone_number, etc.
    """
    if not settings.hunter_api_key:
        return None
    params: dict = {"domain": domain, "api_key": settings.hunter_api_key}
    if first_name:
        params["first_name"] = first_name
    if last_name:
        params["last_name"] = last_name
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://api.hunter.io/v2/email-finder",
                params=params,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("data")
            log.warning("Hunter email finder %s → %d", domain, resp.status_code)
    except Exception:
        log.exception("Hunter email finder failed for: %s", domain)
    return None


async def _hunter_company_search(company_name: str) -> list[dict]:
    """Search Hunter.io by company name to find emails.

    Returns list of email dicts.
    """
    if not settings.hunter_api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://api.hunter.io/v2/domain-search",
                params={
                    "company": company_name,
                    "api_key": settings.hunter_api_key,
                    "limit": 10,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("data", {}).get("emails", [])
            log.warning("Hunter company search %s → %d", company_name, resp.status_code)
    except Exception:
        log.exception("Hunter company search failed for: %s", company_name)
    return []


def _extract_hunter_value(emails: list[dict], col_lower: str) -> str | None:
    """Extract a value from Hunter.io email results for a given column name."""
    if not emails:
        return None

    # For email columns — return the highest-confidence email
    if "email" in col_lower:
        # Sort by confidence if available
        best = max(emails, key=lambda e: e.get("confidence", 0))
        return best.get("value")

    # For LinkedIn columns
    if "linkedin" in col_lower:
        for e in emails:
            li = e.get("linkedin")
            if li:
                if not li.startswith("http"):
                    li = f"https://linkedin.com/in/{li}"
                return li
        return None

    # For phone columns
    if "phone" in col_lower:
        for e in emails:
            phone = e.get("phone_number")
            if phone:
                return str(phone)
        return None

    # For position/title
    if "title" in col_lower or "position" in col_lower or "role" in col_lower:
        for e in emails:
            pos = e.get("position")
            if pos:
                return pos
        return None

    # For department
    if "department" in col_lower:
        for e in emails:
            dept = e.get("department")
            if dept:
                return dept
        return None

    # For name/person/contact
    if "name" in col_lower or "contact" in col_lower or "person" in col_lower:
        for e in emails:
            fn = e.get("first_name", "")
            ln = e.get("last_name", "")
            if fn or ln:
                return f"{fn} {ln}".strip()
        return None

    return None


# ── Tavily Web Search ─────────────────────────────────────────────

async def _tavily_search(query: str, max_results: int = 5) -> list[dict]:
    """Run a Tavily search and return results."""
    if not settings.tavily_api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
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
            data = resp.json()
            return data.get("results", [])
    except Exception:
        log.exception("Tavily search failed for: %s", query)
        return []


# ── Gemini Extraction ─────────────────────────────────────────────

async def _extract_with_gemini(
    entity: str,
    columns: list[str],
    search_results: list[dict],
) -> list[str | None]:
    """Use Gemini to extract structured values from search results."""
    if not search_results:
        return [None] * len(columns)

    # Build context from search results
    context_parts = []
    for r in search_results[:5]:
        title = r.get("title", "")
        content = r.get("content", "")[:800]
        url = r.get("url", "")
        context_parts.append(f"Source: {title}\nURL: {url}\n{content}")
    context = "\n\n---\n\n".join(context_parts)

    prompt = f"""Extract the following information about "{entity}" from these search results.

COLUMNS TO FIND: {json.dumps(columns)}

SEARCH RESULTS:
{context}

RULES:
- Return ONLY a JSON array with one value per column, in the same order
- Use ONLY information found in the search results above
- If a value is not found in the results, use null
- For emails: return the actual email address found, not a guess
- For LinkedIn: return the full LinkedIn profile URL (https://linkedin.com/in/...)
- For phone numbers: return the actual number found
- For websites/domains: return the actual URL found
- Do NOT make up or guess any values — only use what's in the search results
- NEVER invent email addresses — if not found, return null

Return ONLY the JSON array, nothing else. Example: ["value1", "value2", null]"""

    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        response = await client.aio.models.generate_content(
            model=settings.gemini_chat_model,
            contents=prompt,
        )
        text = response.text.strip()
        # Extract JSON array from response
        match = re.search(r"\[[\s\S]*?\]", text)
        if match:
            values = json.loads(match.group())
            # Ensure correct length
            while len(values) < len(columns):
                values.append(None)
            return values[: len(columns)]
    except Exception:
        log.exception("Gemini extraction failed for: %s", entity)

    return [None] * len(columns)


# ── Combined Enrichment ──────────────────────────────────────────

def _needs_hunter(columns: list[str]) -> bool:
    """Check if any requested column can benefit from Hunter.io."""
    hunter_cols = {"email", "linkedin", "phone", "contact", "name", "title", "position", "department"}
    for col in columns:
        col_lower = col.lower()
        if any(kw in col_lower for kw in hunter_cols):
            return True
    return False


def _guess_domain(entity: str, extra: str) -> str:
    """Try to extract or guess a domain from entity/extra info."""
    # Check if extra looks like a domain or URL
    domain_pattern = re.compile(r'(?:https?://)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})')
    for text in [extra, entity]:
        m = domain_pattern.search(text)
        if m:
            return m.group(1)
    return ""


async def _enrich_row_tavily(
    entity: str,
    extra_context: str,
    add_columns: list[str],
) -> list[str | None]:
    """Enrich a single row using Tavily search + Gemini extraction."""
    async with _SEMAPHORE:
        # Build targeted search queries per column type
        col_hints = " ".join(add_columns)
        query = f"{entity} {extra_context} {col_hints}"
        results = await _tavily_search(query, max_results=5)
        return await _extract_with_gemini(entity, add_columns, results)


async def _enrich_row(
    entity: str,
    extra: str,
    add_columns: list[str],
) -> list[str | None]:
    """Enrich a single row, using Hunter.io for email-related columns
    and Tavily+Gemini for everything else."""

    values = [None] * len(add_columns)

    # Separate columns into Hunter-compatible and others
    hunter_cols_idx: list[int] = []
    tavily_cols_idx: list[int] = []

    for i, col in enumerate(add_columns):
        col_lower = col.lower()
        if _needs_hunter([col]) and settings.hunter_api_key:
            hunter_cols_idx.append(i)
        else:
            tavily_cols_idx.append(i)

    # ── Hunter.io for email/linkedin/phone columns ──
    if hunter_cols_idx and settings.hunter_api_key:
        try:
            domain = _guess_domain(entity, extra)
            hunter_emails = []
            if domain:
                hunter_emails = await _hunter_domain_search(domain)
            if not hunter_emails:
                # Try company name search
                hunter_emails = await _hunter_company_search(entity)

            for idx in hunter_cols_idx:
                col_lower = add_columns[idx].lower()
                v = _extract_hunter_value(hunter_emails, col_lower)
                if v:
                    values[idx] = v
        except Exception:
            log.exception("Hunter enrichment failed for %s, falling back", entity)

    # ── Tavily+Gemini for remaining/unfilled columns ──
    unfilled_indices = []
    unfilled_cols = []
    for i in range(len(add_columns)):
        if values[i] is None:
            unfilled_indices.append(i)
            unfilled_cols.append(add_columns[i])

    if unfilled_cols:
        tavily_values = await _enrich_row_tavily(entity, extra, unfilled_cols)
        for j, idx in enumerate(unfilled_indices):
            if j < len(tavily_values) and tavily_values[j]:
                values[idx] = tavily_values[j]

    return values


async def enrich_table(
    columns: list[str],
    rows: list[list],
    add_columns: list[str],
) -> dict:
    """
    Enrich a table by adding new columns with real data.

    Pipeline:
    1. Hunter.io — for email, LinkedIn, phone columns (when API key is set)
    2. Tavily search + Gemini extraction — for all other columns (fallback)

    Args:
        columns: Current column names
        rows: Current row data
        add_columns: Column names to add (e.g., ["Email", "LinkedIn URL"])

    Returns:
        {"columns": [...], "rows": [[...]]}
    """
    # Use the first column as primary entity identifier
    # and second column (if exists) as extra context

    async def process_row(row: list) -> list:
        entity = str(row[0]) if row else ""
        extra = str(row[1]) if len(row) > 1 else ""
        values = await _enrich_row(entity, extra, add_columns)
        return [*row, *values]

    # Process rows concurrently (respects semaphore)
    tasks = [process_row(row) for row in rows]
    enriched_rows = await asyncio.gather(*tasks)

    return {
        "columns": [*columns, *add_columns],
        "rows": list(enriched_rows),
    }
