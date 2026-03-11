"""MCP Server Tool Discovery.

Probes an MCP endpoint to discover its real tools/actions list.
Uses the MCP JSON-RPC protocol (HTTP Streamable transport).

Most production MCP servers require OAuth — they return 401/403.
But they often include the tool list in SSE responses or allow
a partial initialize without auth on some endpoints.
"""

import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)

MCP_HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "User-Agent": "AgentNet-Crawler/1.0",
}

INITIALIZE_MSG = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "AgentNet", "version": "1.0"},
    },
}

TOOLS_LIST_MSG = {
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {},
}


def _parse_tools(data: Any) -> list[dict]:
    """Extract tools list from JSON-RPC response."""
    if not isinstance(data, dict):
        return []
    result = data.get("result", {})
    if isinstance(result, dict):
        return result.get("tools", [])
    return []


def _parse_sse_tools(text: str) -> list[dict]:
    """Parse tools from SSE stream text."""
    import json
    for line in text.splitlines():
        if line.startswith("data:"):
            payload = line[5:].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                data = json.loads(payload)
                tools = _parse_tools(data)
                if tools:
                    return tools
            except Exception:
                continue
    return []


async def probe_mcp_tools(mcp_url: str, timeout: float = 12.0) -> list[dict]:
    """
    Try to discover tools from an MCP server.
    Returns list of tool dicts: [{name, description, inputSchema}]
    Returns [] if server requires auth or doesn't respond.
    """
    # Normalize URL
    base = mcp_url.rstrip("/")

    async with httpx.AsyncClient(
        headers=MCP_HEADERS,
        follow_redirects=True,
        timeout=timeout,
    ) as client:

        # Strategy 1: POST tools/list directly (HTTP Streamable MCP)
        for url in [base, f"{base}/mcp"]:
            try:
                r = await client.post(url, json=TOOLS_LIST_MSG)
                if r.status_code == 200:
                    ct = r.headers.get("content-type", "")
                    if "text/event-stream" in ct:
                        tools = _parse_sse_tools(r.text)
                    else:
                        tools = _parse_tools(r.json())
                    if tools:
                        log.info("  [mcp_probe] %s → %d tools (direct)", url, len(tools))
                        return tools
            except Exception:
                pass

        # Strategy 2: POST initialize first, then tools/list
        for url in [base, f"{base}/mcp"]:
            try:
                # Initialize
                r = await client.post(url, json=INITIALIZE_MSG)
                session_id = r.headers.get("mcp-session-id") or r.headers.get("x-session-id")

                extra_headers = {}
                if session_id:
                    extra_headers["mcp-session-id"] = session_id

                # List tools
                r2 = await client.post(url, json=TOOLS_LIST_MSG, headers=extra_headers)
                if r2.status_code == 200:
                    ct = r2.headers.get("content-type", "")
                    if "text/event-stream" in ct:
                        tools = _parse_sse_tools(r2.text)
                    else:
                        try:
                            tools = _parse_tools(r2.json())
                        except Exception:
                            tools = []
                    if tools:
                        log.info("  [mcp_probe] %s → %d tools (init+list)", url, len(tools))
                        return tools
            except Exception:
                pass

        # Strategy 3: GET /sse (classic SSE transport)
        for url in [base, f"{base}/sse"]:
            try:
                r = await client.get(url, headers={"Accept": "text/event-stream"}, timeout=5)
                if r.status_code == 200 and "text/event-stream" in r.headers.get("content-type", ""):
                    tools = _parse_sse_tools(r.text)
                    if tools:
                        log.info("  [mcp_probe] %s → %d tools (SSE)", url, len(tools))
                        return tools
            except Exception:
                pass

    log.debug("  [mcp_probe] %s → no tools (auth required or unsupported)", base)
    return []


async def probe_smithery_tools(qualified_name: str) -> list[dict]:
    """Get tool list from Smithery registry for a known server."""
    url = f"https://registry.smithery.ai/servers/{qualified_name}"
    try:
        async with httpx.AsyncClient(
            headers={"User-Agent": "AgentNet-Crawler/1.0"},
            follow_redirects=True,
            timeout=10,
        ) as client:
            r = await client.get(url)
            if r.status_code == 200:
                data = r.json()
                tools = data.get("tools", [])
                if tools:
                    log.info("  [smithery] %s → %d tools", qualified_name, len(tools))
                return tools
    except Exception:
        pass
    return []
