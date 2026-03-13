"""URL detection and content fetching for chat messages."""

import asyncio
import logging
import re
from html.parser import HTMLParser

import httpx

from app.config import settings

log = logging.getLogger(__name__)

# Regex to detect URLs in user queries
URL_PATTERN = re.compile(r"https?://[^\s<>\"'\)\]]+", re.IGNORECASE)

# Max chars of fetched content to pass to LLM (~3k tokens)
MAX_CONTENT_CHARS = 12_000


def extract_urls(text: str) -> list[str]:
    """Extract all HTTP(S) URLs from a text string."""
    urls = URL_PATTERN.findall(text)
    cleaned: list[str] = []
    for url in urls:
        url = url.rstrip(".,;:!?)]}\"'")
        if url not in cleaned:
            cleaned.append(url)
    return cleaned


class _TextExtractor(HTMLParser):
    """Minimal HTML-to-text fallback parser."""

    def __init__(self):
        super().__init__()
        self._text: list[str] = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "nav", "header", "footer", "noscript"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav", "header", "footer", "noscript"):
            self._skip = False

    def handle_data(self, data):
        if not self._skip:
            text = data.strip()
            if text:
                self._text.append(text)

    def get_text(self) -> str:
        return "\n".join(self._text)


async def fetch_url_content(url: str) -> dict:
    """
    Fetch and extract readable content from a URL.
    Returns {"url": str, "title": str, "content": str, "error": str | None}
    """
    # Try Tavily Extract first (higher quality, handles JS)
    if settings.tavily_api_key:
        try:
            from tavily import AsyncTavilyClient

            tavily = AsyncTavilyClient(api_key=settings.tavily_api_key)
            result = await tavily.extract(urls=[url])
            results = result.get("results", [])
            if results and results[0].get("raw_content"):
                content = results[0]["raw_content"][:MAX_CONTENT_CHARS]
                return {
                    "url": url,
                    "title": results[0].get("url", url),
                    "content": content,
                    "error": None,
                }
            failed = result.get("failed_results", [])
            if failed:
                log.warning("Tavily extract failed for %s: %s", url, failed)
        except Exception:
            log.exception("Tavily extract error for %s", url)

    # Fallback: httpx + basic HTML-to-text
    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            headers={"User-Agent": "AgentNet-URLFetcher/0.1"},
            follow_redirects=True,
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")

            if "text/html" in content_type:
                parser = _TextExtractor()
                parser.feed(resp.text)
                text = parser.get_text()[:MAX_CONTENT_CHARS]
            elif "text/plain" in content_type or "application/json" in content_type:
                text = resp.text[:MAX_CONTENT_CHARS]
            else:
                return {
                    "url": url,
                    "title": url,
                    "content": "",
                    "error": f"Unsupported content type: {content_type}",
                }

            return {"url": url, "title": url, "content": text, "error": None}
    except Exception as e:
        log.exception("httpx fetch error for %s", url)
        return {"url": url, "title": url, "content": "", "error": str(e)}


async def fetch_urls_content(urls: list[str]) -> list[dict]:
    """Fetch content from multiple URLs concurrently (max 3)."""
    urls = urls[:3]
    tasks = [fetch_url_content(u) for u in urls]
    return await asyncio.gather(*tasks)
