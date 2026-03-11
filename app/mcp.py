"""
AgentNet MCP endpoint — mounted at /mcp on the main FastAPI app.
Accessible at https://agentnet.codiris.build/mcp
Compatible with: Claude.ai connectors, Claude Desktop, Cursor, OpenAI Apps SDK.
"""

import os
import httpx
from mcp.server.fastmcp import FastMCP

# Internal base URL — loopback to same server
_BASE = os.environ.get("AGENTNET_INTERNAL_URL", "http://localhost:8000")

mcp = FastMCP(
    "AgentNet",
    instructions=(
        "AgentNet is the search engine for AI agents and tools — Google for agents. "
        "Use search_agents to find which tool, MCP server, or API can perform a task. "
        "Use ask_agentnet for full answers with step-by-step guidance and tool recommendations."
    ),
    stateless_http=True,
)


@mcp.tool()
async def search_agents(query: str, limit: int = 5) -> str:
    """
    Search AgentNet's index of 750+ AI agents, MCP servers, and tools by intent.
    Returns ranked results with similarity scores, descriptions, and URLs.

    Args:
        query: What you want to do (e.g. 'book a flight', 'send Slack message', 'scrape a website')
        limit: Max results to return (default: 5, max: 20)
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{_BASE}/v1/search",
            json={"intent": query, "limit": min(limit, 20)},
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])

    if not results:
        return f'No tools found for: "{query}"'

    lines = [f'AgentNet found {len(results)} tools for: "{query}"\n']
    for i, r in enumerate(results, 1):
        name = r.get("display_name") or r.get("tool_name", "Unknown")
        pct = round(r.get("similarity", 0) * 100)
        desc = (r.get("description") or "")[:200]
        url = r.get("base_url", "")
        transport = r.get("transport", "")

        lines.append(f"{i}. **{name}** — {pct}% match")
        if transport:
            lines.append(f"   Type: {transport.upper()}")
        if desc:
            lines.append(f"   {desc}")
        if url:
            lines.append(f"   URL: {url}")
        lines.append("")

    return "\n".join(lines)


@mcp.tool()
async def ask_agentnet(query: str, history: list[dict] | None = None) -> str:
    """
    Ask AgentNet a full question and get a detailed answer with tool recommendations.
    AgentNet searches its index and returns step-by-step guidance on which agents/tools to use.

    Args:
        query: Your question or request
        history: Optional list of previous messages [{"role": "user"|"assistant", "content": "..."}]
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{_BASE}/v1/ask",
            json={"query": query, "history": history or []},
        )
        resp.raise_for_status()
        data = resp.json()

    answer = data.get("answer", "No answer returned.")
    sources = data.get("sources", [])

    text = answer
    if sources:
        text += "\n\n---\n**Tools considered:**\n"
        for s in sources[:5]:
            n = s.get("display_name") or s.get("tool_name", "")
            pct = round(s.get("similarity", 0) * 100)
            url = s.get("base_url", "")
            text += f"- {n} ({pct}%)"
            if url:
                text += f" — {url}"
            text += "\n"

    return text


@mcp.tool()
async def list_categories() -> str:
    """List all capability categories indexed in AgentNet (e.g. travel, finance, dev tools)."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{_BASE}/v1/capabilities")
        resp.raise_for_status()
        caps = resp.json()

    if not caps:
        return "No categories found."

    by_cat: dict[str, list[str]] = {}
    for c in caps:
        cat = c.get("category", "other")
        by_cat.setdefault(cat, []).append(c.get("slug", ""))

    lines = [f"AgentNet has {len(caps)} capabilities across {len(by_cat)} categories:\n"]
    for cat, slugs in sorted(by_cat.items()):
        lines.append(f"**{cat.title()}**: {', '.join(slugs[:8])}")

    return "\n".join(lines)


def get_mcp_app():
    """Return the ASGI app to mount at /mcp."""
    return mcp.streamable_http_app()
