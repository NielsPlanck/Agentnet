"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { Download, LogOut, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, List, LayoutGrid, Table2, Globe, Search, Loader2, Trash2, Plus, RefreshCw, Globe2, Wrench, Layers, Link } from "lucide-react";
import { API_BASE } from "@/lib/config";

const API = `${API_BASE}/api/v1/admin`;

type ViewMode = "list" | "table" | "card";

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const views: { key: ViewMode; icon: typeof List; label: string }[] = [
    { key: "list", icon: List, label: "List" },
    { key: "table", icon: Table2, label: "Table" },
    { key: "card", icon: LayoutGrid, label: "Cards" },
  ];
  return (
    <div className="flex items-center gap-0.5 bg-neutral-100 rounded-lg p-0.5">
      {views.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            mode === key
              ? "bg-white text-neutral-900 shadow-sm"
              : "text-neutral-500 hover:text-neutral-700"
          }`}
        >
          <Icon className="h-3 w-3" />
          {label}
        </button>
      ))}
    </div>
  );
}

function api(path: string, token: string) {
  return fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
}

function downloadUrl(path: string, token: string) {
  return `${API}${path}${path.includes("?") ? "&" : "?"}token=${token}`;
}

// ── Login ──────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pw }),
      });
      if (!res.ok) {
        setError("Invalid email or password");
        return;
      }
      const data = await res.json();
      localStorage.setItem("admin_token", data.token);
      onLogin(data.token);
    } catch {
      setError("Connection error");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm p-8">
        <h1 className="text-lg font-semibold text-neutral-900 mb-1">AgentNet Admin</h1>
        <p className="text-sm text-neutral-500 mb-6">Sign in to access the dashboard</p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoFocus
          className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400 mb-3"
        />
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400 mb-3"
        />
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <button
          type="submit"
          className="w-full py-2.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors"
        >
          Log in
        </button>
      </form>
    </div>
  );
}

// ── Stats cards ────────────────────────────────────────────────

interface Stats {
  conversations: number;
  messages: number;
  feedback_total: number;
  feedback_positive: number;
  feedback_negative: number;
  suggestions: number;
}

function StatsBar({ stats }: { stats: Stats }) {
  const items = [
    { label: "Conversations", value: stats.conversations },
    { label: "Messages", value: stats.messages },
    { label: "Positive", value: stats.feedback_positive },
    { label: "Negative", value: stats.feedback_negative },
    { label: "Suggestions", value: stats.suggestions },
  ];

  return (
    <div className="grid grid-cols-5 gap-4 mb-8">
      {items.map((item) => (
        <div key={item.label} className="bg-white border border-neutral-200 rounded-xl p-4">
          <div className="text-2xl font-semibold text-neutral-900 tabular-nums">{item.value}</div>
          <div className="text-xs text-neutral-500 mt-1">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Conversation row ───────────────────────────────────────────

interface ConvMessage {
  seq: number;
  role: string;
  content: string;
  tools_shown: { tools: string[] } | null;
  tool_selected: string | null;
  created_at: string | null;
}

interface ConvItem {
  id: string;
  started_at: string | null;
  message_count: number;
  preview: string;
  feedback: { vote: string; content: string }[];
  messages: ConvMessage[];
}

function ConversationRow({ conv }: { conv: ConvItem }) {
  const [open, setOpen] = useState(false);
  const hasUp = conv.feedback.some((f) => f.vote === "up");
  const hasDown = conv.feedback.some((f) => f.vote === "down");

  return (
    <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
        )}
        <div className="flex-1 min-w-0">
          <span className="text-sm text-neutral-900 line-clamp-1">{conv.preview || "Empty conversation"}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {hasUp && <ThumbsUp className="h-3.5 w-3.5 text-green-500" />}
          {hasDown && <ThumbsDown className="h-3.5 w-3.5 text-red-400" />}
          <span className="text-xs text-neutral-400 tabular-nums">{conv.message_count} msgs</span>
          <span className="text-xs text-neutral-400">
            {conv.started_at ? new Date(conv.started_at).toLocaleDateString() : ""}
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t border-neutral-100 px-4 py-3 space-y-3 bg-neutral-50/50">
          <div className="text-[0.65rem] text-neutral-400 font-mono">{conv.id}</div>
          {conv.messages.map((m) => (
            <div key={m.seq} className={`flex gap-3 ${m.role === "user" ? "" : ""}`}>
              <span className={`text-[0.65rem] font-semibold uppercase tracking-wider pt-0.5 w-16 shrink-0 ${
                m.role === "user" ? "text-blue-500" : "text-neutral-400"
              }`}>
                {m.role}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-neutral-800 whitespace-pre-wrap break-words">{m.content}</p>
                {m.tools_shown && m.tools_shown.tools?.length > 0 && (
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    {m.tools_shown.tools.map((t) => (
                      <span key={t} className="text-[0.6rem] px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-600">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {m.tool_selected && (
                  <span className="text-[0.6rem] mt-1 inline-block px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">
                    Selected: {m.tool_selected}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Conversation card view ─────────────────────────────────────

function ConversationCard({ conv }: { conv: ConvItem }) {
  const [open, setOpen] = useState(false);
  const hasUp = conv.feedback.some((f) => f.vote === "up");
  const hasDown = conv.feedback.some((f) => f.vote === "down");

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4 hover:border-neutral-300 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm text-neutral-900 font-medium line-clamp-2 flex-1">{conv.preview || "Empty conversation"}</p>
        <div className="flex items-center gap-1.5 ml-3 shrink-0">
          {hasUp && <ThumbsUp className="h-3 w-3 text-green-500" />}
          {hasDown && <ThumbsDown className="h-3 w-3 text-red-400" />}
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-neutral-400">
        <span>{conv.message_count} messages</span>
        <span>{conv.started_at ? new Date(conv.started_at).toLocaleDateString() : ""}</span>
      </div>
      <button
        onClick={() => setOpen(!open)}
        className="mt-2 text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
      >
        {open ? "Hide messages" : "Show messages"}
      </button>
      {open && (
        <div className="mt-3 border-t border-neutral-100 pt-3 space-y-2">
          <div className="text-[0.6rem] text-neutral-400 font-mono">{conv.id}</div>
          {conv.messages.map((m) => (
            <div key={m.seq} className="flex gap-2">
              <span className={`text-[0.6rem] font-semibold uppercase w-12 shrink-0 pt-0.5 ${
                m.role === "user" ? "text-blue-500" : "text-neutral-400"
              }`}>{m.role}</span>
              <p className="text-xs text-neutral-700 whitespace-pre-wrap break-words flex-1">{m.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Conversation table view ───────────────────────────────────

function ConversationsTable({ items }: { items: ConvItem[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!items.length) return <p className="text-sm text-neutral-500">No conversations yet.</p>;

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500 border-b border-neutral-200 bg-neutral-50">
            <th className="px-4 py-2.5 font-medium">Preview</th>
            <th className="px-4 py-2.5 font-medium w-20">Messages</th>
            <th className="px-4 py-2.5 font-medium w-24">Feedback</th>
            <th className="px-4 py-2.5 font-medium w-28">Date</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <Fragment key={c.id}>
              <tr
                onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                className="border-b border-neutral-100 hover:bg-neutral-50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-2.5 text-neutral-900 truncate max-w-[400px]">{c.preview || "Empty"}</td>
                <td className="px-4 py-2.5 text-neutral-500 tabular-nums">{c.message_count}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {c.feedback.some((f) => f.vote === "up") && <ThumbsUp className="h-3 w-3 text-green-500" />}
                    {c.feedback.some((f) => f.vote === "down") && <ThumbsDown className="h-3 w-3 text-red-400" />}
                    {c.feedback.length === 0 && <span className="text-xs text-neutral-300">--</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs text-neutral-400">
                  {c.started_at ? new Date(c.started_at).toLocaleDateString() : ""}
                </td>
              </tr>
              {expandedId === c.id && (
                <tr>
                  <td colSpan={4} className="px-4 py-3 bg-neutral-50/50">
                    <div className="space-y-2">
                      <div className="text-[0.6rem] text-neutral-400 font-mono">{c.id}</div>
                      {c.messages.map((m) => (
                        <div key={m.seq} className="flex gap-3">
                          <span className={`text-[0.6rem] font-semibold uppercase w-14 shrink-0 pt-0.5 ${
                            m.role === "user" ? "text-blue-500" : "text-neutral-400"
                          }`}>{m.role}</span>
                          <p className="text-xs text-neutral-700 whitespace-pre-wrap break-words flex-1">{m.content}</p>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Suggestions table ──────────────────────────────────────────

interface SuggestionItem {
  id: string;
  name: string;
  url: string;
  reason: string;
  created_at: string | null;
}

function SuggestionsTable({ items }: { items: SuggestionItem[] }) {
  if (!items.length) return <p className="text-sm text-neutral-500">No suggestions yet.</p>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-neutral-500 border-b border-neutral-200">
          <th className="pb-2 font-medium">Tool</th>
          <th className="pb-2 font-medium">URL</th>
          <th className="pb-2 font-medium">Reason</th>
          <th className="pb-2 font-medium">Date</th>
        </tr>
      </thead>
      <tbody>
        {items.map((s) => (
          <tr key={s.id} className="border-b border-neutral-100">
            <td className="py-2 font-medium text-neutral-900">{s.name}</td>
            <td className="py-2 text-neutral-500 truncate max-w-[200px]">{s.url || "--"}</td>
            <td className="py-2 text-neutral-600">{s.reason || "--"}</td>
            <td className="py-2 text-neutral-400 text-xs">
              {s.created_at ? new Date(s.created_at).toLocaleDateString() : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Suggestion card view ───────────────────────────────────────

function SuggestionsCards({ items }: { items: SuggestionItem[] }) {
  if (!items.length) return <p className="text-sm text-neutral-500">No suggestions yet.</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((s) => (
        <div key={s.id} className="bg-white border border-neutral-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-neutral-900 mb-1">{s.name}</div>
          {s.url && (
            <div className="text-xs text-blue-500 truncate mb-2">{s.url}</div>
          )}
          {s.reason && (
            <p className="text-xs text-neutral-600 line-clamp-3">{s.reason}</p>
          )}
          <div className="text-[0.65rem] text-neutral-400 mt-2">
            {s.created_at ? new Date(s.created_at).toLocaleDateString() : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── WebMCP Scanner ────────────────────────────────────────────

interface WebMCPTool {
  id: string;
  name: string;
  provider: string;
  page_url: string | null;
  status: string;
  tags: string[];
  actions: { id: string; name: string; description: string; input_schema: Record<string, unknown> | null }[];
  created_at: string | null;
}

interface ScanResult {
  status: string;
  url: string;
  provider?: string;
  tools_count?: number;
  tools?: { name: string; description: string }[];
  tool_id?: string;
}

function WebMCPPanel({ token }: { token: string }) {
  const [scanUrl, setScanUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [webmcpTools, setWebmcpTools] = useState<WebMCPTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/webmcp/tools`);
      if (res.ok) setWebmcpTools(await res.json());
    } catch { /* ignore */ }
    setLoadingTools(false);
  }, []);

  useEffect(() => { loadTools(); }, [loadTools]);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanUrl.trim() || scanning) return;

    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/webmcp/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scanUrl }),
      });
      const data = await res.json();
      setScanResult(data);
      if (data.status === "found") loadTools();
    } catch {
      setScanResult({ status: "error", url: scanUrl });
    }
    setScanning(false);
  };

  return (
    <div>
      {/* Scanner */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 mb-6">
        <h3 className="text-sm font-semibold text-neutral-900 mb-1">Scan Website for WebMCP Tools</h3>
        <p className="text-xs text-neutral-500 mb-4">
          Enter a URL to detect if the website exposes client-side tools via the WebMCP API (navigator.modelContext).
        </p>
        <form onSubmit={handleScan} className="flex gap-2">
          <input
            type="url"
            value={scanUrl}
            onChange={(e) => setScanUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 px-4 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
          />
          <button
            type="submit"
            disabled={scanning || !scanUrl.trim()}
            className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40 flex items-center gap-2"
          >
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Scan
          </button>
        </form>

        {scanResult && (
          <div className={`mt-4 p-3 rounded-lg text-sm ${
            scanResult.status === "found"
              ? "bg-green-50 border border-green-200 text-green-800"
              : scanResult.status === "error"
              ? "bg-red-50 border border-red-200 text-red-800"
              : "bg-neutral-50 border border-neutral-200 text-neutral-600"
          }`}>
            {scanResult.status === "found" ? (
              <div>
                <p className="font-medium">WebMCP tools detected on {scanResult.provider}</p>
                <p className="text-xs mt-1">{scanResult.tools_count} tool(s) found and indexed.</p>
                {scanResult.tools && scanResult.tools.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {scanResult.tools.map((t, i) => (
                      <li key={i} className="text-xs">
                        <span className="font-mono font-medium">{t.name}</span>
                        {t.description && <span className="text-green-600/70"> — {t.description}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : scanResult.status === "no_webmcp" ? (
              <p>No WebMCP signals found on this page. The website may not use navigator.modelContext yet.</p>
            ) : (
              <p>Failed to scan the URL. Check that it is accessible.</p>
            )}
          </div>
        )}
      </div>

      {/* Indexed WebMCP Tools */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-neutral-900">
          Indexed WebMCP Tools ({webmcpTools.length})
        </h2>
      </div>

      {loadingTools ? (
        <p className="text-sm text-neutral-500">Loading...</p>
      ) : webmcpTools.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-8 text-center">
          <Globe className="h-8 w-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-500 mb-1">No WebMCP tools indexed yet</p>
          <p className="text-xs text-neutral-400">Scan a website above or wait for the crawler to discover WebMCP-enabled sites.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {webmcpTools.map((tool) => (
            <div key={tool.id} className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedId(expandedId === tool.id ? null : tool.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 transition-colors"
              >
                {expandedId === tool.id ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
                )}
                <Globe className="h-4 w-4 shrink-0 text-purple-500" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-neutral-900">{tool.name}</span>
                  <span className="text-xs text-neutral-400 ml-2">{tool.provider}</span>
                </div>
                <span className="text-[0.65rem] font-medium text-purple-500 border border-purple-500/30 rounded px-1.5 py-0.5">
                  WebMCP
                </span>
                <span className="text-xs text-neutral-400 tabular-nums">{tool.actions.length} tools</span>
                <span className="text-xs text-neutral-400">
                  {tool.created_at ? new Date(tool.created_at).toLocaleDateString() : ""}
                </span>
              </button>

              {expandedId === tool.id && (
                <div className="border-t border-neutral-100 px-4 py-3 bg-neutral-50/50 space-y-2">
                  {tool.page_url && (
                    <div className="text-xs text-neutral-500">
                      Page: <span className="text-blue-500">{tool.page_url}</span>
                    </div>
                  )}
                  {tool.tags.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {tool.tags.map((tag) => (
                        <span key={tag} className="text-[0.6rem] px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-600">{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 space-y-1.5">
                    <div className="text-xs font-medium text-neutral-700">Registered Tools:</div>
                    {tool.actions.map((a) => (
                      <div key={a.id} className="flex gap-3 text-xs">
                        <span className="font-mono text-purple-600 w-40 shrink-0 truncate">{a.name}</span>
                        <span className="text-neutral-600 flex-1">{a.description || "No description"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tools Panel ───────────────────────────────────────────────

interface ToolAction {
  id: string;
  name: string;
  description: string;
  operation_type: string;
}

interface ToolItem {
  id: string;
  name: string;
  provider: string;
  transport: string;
  base_url: string | null;
  page_url: string | null;
  auth_type: string | null;
  status: string;
  tags: string[];
  priority: number;
  actions_count: number;
  actions: ToolAction[];
  created_at: string | null;
}

const TRANSPORT_BADGE: Record<string, string> = {
  mcp: "bg-blue-100 text-blue-700 border border-blue-200",
  rest: "bg-green-100 text-green-700 border border-green-200",
  webmcp: "bg-purple-100 text-purple-700 border border-purple-200",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-700 border border-green-200",
  no_mcp: "bg-yellow-100 text-yellow-700 border border-yellow-200",
};

const defaultToolForm = {
  name: "",
  provider: "",
  base_url: "",
  page_url: "",
  transport: "mcp",
  auth_type: "none",
  status: "active",
  tags: "",
  priority: 5,
};

function ToolsPanel({ token }: { token: string }) {
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddTool, setShowAddTool] = useState(false);
  const [addToolForm, setAddToolForm] = useState(defaultToolForm);
  const [addingTool, setAddingTool] = useState(false);
  const [addActionToolId, setAddActionToolId] = useState<string | null>(null);
  const [addActionForm, setAddActionForm] = useState({ name: "", description: "", operation_type: "read" });
  const [addingAction, setAddingAction] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<"all" | "seeded" | "apify" | "community">("all");

  const loadTools = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/tools`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setTools(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => { loadTools(); }, [loadTools]);

  const filtered = tools.filter((t) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || t.name.toLowerCase().includes(q) || t.provider.toLowerCase().includes(q) || (t.tags || []).some((tag: string) => tag.includes(q));
    const matchesSource =
      sourceFilter === "all" ? true :
      sourceFilter === "apify" ? t.name.startsWith("apify/") :
      sourceFilter === "community" ? t.transport === "mcp" && !t.name.startsWith("apify/") && !t.provider.startsWith("Apify") :
      sourceFilter === "seeded" ? t.transport !== "mcp" || t.provider.startsWith("Apify") === false && !t.name.includes("/") :
      true;
    return matchesSearch && matchesSource;
  });

  const totalTools = tools.length;
  const activeTools = tools.filter((t) => t.status === "active").length;
  const noMcpTools = tools.filter((t) => t.status === "no_mcp").length;
  const communityMcpTools = tools.filter((t) => t.transport === "mcp" && !t.name.startsWith("apify/")).length;

  const handlePriorityBlur = async (toolId: string, priority: number) => {
    try {
      await fetch(`${API}/tools/${toolId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ priority }),
      });
    } catch { /* ignore */ }
  };

  const handleDeleteTool = async (toolId: string, toolName: string) => {
    if (!confirm(`Delete tool "${toolName}"? This cannot be undone.`)) return;
    try {
      await fetch(`${API}/tools/${toolId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setTools((prev) => prev.filter((t) => t.id !== toolId));
      if (expandedId === toolId) setExpandedId(null);
    } catch { /* ignore */ }
  };

  const handleDeleteAction = async (toolId: string, actionId: string) => {
    if (!confirm("Delete this action?")) return;
    try {
      await fetch(`${API}/tools/${toolId}/actions/${actionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setTools((prev) =>
        prev.map((t) =>
          t.id === toolId
            ? { ...t, actions: t.actions.filter((a) => a.id !== actionId), actions_count: t.actions_count - 1 }
            : t
        )
      );
    } catch { /* ignore */ }
  };

  const handleAddTool = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingTool(true);
    try {
      const body = {
        ...addToolForm,
        tags: addToolForm.tags.split(",").map((s) => s.trim()).filter(Boolean),
        priority: Number(addToolForm.priority),
        page_url: addToolForm.page_url || null,
        base_url: addToolForm.base_url || null,
      };
      const res = await fetch(`${API}/tools`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setAddToolForm(defaultToolForm);
        setShowAddTool(false);
        await loadTools();
      }
    } catch { /* ignore */ }
    setAddingTool(false);
  };

  const handleAddAction = async (toolId: string, e: React.FormEvent) => {
    e.preventDefault();
    setAddingAction(true);
    try {
      const res = await fetch(`${API}/tools/${toolId}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(addActionForm),
      });
      if (res.ok) {
        const newAction = await res.json();
        setTools((prev) =>
          prev.map((t) =>
            t.id === toolId
              ? { ...t, actions: [...t.actions, newAction], actions_count: t.actions_count + 1 }
              : t
          )
        );
        setAddActionForm({ name: "", description: "", operation_type: "read" });
        setAddActionToolId(null);
      }
    } catch { /* ignore */ }
    setAddingAction(false);
  };

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Tools", value: totalTools },
          { label: "Active", value: activeTools },
          { label: "Community MCP", value: communityMcpTools },
          { label: "No MCP", value: noMcpTools },
        ].map((item) => (
          <div key={item.label} className="bg-white border border-neutral-200 rounded-xl p-4">
            <div className="text-2xl font-semibold text-neutral-900 tabular-nums">{item.value}</div>
            <div className="text-xs text-neutral-500 mt-1">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, provider, tag…"
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "community", "apify", "seeded"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setSourceFilter(f)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                sourceFilter === f
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-500 hover:text-neutral-700 border border-neutral-200 bg-white"
              }`}
            >
              {f === "all" ? "All" : f === "community" ? "Community MCP" : f === "apify" ? "Apify" : "Seeded"}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAddTool((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Tool
        </button>
      </div>

      {/* Add Tool Form */}
      {showAddTool && (
        <div className="bg-white border border-neutral-200 rounded-xl p-5 mb-4">
          <h3 className="text-sm font-semibold text-neutral-900 mb-4">New Tool</h3>
          <form onSubmit={handleAddTool} className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Name *</label>
              <input
                required
                value={addToolForm.name}
                onChange={(e) => setAddToolForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Provider *</label>
              <input
                required
                value={addToolForm.provider}
                onChange={(e) => setAddToolForm((f) => ({ ...f, provider: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Base URL</label>
              <input
                type="url"
                value={addToolForm.base_url}
                onChange={(e) => setAddToolForm((f) => ({ ...f, base_url: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Page URL (optional)</label>
              <input
                type="url"
                value={addToolForm.page_url}
                onChange={(e) => setAddToolForm((f) => ({ ...f, page_url: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Transport</label>
              <select
                value={addToolForm.transport}
                onChange={(e) => setAddToolForm((f) => ({ ...f, transport: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400 bg-white"
              >
                <option value="mcp">MCP</option>
                <option value="rest">REST</option>
                <option value="webmcp">WebMCP</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Auth Type</label>
              <select
                value={addToolForm.auth_type}
                onChange={(e) => setAddToolForm((f) => ({ ...f, auth_type: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400 bg-white"
              >
                <option value="none">None</option>
                <option value="bearer">Bearer</option>
                <option value="api_key">API Key</option>
                <option value="oauth">OAuth</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Status</label>
              <select
                value={addToolForm.status}
                onChange={(e) => setAddToolForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400 bg-white"
              >
                <option value="active">Active</option>
                <option value="no_mcp">No MCP</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Priority (0–10)</label>
              <input
                type="number"
                min="0"
                max="10"
                value={addToolForm.priority}
                onChange={(e) => setAddToolForm((f) => ({ ...f, priority: Number(e.target.value) }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-neutral-500 mb-1 block">Tags (comma-separated)</label>
              <input
                value={addToolForm.tags}
                onChange={(e) => setAddToolForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="e.g. search, ai, productivity"
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div className="col-span-2 flex gap-2 pt-1">
              <button
                type="submit"
                disabled={addingTool}
                className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                {addingTool && <Loader2 className="h-3 w-3 animate-spin" />}
                Create Tool
              </button>
              <button
                type="button"
                onClick={() => { setShowAddTool(false); setAddToolForm(defaultToolForm); }}
                className="px-4 py-2 rounded-lg border border-neutral-200 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tools List */}
      {loading ? (
        <p className="text-sm text-neutral-500">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-8 text-center">
          <Wrench className="h-8 w-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">{search ? "No tools match your search." : "No tools yet."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((tool) => {
            const isExpanded = expandedId === tool.id;
            const transportCls = TRANSPORT_BADGE[tool.transport] ?? "bg-neutral-100 text-neutral-600 border border-neutral-200";
            const statusCls = STATUS_BADGE[tool.status] ?? "bg-neutral-100 text-neutral-600 border border-neutral-200";

            return (
              <div key={tool.id} className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : tool.id)}
                    className="shrink-0 text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>

                  {/* Name + provider */}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-neutral-900">{tool.provider || tool.name}</span>
                    <span className="text-xs text-neutral-400 ml-2 font-mono">{tool.name}</span>
                  </div>

                  {/* Transport badge */}
                  <span className={`text-[0.65rem] font-medium px-1.5 py-0.5 rounded ${transportCls}`}>
                    {tool.transport.toUpperCase()}
                  </span>

                  {/* Status badge */}
                  <span className={`text-[0.65rem] font-medium px-1.5 py-0.5 rounded ${statusCls}`}>
                    {tool.status === "no_mcp" ? "no_mcp" : tool.status}
                  </span>

                  {/* Priority input */}
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[0.65rem] text-neutral-400">priority</span>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      defaultValue={tool.priority}
                      onBlur={(e) => handlePriorityBlur(tool.id, Number(e.target.value))}
                      className="w-12 px-1.5 py-0.5 rounded border border-neutral-200 text-xs text-center outline-none focus:border-neutral-400"
                    />
                  </div>

                  {/* Actions count */}
                  <span className="text-xs text-neutral-400 tabular-nums shrink-0">{tool.actions_count} actions</span>

                  {/* Delete */}
                  <button
                    onClick={() => handleDeleteTool(tool.id, tool.name)}
                    className="shrink-0 p-1 rounded text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Delete tool"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-neutral-100 px-4 py-3 bg-neutral-50/50 space-y-3">
                    {/* Meta */}
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-500">
                      {tool.base_url && <span>Base: <span className="text-blue-500">{tool.base_url}</span></span>}
                      {tool.page_url && <span>Page: <span className="text-blue-500">{tool.page_url}</span></span>}
                      {tool.auth_type && <span>Auth: {tool.auth_type}</span>}
                      {tool.created_at && <span>Created: {new Date(tool.created_at).toLocaleDateString()}</span>}
                    </div>

                    {/* Tags */}
                    {tool.tags.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap">
                        {tool.tags.map((tag) => (
                          <span key={tag} className="text-[0.6rem] px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-600">{tag}</span>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div>
                      <div className="text-xs font-medium text-neutral-700 mb-2">Actions ({tool.actions.length})</div>
                      {tool.actions.length === 0 ? (
                        <p className="text-xs text-neutral-400">No actions yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {tool.actions.map((a) => (
                            <div key={a.id} className="flex items-start gap-3 text-xs group">
                              <span className="font-mono text-blue-600 w-40 shrink-0 truncate pt-0.5">{a.name}</span>
                              <span className="text-neutral-500 text-[0.65rem] shrink-0 pt-0.5 uppercase tracking-wide">{a.operation_type}</span>
                              <span className="text-neutral-600 flex-1">{a.description || "No description"}</span>
                              <button
                                onClick={() => handleDeleteAction(tool.id, a.id)}
                                className="shrink-0 p-0.5 rounded text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                                title="Delete action"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Add action */}
                    {addActionToolId === tool.id ? (
                      <form onSubmit={(e) => handleAddAction(tool.id, e)} className="flex gap-2 items-end pt-1">
                        <div>
                          <label className="text-[0.65rem] text-neutral-400 mb-0.5 block">Name</label>
                          <input
                            required
                            value={addActionForm.name}
                            onChange={(e) => setAddActionForm((f) => ({ ...f, name: e.target.value }))}
                            className="px-2.5 py-1.5 rounded-lg border border-neutral-200 text-xs outline-none focus:border-neutral-400"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[0.65rem] text-neutral-400 mb-0.5 block">Description</label>
                          <input
                            value={addActionForm.description}
                            onChange={(e) => setAddActionForm((f) => ({ ...f, description: e.target.value }))}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 text-xs outline-none focus:border-neutral-400"
                          />
                        </div>
                        <div>
                          <label className="text-[0.65rem] text-neutral-400 mb-0.5 block">Type</label>
                          <select
                            value={addActionForm.operation_type}
                            onChange={(e) => setAddActionForm((f) => ({ ...f, operation_type: e.target.value }))}
                            className="px-2.5 py-1.5 rounded-lg border border-neutral-200 text-xs outline-none focus:border-neutral-400 bg-white"
                          >
                            <option value="read">read</option>
                            <option value="write">write</option>
                            <option value="execute">execute</option>
                          </select>
                        </div>
                        <button
                          type="submit"
                          disabled={addingAction}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40 flex items-center gap-1"
                        >
                          {addingAction && <Loader2 className="h-3 w-3 animate-spin" />}
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddActionToolId(null); setAddActionForm({ name: "", description: "", operation_type: "read" }); }}
                          className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <button
                        onClick={() => setAddActionToolId(tool.id)}
                        className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        Add action
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sites Panel ───────────────────────────────────────────────

interface SiteItem {
  id: string;
  domain: string;
  submitted_url: string;
  contact_email: string | null;
  verified: boolean;
  crawl_status: "pending" | "crawling" | "done" | "failed";
  crawl_error: string | null;
  last_crawled_at: string | null;
  next_crawl_at: string | null;
  discovered_actions_count: number;
  verification_token: string | null;
  created_at: string | null;
}

const CRAWL_STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700 border border-yellow-200",
  crawling: "bg-blue-100 text-blue-700 border border-blue-200",
  done: "bg-green-100 text-green-700 border border-green-200",
  failed: "bg-red-100 text-red-700 border border-red-200",
};

function SitesPanel({ token }: { token: string }) {
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [registerUrl, setRegisterUrl] = useState("");
  const [registering, setRegistering] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recrawlingId, setRecrawlingId] = useState<string | null>(null);

  const loadSites = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/sites`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSites(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => { loadSites(); }, [loadSites]);

  const totalSites = sites.length;
  const doneSites = sites.filter((s) => s.crawl_status === "done").length;
  const pendingSites = sites.filter((s) => s.crawl_status === "pending").length;
  const failedSites = sites.filter((s) => s.crawl_status === "failed").length;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerUrl.trim() || registering) return;
    setRegistering(true);
    try {
      const res = await fetch(`${API}/sites/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url: registerUrl }),
      });
      if (res.ok) {
        setRegisterUrl("");
        await loadSites();
      }
    } catch { /* ignore */ }
    setRegistering(false);
  };

  const handleRecrawl = async (siteId: string) => {
    setRecrawlingId(siteId);
    try {
      await fetch(`${API}/sites/${siteId}/recrawl`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await loadSites();
    } catch { /* ignore */ }
    setRecrawlingId(null);
  };

  const handleDeleteSite = async (siteId: string, domain: string) => {
    if (!confirm(`Delete site "${domain}"? This cannot be undone.`)) return;
    try {
      await fetch(`${API}/sites/${siteId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setSites((prev) => prev.filter((s) => s.id !== siteId));
      if (expandedId === siteId) setExpandedId(null);
    } catch { /* ignore */ }
  };

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Sites", value: totalSites },
          { label: "Done", value: doneSites },
          { label: "Pending", value: pendingSites },
          { label: "Failed", value: failedSites },
        ].map((item) => (
          <div key={item.label} className="bg-white border border-neutral-200 rounded-xl p-4">
            <div className="text-2xl font-semibold text-neutral-900 tabular-nums">{item.value}</div>
            <div className="text-xs text-neutral-500 mt-1">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Register */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 mb-6">
        <h3 className="text-sm font-semibold text-neutral-900 mb-1">Register Site</h3>
        <p className="text-xs text-neutral-500 mb-4">Submit a URL to crawl for actions and capabilities.</p>
        <form onSubmit={handleRegister} className="flex gap-2">
          <input
            type="url"
            value={registerUrl}
            onChange={(e) => setRegisterUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 px-4 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
          />
          <button
            type="submit"
            disabled={registering || !registerUrl.trim()}
            className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40 flex items-center gap-2"
          >
            {registering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe2 className="h-3.5 w-3.5" />}
            Register
          </button>
        </form>
      </div>

      {/* Sites Table */}
      {loading ? (
        <p className="text-sm text-neutral-500">Loading...</p>
      ) : sites.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-8 text-center">
          <Globe2 className="h-8 w-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">No sites registered yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 border-b border-neutral-200 bg-neutral-50">
                <th className="px-4 py-2.5 font-medium w-6"></th>
                <th className="px-4 py-2.5 font-medium">Domain</th>
                <th className="px-4 py-2.5 font-medium w-28">Status</th>
                <th className="px-4 py-2.5 font-medium w-20">Verified</th>
                <th className="px-4 py-2.5 font-medium w-24">Actions</th>
                <th className="px-4 py-2.5 font-medium w-28">Last Crawled</th>
                <th className="px-4 py-2.5 font-medium w-28">Next Crawl</th>
                <th className="px-4 py-2.5 font-medium w-28"></th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => {
                const isExpanded = expandedId === site.id;
                const statusCls = CRAWL_STATUS_BADGE[site.crawl_status] ?? "bg-neutral-100 text-neutral-600 border border-neutral-200";
                const isRecrawling = recrawlingId === site.id;

                return (
                  <Fragment key={site.id}>
                    <tr className="border-b border-neutral-100 hover:bg-neutral-50/50 transition-colors">
                      <td className="px-4 py-2.5">
                        {site.crawl_error && (
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : site.id)}
                            className="text-neutral-400 hover:text-neutral-600 transition-colors"
                          >
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-sm font-medium text-neutral-900">{site.domain}</div>
                        <div className="text-xs text-neutral-400 truncate max-w-[240px]">{site.submitted_url}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[0.65rem] font-medium px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${statusCls}`}>
                          {site.crawl_status === "crawling" && (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                          )}
                          {site.crawl_status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {site.verified ? (
                          <span className="text-[0.65rem] font-medium px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">verified</span>
                        ) : (
                          <span className="text-[0.65rem] font-medium px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 border border-neutral-200">unverified</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-neutral-600 tabular-nums text-xs">{site.discovered_actions_count}</td>
                      <td className="px-4 py-2.5 text-xs text-neutral-400">
                        {site.last_crawled_at ? new Date(site.last_crawled_at).toLocaleDateString() : "--"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-neutral-400">
                        {site.next_crawl_at ? new Date(site.next_crawl_at).toLocaleDateString() : "--"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => handleRecrawl(site.id)}
                            disabled={isRecrawling}
                            className="p-1 rounded text-neutral-400 hover:text-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-40"
                            title="Recrawl"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${isRecrawling ? "animate-spin" : ""}`} />
                          </button>
                          <button
                            onClick={() => handleDeleteSite(site.id, site.domain)}
                            className="p-1 rounded text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Delete site"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && site.crawl_error && (
                      <tr>
                        <td colSpan={8} className="px-4 py-3 bg-red-50/50 border-b border-neutral-100">
                          <div className="text-xs text-red-600 font-medium mb-0.5">Crawl Error</div>
                          <div className="text-xs text-red-500 font-mono">{site.crawl_error}</div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Domains Panel ─────────────────────────────────────────────

interface DomainTool {
  domain_tool_id: string;
  tool_id: string;
  tool_name: string;
  tool_provider: string;
  tool_transport: string;
  rank: number;
}

interface DomainItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  keywords: string[];
  tools: DomainTool[];
}

const defaultDomainForm = {
  name: "",
  slug: "",
  description: "",
  keywords: "",
};

function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function DomainsPanel({ token }: { token: string }) {
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [allTools, setAllTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [addDomainForm, setAddDomainForm] = useState(defaultDomainForm);
  const [addingDomain, setAddingDomain] = useState(false);
  const [editForm, setEditForm] = useState<{ name: string; description: string; keywords: string }>({ name: "", description: "", keywords: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  // Per-domain local tool lists for ranking edits (keyed by domain id)
  const [domainToolEdits, setDomainToolEdits] = useState<Record<string, DomainTool[]>>({});
  const [addToolSelections, setAddToolSelections] = useState<Record<string, { tool_id: string; rank: string }>>({});
  const [savingRanking, setSavingRanking] = useState<string | null>(null);

  // Per-domain crawl-by-URL state (keyed by domain id)
  const [crawlUrls, setCrawlUrls] = useState<Record<string, string>>({});
  const [crawlRanks, setCrawlRanks] = useState<Record<string, number>>({});
  const [crawlStatuses, setCrawlStatuses] = useState<Record<string, "idle" | "loading" | "success" | "error">>({});
  const [crawlMessages, setCrawlMessages] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [domainsRes, toolsRes] = await Promise.all([
        fetch(`${API}/domains`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/tools`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (domainsRes.ok) setDomains(await domainsRes.json());
      if (toolsRes.ok) setAllTools(await toolsRes.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => { loadData(); }, [loadData]);

  // When a domain is expanded, initialize its local tool edit state
  const handleExpand = (domainId: string) => {
    if (expandedId === domainId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(domainId);
    const domain = domains.find((d) => d.id === domainId);
    if (domain && !domainToolEdits[domainId]) {
      setDomainToolEdits((prev) => ({ ...prev, [domainId]: [...domain.tools].sort((a, b) => a.rank - b.rank) }));
    }
    if (!addToolSelections[domainId]) {
      setAddToolSelections((prev) => ({ ...prev, [domainId]: { tool_id: "", rank: "" } }));
    }
  };

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingDomain(true);
    try {
      const body = {
        name: addDomainForm.name,
        slug: addDomainForm.slug || slugify(addDomainForm.name),
        description: addDomainForm.description,
        keywords: addDomainForm.keywords.split(",").map((s) => s.trim()).filter(Boolean),
      };
      const res = await fetch(`${API}/domains`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setAddDomainForm(defaultDomainForm);
        setShowAddDomain(false);
        await loadData();
      }
    } catch { /* ignore */ }
    setAddingDomain(false);
  };

  const handleDeleteDomain = async (domainId: string, name: string) => {
    if (!confirm(`Delete domain "${name}"? This cannot be undone.`)) return;
    try {
      await fetch(`${API}/domains/${domainId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setDomains((prev) => prev.filter((d) => d.id !== domainId));
      if (expandedId === domainId) setExpandedId(null);
    } catch { /* ignore */ }
  };

  const handleStartEdit = (domain: DomainItem) => {
    setEditingId(domain.id);
    setEditForm({
      name: domain.name,
      description: domain.description,
      keywords: domain.keywords.join(", "),
    });
  };

  const handleSaveEdit = async (domainId: string) => {
    setSavingEdit(true);
    try {
      const body = {
        name: editForm.name,
        description: editForm.description,
        keywords: editForm.keywords.split(",").map((s) => s.trim()).filter(Boolean),
      };
      const res = await fetch(`${API}/domains/${domainId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditingId(null);
        await loadData();
      }
    } catch { /* ignore */ }
    setSavingEdit(false);
  };

  const handleRankChange = (domainId: string, domainToolId: string, newRank: string) => {
    setDomainToolEdits((prev) => ({
      ...prev,
      [domainId]: (prev[domainId] ?? []).map((dt) =>
        dt.domain_tool_id === domainToolId ? { ...dt, rank: Number(newRank) } : dt
      ),
    }));
  };

  const handleRemoveToolRow = (domainId: string, domainToolId: string) => {
    setDomainToolEdits((prev) => ({
      ...prev,
      [domainId]: (prev[domainId] ?? []).filter((dt) => dt.domain_tool_id !== domainToolId),
    }));
  };

  const handleAddToolRow = (domainId: string) => {
    const sel = addToolSelections[domainId];
    if (!sel || !sel.tool_id) return;
    const tool = allTools.find((t) => t.id === sel.tool_id);
    if (!tool) return;
    const rank = Number(sel.rank) || ((domainToolEdits[domainId]?.length ?? 0) + 1);
    const newRow: DomainTool = {
      domain_tool_id: `new-${Date.now()}`,
      tool_id: tool.id,
      tool_name: tool.name,
      tool_provider: tool.provider,
      tool_transport: tool.transport,
      rank,
    };
    setDomainToolEdits((prev) => ({
      ...prev,
      [domainId]: [...(prev[domainId] ?? []), newRow],
    }));
    setAddToolSelections((prev) => ({ ...prev, [domainId]: { tool_id: "", rank: "" } }));
  };

  const handleSaveRanking = async (domainId: string) => {
    setSavingRanking(domainId);
    try {
      const tools = (domainToolEdits[domainId] ?? []).map((dt) => ({
        tool_id: dt.tool_id,
        rank: dt.rank,
      }));
      await fetch(`${API}/domains/${domainId}/tools`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(tools),
      });
      await loadData();
      // Re-init edit state for this domain from fresh data
      setDomainToolEdits((prev) => {
        const updated = { ...prev };
        delete updated[domainId];
        return updated;
      });
    } catch { /* ignore */ }
    setSavingRanking(null);
  };

  const handleCrawlUrl = async (domainId: string) => {
    const url = crawlUrls[domainId] ?? "";
    const rank = crawlRanks[domainId] ?? 1;
    if (!url.trim()) return;
    setCrawlStatuses((prev) => ({ ...prev, [domainId]: "loading" }));
    setCrawlMessages((prev) => ({ ...prev, [domainId]: `Crawling ${new URL(url).hostname}…` }));
    try {
      const res = await fetch(`${API}/domains/${domainId}/crawl-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url, rank }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setCrawlStatuses((prev) => ({ ...prev, [domainId]: "error" }));
        setCrawlMessages((prev) => ({ ...prev, [domainId]: errData.detail ?? `Error ${res.status}` }));
      } else {
        const data = await res.json();
        setCrawlStatuses((prev) => ({ ...prev, [domainId]: "success" }));
        setCrawlMessages((prev) => ({
          ...prev,
          [domainId]: `Added: ${data.tool_name} (${data.actions_count} actions) at rank ${rank}`,
        }));
        setCrawlUrls((prev) => ({ ...prev, [domainId]: "" }));
        await loadData();
        setDomainToolEdits((prev) => {
          const updated = { ...prev };
          delete updated[domainId];
          return updated;
        });
      }
    } catch (err) {
      setCrawlStatuses((prev) => ({ ...prev, [domainId]: "error" }));
      setCrawlMessages((prev) => ({ ...prev, [domainId]: "Network error — could not reach server." }));
    }
  };

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-neutral-900">Domains ({domains.length})</h2>
        <button
          onClick={() => setShowAddDomain((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Domain
        </button>
      </div>

      {/* Add Domain Form */}
      {showAddDomain && (
        <div className="bg-white border border-neutral-200 rounded-xl p-5 mb-4">
          <h3 className="text-sm font-semibold text-neutral-900 mb-4">New Domain</h3>
          <form onSubmit={handleAddDomain} className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Name *</label>
              <input
                required
                value={addDomainForm.name}
                onChange={(e) => setAddDomainForm((f) => ({
                  ...f,
                  name: e.target.value,
                  slug: slugify(e.target.value),
                }))}
                placeholder="e.g. Accommodation"
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Slug</label>
              <input
                value={addDomainForm.slug}
                onChange={(e) => setAddDomainForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="auto-generated from name"
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400 font-mono"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-neutral-500 mb-1 block">Description</label>
              <input
                value={addDomainForm.description}
                onChange={(e) => setAddDomainForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Hotel and short-term rental bookings"
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-neutral-500 mb-1 block">Keywords (comma-separated)</label>
              <input
                value={addDomainForm.keywords}
                onChange={(e) => setAddDomainForm((f) => ({ ...f, keywords: e.target.value }))}
                placeholder="e.g. hotel, airbnb, stay, room"
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div className="col-span-2 flex gap-2 pt-1">
              <button
                type="submit"
                disabled={addingDomain}
                className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                {addingDomain && <Loader2 className="h-3 w-3 animate-spin" />}
                Create Domain
              </button>
              <button
                type="button"
                onClick={() => { setShowAddDomain(false); setAddDomainForm(defaultDomainForm); }}
                className="px-4 py-2 rounded-lg border border-neutral-200 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Domain List */}
      {loading ? (
        <p className="text-sm text-neutral-500">Loading...</p>
      ) : domains.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-8 text-center">
          <Layers className="h-8 w-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">No domains yet.</p>
          <p className="text-xs text-neutral-400 mt-1">Create a domain to define curated tool rankings per intent category.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {domains.map((domain) => {
            const isExpanded = expandedId === domain.id;
            const isEditing = editingId === domain.id;
            const localTools = domainToolEdits[domain.id] ?? [...domain.tools].sort((a, b) => a.rank - b.rank);
            const addSel = addToolSelections[domain.id] ?? { tool_id: "", rank: "" };
            const isSavingRanking = savingRanking === domain.id;

            return (
              <div key={domain.id} className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                {/* Header row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => handleExpand(domain.id)}
                    className="shrink-0 text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            placeholder="Name"
                            className="flex-1 px-2.5 py-1 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
                          />
                          <input
                            value={editForm.description}
                            onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                            placeholder="Description"
                            className="flex-[2] px-2.5 py-1 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
                          />
                        </div>
                        <input
                          value={editForm.keywords}
                          onChange={(e) => setEditForm((f) => ({ ...f, keywords: e.target.value }))}
                          placeholder="Keywords (comma-separated)"
                          className="w-full px-2.5 py-1 rounded-lg border border-neutral-200 text-xs outline-none focus:border-neutral-400"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveEdit(domain.id)}
                            disabled={savingEdit}
                            className="px-3 py-1 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40 flex items-center gap-1"
                          >
                            {savingEdit && <Loader2 className="h-3 w-3 animate-spin" />}
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="text-sm font-medium text-neutral-900">{domain.name}</span>
                          <span className="text-[0.65rem] text-neutral-400 font-mono">{domain.slug}</span>
                        </div>
                        {domain.description && (
                          <p className="text-xs text-neutral-500 mt-0.5 truncate">{domain.description}</p>
                        )}
                        {domain.keywords.length > 0 && (
                          <div className="flex gap-1 flex-wrap mt-1">
                            {domain.keywords.map((kw) => (
                              <span key={kw} className="text-[0.6rem] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 border border-neutral-200">
                                {kw}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-neutral-400 tabular-nums">{domain.tools.length} tools</span>
                      <button
                        onClick={() => handleStartEdit(domain)}
                        className="text-xs text-neutral-400 hover:text-neutral-700 px-2 py-1 rounded hover:bg-neutral-100 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteDomain(domain.id, domain.name)}
                        className="p-1 rounded text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Delete domain"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded: ranked tool table */}
                {isExpanded && (
                  <div className="border-t border-neutral-100 bg-neutral-50/50 px-4 py-4 space-y-4">

                    {/* Add by URL */}
                    {(() => {
                      const crawlUrl = crawlUrls[domain.id] ?? "";
                      const crawlRank = crawlRanks[domain.id] ?? 1;
                      const crawlStatus = crawlStatuses[domain.id] ?? "idle";
                      const crawlMessage = crawlMessages[domain.id] ?? "";
                      const isCrawling = crawlStatus === "loading";
                      return (
                        <div className="bg-white border border-neutral-200 rounded-xl p-4">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-700 mb-3">
                            <Link className="h-3.5 w-3.5 text-neutral-400" />
                            Add by URL
                          </div>
                          <div className="flex gap-2 items-center">
                            <input
                              type="url"
                              value={crawlUrl}
                              onChange={(e) => setCrawlUrls((prev) => ({ ...prev, [domain.id]: e.target.value }))}
                              placeholder="https://airbnb.com"
                              className="flex-1 px-3 py-1.5 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400"
                            />
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-xs text-neutral-400">Rank:</span>
                              <input
                                type="number"
                                min="1"
                                value={crawlRank}
                                onChange={(e) => setCrawlRanks((prev) => ({ ...prev, [domain.id]: Number(e.target.value) }))}
                                className="w-14 px-1.5 py-1.5 rounded-lg border border-neutral-200 text-xs text-center outline-none focus:border-neutral-400"
                              />
                            </div>
                            <button
                              onClick={() => handleCrawlUrl(domain.id)}
                              disabled={isCrawling || !crawlUrl.trim()}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40 shrink-0"
                            >
                              {isCrawling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link className="h-3.5 w-3.5" />}
                              Crawl &amp; Add
                            </button>
                          </div>
                          {crawlMessage && (
                            <p className={`mt-2 text-xs ${
                              crawlStatus === "success"
                                ? "text-green-600"
                                : crawlStatus === "error"
                                ? "text-red-500"
                                : "text-neutral-500"
                            }`}>
                              {crawlMessage}
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-neutral-500 border-b border-neutral-200 bg-neutral-50">
                            <th className="px-3 py-2 font-medium w-16">Rank</th>
                            <th className="px-3 py-2 font-medium">Tool Name</th>
                            <th className="px-3 py-2 font-medium">Provider</th>
                            <th className="px-3 py-2 font-medium w-24">Transport</th>
                            <th className="px-3 py-2 font-medium w-16"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {localTools.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-3 py-4 text-xs text-neutral-400 text-center">
                                No tools added yet. Use the row below to add one.
                              </td>
                            </tr>
                          )}
                          {localTools.map((dt) => {
                            const transportCls = TRANSPORT_BADGE[dt.tool_transport] ?? "bg-neutral-100 text-neutral-600 border border-neutral-200";
                            return (
                              <tr key={dt.domain_tool_id} className="border-b border-neutral-100 hover:bg-neutral-50/50 transition-colors">
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    min="1"
                                    value={dt.rank}
                                    onChange={(e) => handleRankChange(domain.id, dt.domain_tool_id, e.target.value)}
                                    className="w-12 px-1.5 py-0.5 rounded border border-neutral-200 text-xs text-center outline-none focus:border-neutral-400"
                                  />
                                </td>
                                <td className="px-3 py-2 text-sm font-medium text-neutral-900">{dt.tool_name}</td>
                                <td className="px-3 py-2 text-xs text-neutral-500">{dt.tool_provider}</td>
                                <td className="px-3 py-2">
                                  <span className={`text-[0.65rem] font-medium px-1.5 py-0.5 rounded ${transportCls}`}>
                                    {(dt.tool_transport || "").toUpperCase()}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    onClick={() => handleRemoveToolRow(domain.id, dt.domain_tool_id)}
                                    className="p-1 rounded text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                    title="Remove from domain"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}

                          {/* Add tool row */}
                          <tr className="border-t border-neutral-200 bg-neutral-50/30">
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="1"
                                value={addSel.rank}
                                onChange={(e) => setAddToolSelections((prev) => ({
                                  ...prev,
                                  [domain.id]: { ...prev[domain.id], rank: e.target.value },
                                }))}
                                placeholder={(localTools.length + 1).toString()}
                                className="w-12 px-1.5 py-0.5 rounded border border-neutral-200 text-xs text-center outline-none focus:border-neutral-400"
                              />
                            </td>
                            <td className="px-3 py-2" colSpan={3}>
                              <select
                                value={addSel.tool_id}
                                onChange={(e) => setAddToolSelections((prev) => ({
                                  ...prev,
                                  [domain.id]: { ...prev[domain.id], tool_id: e.target.value },
                                }))}
                                className="w-full px-2.5 py-1 rounded-lg border border-neutral-200 text-xs outline-none focus:border-neutral-400 bg-white"
                              >
                                <option value="">Select a tool…</option>
                                {allTools.map((t) => (
                                  <option key={t.id} value={t.id}>{t.name} ({t.provider})</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <button
                                onClick={() => handleAddToolRow(domain.id)}
                                disabled={!addSel.tool_id}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40"
                              >
                                <Plus className="h-3 w-3" />
                                Add
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-end">
                      <button
                        onClick={() => handleSaveRanking(domain.id)}
                        disabled={isSavingRanking}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40"
                      >
                        {isSavingRanking && <Loader2 className="h-3 w-3 animate-spin" />}
                        Save Ranking
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── MCP Market Panel ────────────────────────────────────────────

function MCPMarketPanel({ token }: { token: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [limit, setLimit] = useState(500);
  const [tools, setTools] = useState<{ id: string; name: string; provider: string; page_url: string; tags: string[]; actions_count: number }[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);

  const loadTools = async () => {
    setLoadingTools(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/mcpmarket/tools`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTools(data);
    } catch {
      setTools([]);
    } finally {
      setLoadingTools(false);
    }
  };

  useEffect(() => { loadTools(); }, []);

  const startCrawl = async () => {
    setStatus("starting...");
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/mcpmarket/crawl`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ limit }),
      });
      const data = await res.json();
      setStatus(data.message || "Crawl started in background");
    } catch {
      setStatus("Error starting crawl");
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-neutral-200 p-5">
        <h3 className="text-sm font-semibold text-neutral-900 mb-1">MCP Server Indexer</h3>
        <p className="text-xs text-neutral-500 mb-4">
          Crawls the Smithery registry — 3,800+ community MCP servers with live hosted endpoints. Each server is indexed as a directly-connectable tool with real MCP URLs and actual action definitions.
        </p>
        <div className="flex items-center gap-3 mb-3">
          <label className="text-xs text-neutral-600">Limit:</label>
          <input
            type="number"
            value={limit}
            min={10}
            max={2000}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-24 px-2 py-1 text-xs border border-neutral-200 rounded-lg"
          />
          <button
            onClick={startCrawl}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Start Crawl
          </button>
          <button
            onClick={loadTools}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-neutral-100 text-neutral-700 rounded-lg hover:bg-neutral-200 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh List
          </button>
        </div>
        {status && (
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
            {status}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 p-5">
        <h3 className="text-sm font-semibold text-neutral-900 mb-3">
          Indexed MCP Market Servers ({tools.length})
        </h3>
        {loadingTools ? (
          <p className="text-xs text-neutral-500">Loading...</p>
        ) : tools.length === 0 ? (
          <p className="text-xs text-neutral-500">No MCP Market servers indexed yet. Start a crawl above.</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {tools.map((t) => (
              <div key={t.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-neutral-900 truncate">{t.name}</p>
                  <p className="text-xs text-neutral-500 truncate">{t.provider}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-neutral-400">{t.actions_count} action{t.actions_count !== 1 ? "s" : ""}</span>
                  {t.page_url && (
                    <a
                      href={t.page_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      View
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main admin page ────────────────────────────────────────────

type Tab = "conversations" | "feedback" | "suggestions" | "webmcp" | "domains" | "tools" | "sites" | "mcpmarket";

function tabLabel(t: Tab): string {
  if (t === "webmcp") return "WebMCP";
  if (t === "mcpmarket") return "MCP Market";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [conversations, setConversations] = useState<ConvItem[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [tab, setTab] = useState<Tab>("conversations");
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  useEffect(() => {
    const saved = localStorage.getItem("admin_token");
    if (saved) setToken(saved);
  }, []);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    try {
      const [s, c, sg] = await Promise.all([
        api("/stats", t),
        api("/conversations?limit=100", t),
        api("/suggestions?limit=100", t),
      ]);
      setStats(s);
      setConversations(c);
      setSuggestions(sg);
    } catch {
      setToken(null);
      localStorage.removeItem("admin_token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) load(token);
  }, [token, load]);

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem("admin_token");
  };

  const handleDownload = (path: string) => {
    if (!token) return;
    fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = path.split("/").pop() || "export";
        a.click();
        URL.revokeObjectURL(url);
      });
  };

  if (!token) return <LoginScreen onLogin={setToken} />;

  const allTabs: Tab[] = ["conversations", "feedback", "suggestions", "webmcp", "domains", "tools", "sites"];

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <div className="border-b border-neutral-200 bg-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-neutral-900">AgentNet Admin</span>
          <nav className="flex gap-1">
            {allTabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tab === t
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                {tabLabel(t)}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative group">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-600 hover:bg-neutral-100 border border-neutral-200 transition-colors">
              <Download className="h-3.5 w-3.5" />
              Export
              <ChevronDown className="h-3 w-3" />
            </button>
            <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-neutral-200 rounded-xl shadow-lg py-1 hidden group-hover:block z-10">
              <button onClick={() => handleDownload("/export/conversations.csv")} className="w-full text-left px-4 py-2 text-xs text-neutral-700 hover:bg-neutral-50">
                Conversations (CSV)
              </button>
              <button onClick={() => handleDownload("/export/training.jsonl?format=openai")} className="w-full text-left px-4 py-2 text-xs text-neutral-700 hover:bg-neutral-50">
                Training data (OpenAI JSONL)
              </button>
              <button onClick={() => handleDownload("/export/training.jsonl?format=openai&only_positive=true")} className="w-full text-left px-4 py-2 text-xs text-neutral-700 hover:bg-neutral-50">
                Training data (positive only)
              </button>
              <button onClick={() => handleDownload("/export/training.jsonl?format=raw")} className="w-full text-left px-4 py-2 text-xs text-neutral-700 hover:bg-neutral-50">
                Raw data (JSONL + metadata)
              </button>
              <button onClick={() => handleDownload("/export/suggestions.csv")} className="w-full text-left px-4 py-2 text-xs text-neutral-700 hover:bg-neutral-50">
                Suggestions (CSV)
              </button>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {loading ? (
          <p className="text-sm text-neutral-500">Loading...</p>
        ) : (
          <>
            {stats && tab !== "tools" && tab !== "sites" && tab !== "domains" && tab !== "mcpmarket" && <StatsBar stats={stats} />}

            {tab === "conversations" && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-neutral-900">
                    Conversations ({conversations.length})
                  </h2>
                  <ViewToggle mode={viewMode} onChange={setViewMode} />
                </div>
                {conversations.length === 0 ? (
                  <p className="text-sm text-neutral-500">No conversations yet. Start chatting to collect data.</p>
                ) : viewMode === "list" ? (
                  <div className="space-y-2">
                    {conversations.map((c) => <ConversationRow key={c.id} conv={c} />)}
                  </div>
                ) : viewMode === "table" ? (
                  <ConversationsTable items={conversations} />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {conversations.map((c) => <ConversationCard key={c.id} conv={c} />)}
                  </div>
                )}
              </div>
            )}

            {tab === "feedback" && (() => {
              const allFeedback = conversations
                .flatMap((c) => c.feedback.map((f) => ({ ...f, convId: c.id, preview: c.preview, date: c.started_at })));
              const empty = allFeedback.length === 0;

              return (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-neutral-900">Feedback ({allFeedback.length})</h2>
                    <ViewToggle mode={viewMode} onChange={setViewMode} />
                  </div>
                  {empty ? (
                    <p className="text-sm text-neutral-500">No feedback yet.</p>
                  ) : viewMode === "list" ? (
                    <div className="space-y-2">
                      {allFeedback.map((f, i) => (
                        <div key={i} className="flex items-start gap-3 bg-white border border-neutral-200 rounded-xl px-4 py-3">
                          {f.vote === "up" ? (
                            <ThumbsUp className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                          ) : (
                            <ThumbsDown className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm text-neutral-800 line-clamp-2">{f.content}</p>
                            <p className="text-xs text-neutral-400 mt-1">Query: {f.preview}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : viewMode === "table" ? (
                    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-neutral-500 border-b border-neutral-200 bg-neutral-50">
                            <th className="px-4 py-2.5 font-medium w-16">Vote</th>
                            <th className="px-4 py-2.5 font-medium">Content</th>
                            <th className="px-4 py-2.5 font-medium">Query</th>
                            <th className="px-4 py-2.5 font-medium w-28">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allFeedback.map((f, i) => (
                            <tr key={i} className="border-b border-neutral-100">
                              <td className="px-4 py-2.5">
                                {f.vote === "up" ? (
                                  <ThumbsUp className="h-3.5 w-3.5 text-green-500" />
                                ) : (
                                  <ThumbsDown className="h-3.5 w-3.5 text-red-400" />
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-neutral-800 truncate max-w-[300px]">{f.content}</td>
                              <td className="px-4 py-2.5 text-neutral-500 truncate max-w-[200px]">{f.preview}</td>
                              <td className="px-4 py-2.5 text-xs text-neutral-400">
                                {f.date ? new Date(f.date).toLocaleDateString() : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {allFeedback.map((f, i) => (
                        <div key={i} className="bg-white border border-neutral-200 rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-2">
                            {f.vote === "up" ? (
                              <ThumbsUp className="h-4 w-4 text-green-500" />
                            ) : (
                              <ThumbsDown className="h-4 w-4 text-red-400" />
                            )}
                            <span className={`text-xs font-medium ${f.vote === "up" ? "text-green-600" : "text-red-500"}`}>
                              {f.vote === "up" ? "Positive" : "Negative"}
                            </span>
                          </div>
                          <p className="text-sm text-neutral-800 line-clamp-3">{f.content}</p>
                          <p className="text-xs text-neutral-400 mt-2 truncate">Query: {f.preview}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {tab === "suggestions" && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-neutral-900">
                    Tool Suggestions ({suggestions.length})
                  </h2>
                  <ViewToggle mode={viewMode} onChange={setViewMode} />
                </div>
                {viewMode === "list" || viewMode === "table" ? (
                  <SuggestionsTable items={suggestions} />
                ) : (
                  <SuggestionsCards items={suggestions} />
                )}
              </div>
            )}

            {tab === "webmcp" && token && (
              <WebMCPPanel token={token} />
            )}

            {tab === "domains" && token && (
              <DomainsPanel token={token} />
            )}

            {tab === "tools" && token && (
              <ToolsPanel token={token} />
            )}

            {tab === "sites" && token && (
              <SitesPanel token={token} />
            )}

            {tab === "mcpmarket" && token && (
              <MCPMarketPanel token={token} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
