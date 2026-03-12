"""
AgentNet MCP endpoint — mounted at /mcp on the main FastAPI app.
Compatible with: Claude.ai connectors, Claude Desktop, Cursor, ChatGPT Apps SDK.
"""

import os
import httpx
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import BaseModel


class _ToolResult(BaseModel):
    display_name: str
    tool_name: str
    similarity: float
    description: str
    base_url: str
    transport: str


class _SearchResults(BaseModel):
    query: str
    results: list[_ToolResult]

# Internal base URL — loopback to same server
_BASE = os.environ.get("AGENTNET_INTERNAL_URL", "http://localhost:8000")

# ── Search results widget (rendered inside ChatGPT's iframe) ────────────────
_WIDGET_URI = "ui://widget/search-results.html"

_WIDGET_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:12px;background:#fff;color:#111}
h3{font-size:12px;color:#6b7280;font-weight:500;margin-bottom:10px}
.card{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin-bottom:8px}
.card:hover{background:#f9fafb}
.row{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.favicon{width:18px;height:18px;border-radius:3px;flex-shrink:0;object-fit:contain}
.favicon-hidden{display:none}
.name{font-weight:600;font-size:13px}
.pct{font-size:11px;color:#6b7280;background:#f3f4f6;border-radius:4px;padding:1px 5px;flex-shrink:0;margin-left:auto}
.type{font-size:10px;color:#7c3aed;text-transform:uppercase;font-weight:600;letter-spacing:.04em}
.desc{font-size:11px;color:#4b5563;line-height:1.4;margin-bottom:4px}
.url a{font-size:11px;color:#2563eb;text-decoration:none}
.url a:hover{text-decoration:underline}
.brand{display:flex;flex-direction:column;align-items:center;justify-content:center;height:90px;gap:8px}
.brand img{width:40px;height:40px;border-radius:8px;object-fit:contain}
.brand-name{font-size:15px;font-weight:700;background:linear-gradient(135deg,#6366f1,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.brand-sub{font-size:11px;color:#9ca3af}
</style></head>
<body>
<div id="root"><div class="brand"><img src="https://agentnet.codiris.app/iris-logo.png" alt="AgentNet"><div class="brand-name">AgentNet</div><div class="brand-sub">Search engine for AI agents</div></div></div>
<script>
var rendered=false;
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function render(data){
  rendered=true;
  var root=document.getElementById('root');
  var results=data&&data.results||[];
  var query=data&&data.query||'';
  if(!results.length){root.innerHTML='<p style="color:#9ca3af;font-size:13px;text-align:center;padding:20px">No tools found</p>';return}
  root.innerHTML='<h3>'+results.length+' tools for &ldquo;'+escHtml(query)+'&rdquo;</h3>'+
    results.map(function(r){
      var name=escHtml(r.display_name||r.tool_name||'Unknown');
      var pct=Math.round((r.similarity||0)*100);
      var type=r.transport?'<div class="type">'+escHtml(r.transport)+'</div>':'';
      var desc=r.description?'<div class="desc">'+escHtml(r.description.slice(0,160))+'</div>':'';
      var url=r.base_url?'<div class="url"><a href="'+escHtml(r.base_url)+'" target="_blank" rel="noopener">'+escHtml(r.base_url)+'</a></div>':'';
      var domain='';
      try{domain=r.base_url?new URL(r.base_url).hostname:'';}catch(e){}
      var favicon=domain?'<img class="favicon" src="https://www.google.com/s2/favicons?domain='+encodeURIComponent(domain)+'&sz=32" alt="" onerror="this.classList.add(\'favicon-hidden\')">':'';
      return '<div class="card"><div class="row">'+favicon+'<span class="name">'+name+'</span>'+(pct?'<span class="pct">'+pct+'%</span>':'')+'</div>'+type+desc+url+'</div>';
    }).join('');
}
window.addEventListener('message',function(e){
  var m=e.data;
  if(!m||typeof m!=='object')return;
  if(m.method==='ui/notifications/tool-result'){
    var p=m.params||{};
    var sc=p.structuredContent||p;
    if(sc&&sc.results)render(sc);
  }
},false);
</script></body></html>"""

# ── FastMCP server ──────────────────────────────────────────────────────────
mcp = FastMCP(
    "AgentNet",
    instructions=(
        "AgentNet is the search engine for AI agents and tools — Google for agents. "
        "Use search_agents to find which tool, MCP server, or API can perform a task. "
        "Use ask_agentnet for full answers with step-by-step guidance and tool recommendations. "
        "Use list_categories to browse all indexed capability categories."
    ),
    stateless_http=True,
    streamable_http_path="/",  # mounted at /mcp, so internal path must be /
    transport_security=TransportSecuritySettings(
        allowed_hosts=["backend.codiris.app", "agentnet.codiris.app", "localhost", "localhost:8000"],
        allowed_origins=[
            "https://agentnet.codiris.app",
            "https://claude.ai",
            "https://chatgpt.com",
            "http://localhost:3001",
        ],
    ),
)


# ── Widget resource ─────────────────────────────────────────────────────────
@mcp.resource(
    _WIDGET_URI,
    mime_type="text/html;profile=mcp-app",
    description="Search results widget rendered inside ChatGPT",
    meta={
        "ui": {
            "domain": "https://agentnet.codiris.app",
            "csp": {
                "connectDomains": ["https://backend.codiris.app"],
                "resourceDomains": ["https://agentnet.codiris.app", "https://www.google.com"],
            },
        }
    },
)
async def search_results_widget() -> str:
    return _WIDGET_HTML


# ── Tools ───────────────────────────────────────────────────────────────────
_READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)


@mcp.tool(
    annotations=_READ_ONLY,
    meta={"ui": {"resourceUri": _WIDGET_URI}},
    structured_output=True,
)
async def search_agents(query: str, limit: int = 5) -> _SearchResults:
    """
    Use this when you need to find an AI agent, MCP server, API, or tool that can perform a task.
    Searches AgentNet's index of 750+ tools by intent and returns ranked results with match scores.
    Do not use for general web search or questions unrelated to finding AI tools.

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

    return _SearchResults(
        query=query,
        results=[
            _ToolResult(
                display_name=r.get("display_name") or r.get("tool_name", "Unknown"),
                tool_name=r.get("tool_name", ""),
                similarity=r.get("similarity", 0.0),
                description=(r.get("description") or "")[:200],
                base_url=r.get("base_url", ""),
                transport=r.get("transport", ""),
            )
            for r in results
        ],
    )


@mcp.tool(annotations=_READ_ONLY)
async def ask_agentnet(query: str, history: list[dict] | None = None) -> str:
    """
    Use this when the user asks a full question about which AI agents or tools to use for a task,
    or wants step-by-step guidance on automating a workflow. Returns a detailed answer with
    recommendations. Do not use for simple keyword lookups — use search_agents for those.

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


@mcp.tool(annotations=_READ_ONLY)
async def list_categories() -> str:
    """
    Use this when the user wants to browse or explore what types of AI tools are available in
    AgentNet (e.g. 'what categories of agents exist?', 'show me travel tools').
    Returns all capability categories with example tool slugs.
    """
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
    mcp_asgi = mcp.streamable_http_app()

    async def normalized_mcp_app(scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            if path == "":
                scope = dict(scope)
                scope["path"] = "/"
                scope["raw_path"] = b"/"
        await mcp_asgi(scope, receive, send)

    return normalized_mcp_app
