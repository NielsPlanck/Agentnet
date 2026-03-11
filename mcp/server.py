#!/usr/bin/env python3
"""
AgentNet MCP Server

Modes:
  python server.py            → stdio  (Claude Desktop, Cursor, Claude Code)
  python server.py --http     → HTTP   (OpenAI Apps SDK at http://localhost:8001/mcp)

Environment:
  AGENTNET_URL   Backend URL (default: http://localhost:8000)
  PORT           HTTP port   (default: 8001)
"""

import os
import sys
import httpx
from mcp.server.fastmcp import FastMCP

AGENTNET_BASE_URL = os.environ.get("AGENTNET_URL", "http://localhost:8000")
PORT = int(os.environ.get("PORT", "8001"))

mcp = FastMCP(
    "AgentNet",
    instructions=(
        "AgentNet is a search engine for AI agents and tools. "
        "Use search_agents to find which tool/agent can do a task. "
        "Use ask_agentnet for detailed answers with step-by-step guidance."
    ),
    host="0.0.0.0",
    port=PORT,
    stateless_http=True,
)


@mcp.tool()
async def search_agents(query: str, limit: int = 5) -> str:
    """
    Search AgentNet's index of 750+ AI agents, MCP servers, and tools by intent.
    Returns ranked results with similarity scores, descriptions, and URLs.

    Args:
        query: What you want to do (e.g. 'book a flight', 'send Slack message', 'scrape a website')
        limit: Max number of results to return (default: 5, max: 20)
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{AGENTNET_BASE_URL}/v1/search",
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
            f"{AGENTNET_BASE_URL}/v1/ask",
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
    """
    List all capability categories indexed in AgentNet
    (e.g. travel, finance, communication, dev tools).
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{AGENTNET_BASE_URL}/v1/capabilities")
        resp.raise_for_status()
        caps = resp.json()

    if not caps:
        return "No categories found."

    by_cat: dict[str, list[str]] = {}
    for c in caps:
        cat = c.get("category", "other")
        slug = c.get("slug", "")
        by_cat.setdefault(cat, []).append(slug)

    lines = [f"AgentNet has {len(caps)} capabilities across {len(by_cat)} categories:\n"]
    for cat, slugs in sorted(by_cat.items()):
        lines.append(f"**{cat.title()}**: {', '.join(slugs[:8])}")

    return "\n".join(lines)


if __name__ == "__main__":
    if "--http" in sys.argv:
        # HTTP mode for OpenAI Apps SDK — exposes /mcp at http://localhost:{PORT}/mcp
        print(f"AgentNet MCP running at http://0.0.0.0:{PORT}/mcp")
        mcp.run(transport="streamable-http")
    else:
        # stdio mode for Claude Desktop, Cursor, Claude Code
        mcp.run(transport="stdio")
