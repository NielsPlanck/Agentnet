"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus,
  Search,
  PanelLeftClose,
  PanelLeft,
  Trash2,
  MessageSquare,
  Loader2,
  Settings,
  LogOut,
  ChevronUp,
  ChevronDown,
  Zap,
  Globe,
  Code2,
  TrendingUp,
  FileText,
  Mail,
  Cloud,
  Github,
  BookOpen,
  MessageCircle,
  Check,
  Briefcase,
  Bell,
  Inbox,
  CalendarCheck,
  GitBranch,
} from "lucide-react";
import {
  fetchConversations,
  deleteConversation,
  type ConversationSummary,
} from "@/lib/history";
import {
  type Skill,
  getAllSkills,
  saveSkillToggle,
  fetchCustomSkills,
  updateCustomSkill as apiUpdateCustomSkill,
  loadLocalCustomSkills,
  updateLocalCustomSkill,
  customToSkill,
} from "@/lib/skills";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";

// Map icon names to Lucide components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Globe, Search, Code2, TrendingUp, FileText, Mail, Cloud, Github, BookOpen, MessageCircle, Zap, Briefcase, Bell, Inbox, CalendarCheck, MessageSquare, GitBranch,
};

interface ChatSidebarProps {
  onNewChat: () => void;
  onLoadConversation: (id: string) => void;
  isStreaming: boolean;
}

const SIDEBAR_KEY = "agentnet_sidebar_collapsed";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function groupByTime(
  conversations: ConversationSummary[]
): { label: string; items: ConversationSummary[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const monthAgo = new Date(today.getTime() - 30 * 86400000);

  const groups: { label: string; items: ConversationSummary[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Previous 30 days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const c of conversations) {
    const d = c.started_at ? new Date(c.started_at) : new Date(0);
    if (d >= today) groups[0].items.push(c);
    else if (d >= yesterday) groups[1].items.push(c);
    else if (d >= weekAgo) groups[2].items.push(c);
    else if (d >= monthAgo) groups[3].items.push(c);
    else groups[4].items.push(c);
  }

  return groups.filter((g) => g.items.length > 0);
}

const SKILLS_COLLAPSED_KEY = "agentnet_skills_collapsed";

export function ChatSidebar({
  onNewChat,
  onLoadConversation,
  isStreaming,
}: ChatSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [skillsCollapsed, setSkillsCollapsed] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [customSkills, setCustomSkills] = useState<Skill[]>([]);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();
  const router = useRouter();

  // Restore collapsed state + skills
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_KEY);
      if (saved === "true") setCollapsed(true);
      const savedSkills = localStorage.getItem(SKILLS_COLLAPSED_KEY);
      if (savedSkills === "true") setSkillsCollapsed(true);
    } catch {}
    setSkills(getAllSkills());
  }, []);

  // Load custom skills
  useEffect(() => {
    async function loadCustom() {
      try {
        if (user) {
          const data = await fetchCustomSkills();
          setCustomSkills(data.map(customToSkill));
        } else {
          setCustomSkills(loadLocalCustomSkills().map(customToSkill));
        }
      } catch {
        setCustomSkills(loadLocalCustomSkills().map(customToSkill));
      }
    }
    loadCustom();
  }, [user]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch {}
      return next;
    });
  };

  const toggleSkill = (skillId: string) => {
    setSkills((prev) =>
      prev.map((s) => {
        if (s.id !== skillId) return s;
        const next = !s.enabled;
        saveSkillToggle(skillId, next);
        return { ...s, enabled: next };
      })
    );
  };

  const toggleCustomSkill = async (skillId: string) => {
    setCustomSkills((prev) =>
      prev.map((s) => {
        if (s.id !== skillId) return s;
        return { ...s, enabled: !s.enabled };
      })
    );
    const skill = customSkills.find((s) => s.id === skillId);
    if (!skill) return;
    const newEnabled = !skill.enabled;
    try {
      if (user) {
        await apiUpdateCustomSkill(skillId, { enabled: newEnabled });
      } else {
        updateLocalCustomSkill(skillId, { enabled: newEnabled });
      }
    } catch {
      // revert
      setCustomSkills((prev) =>
        prev.map((s) => s.id === skillId ? { ...s, enabled: skill.enabled } : s)
      );
    }
  };

  // Load conversations
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await fetchConversations(100);
      setConversations(data.conversations);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh conversations periodically when sidebar is visible
  useEffect(() => {
    if (collapsed || !user) return;
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [collapsed, user, load]);

  // Close user menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // silently fail
    } finally {
      setDeletingId(null);
    }
  };

  // Filter conversations by search
  const filtered = searchQuery.trim()
    ? conversations.filter((c) =>
        c.title?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations;

  const groups = groupByTime(filtered);

  const enabledCount = skills.filter((s) => s.enabled).length + customSkills.filter((s) => s.enabled).length;
  const totalCount = skills.length + customSkills.length;

  const initials = user?.display_name
    ? user.display_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.[0]?.toUpperCase() || "?";

  // Collapsed sidebar — just icons
  if (collapsed) {
    return (
      <div className="w-[52px] shrink-0 bg-[var(--sidebar)] border-r border-[var(--sidebar-border)] flex flex-col items-center py-3 gap-1">
        <button
          type="button"
          onClick={toggleCollapsed}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] transition-colors mb-2"
          title="Expand sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNewChat}
          disabled={isStreaming}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] transition-colors disabled:opacity-40"
          title="New chat"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => { setCollapsed(false); setSearchOpen(true); }}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] transition-colors"
          title="Search chats"
        >
          <Search className="h-4 w-4" />
        </button>

        {/* Skills icon */}
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] transition-colors"
          title="Skills"
        >
          <Zap className="h-4 w-4" />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User avatar at bottom */}
        {user && (
          <button
            type="button"
            onClick={() => router.push("/settings")}
            className="h-8 w-8 flex items-center justify-center rounded-full shrink-0"
            title="Settings"
          >
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                className="h-7 w-7 rounded-full object-cover"
              />
            ) : (
              <div className="h-7 w-7 rounded-full bg-[var(--sidebar-accent)] text-[var(--sidebar-foreground)] flex items-center justify-center text-[0.6rem] font-semibold">
                {initials}
              </div>
            )}
          </button>
        )}
      </div>
    );
  }

  // Group skills by category
  const builtInSkills = skills.filter((s) => s.category === "built-in");
  const integrationSkills = skills.filter((s) => s.category === "integration");

  // Expanded sidebar
  return (
    <div className="w-[260px] shrink-0 bg-[var(--sidebar)] border-r border-[var(--sidebar-border)] flex flex-col h-full select-none">
      {/* Header: AgentNet + collapse */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-[15px] font-semibold text-[var(--sidebar-foreground)] tracking-tight">
          AgentNet
        </span>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="h-7 w-7 flex items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] transition-colors"
          title="Collapse sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {/* New Chat + Search */}
      <div className="px-2 py-1.5 flex flex-col gap-0.5">
        <button
          type="button"
          onClick={onNewChat}
          disabled={isStreaming}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] transition-colors disabled:opacity-40 w-full text-left"
        >
          <Plus className="h-4 w-4 shrink-0" />
          New chat
        </button>
        <button
          type="button"
          onClick={() => setSearchOpen(!searchOpen)}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] transition-colors w-full text-left"
        >
          <Search className="h-4 w-4 shrink-0" />
          Search
        </button>
      </div>

      {/* Search input (expandable) */}
      {searchOpen && (
        <div className="px-2 pb-1.5">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats..."
            autoFocus
            className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--sidebar-accent)] border border-[var(--sidebar-border)] text-sm text-[var(--sidebar-foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:ring-1 focus:ring-[var(--sidebar-ring)]"
          />
        </div>
      )}

      {/* Skills section */}
      <div className="px-2 pt-1">
        <button
          type="button"
          onClick={() => {
            setSkillsCollapsed((prev) => {
              const next = !prev;
              try { localStorage.setItem(SKILLS_COLLAPSED_KEY, String(next)); } catch {}
              return next;
            });
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 w-full text-left"
        >
          <Zap className="h-3 w-3 text-[var(--muted-foreground)]" />
          <span className="text-[0.65rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)] flex-1">
            Skills
          </span>
          <span className="text-[0.6rem] text-[var(--muted-foreground)] mr-1">
            {enabledCount}/{totalCount}
          </span>
          <ChevronDown className={`h-3 w-3 text-[var(--muted-foreground)] transition-transform ${skillsCollapsed ? "-rotate-90" : ""}`} />
        </button>
        {!skillsCollapsed && (
          <div className="flex flex-col gap-px pb-1">
            {/* Built-in skills */}
            {builtInSkills.length > 0 && (
              <>
                <div className="px-2.5 pt-1.5 pb-0.5">
                  <span className="text-[0.55rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)] opacity-60">
                    Built-in
                  </span>
                </div>
                {builtInSkills.map((skill) => {
                  const Icon = ICON_MAP[skill.icon] || Zap;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleSkill(skill.id)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] hover:bg-[var(--sidebar-accent)] transition-colors w-full text-left group"
                    >
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${skill.enabled ? "text-green-500" : "text-[var(--muted-foreground)]"}`} />
                      <span className={`flex-1 truncate ${skill.enabled ? "text-[var(--sidebar-foreground)]" : "text-[var(--muted-foreground)]"}`}>
                        {skill.name}
                      </span>
                      <div className={`h-4 w-4 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        skill.enabled
                          ? "bg-green-500 text-white"
                          : "border border-[var(--sidebar-border)] text-transparent group-hover:border-[var(--muted-foreground)]"
                      }`}>
                        <Check className="h-2.5 w-2.5" />
                      </div>
                    </button>
                  );
                })}
              </>
            )}

            {/* Integration skills */}
            {integrationSkills.length > 0 && (
              <>
                <div className="px-2.5 pt-2 pb-0.5">
                  <span className="text-[0.55rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)] opacity-60">
                    Integrations
                  </span>
                </div>
                {integrationSkills.map((skill) => {
                  const Icon = ICON_MAP[skill.icon] || Zap;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleSkill(skill.id)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] hover:bg-[var(--sidebar-accent)] transition-colors w-full text-left group"
                    >
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${skill.enabled ? "text-green-500" : "text-[var(--muted-foreground)]"}`} />
                      <span className={`flex-1 truncate ${skill.enabled ? "text-[var(--sidebar-foreground)]" : "text-[var(--muted-foreground)]"}`}>
                        {skill.name}
                      </span>
                      <div className={`h-4 w-4 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        skill.enabled
                          ? "bg-green-500 text-white"
                          : "border border-[var(--sidebar-border)] text-transparent group-hover:border-[var(--muted-foreground)]"
                      }`}>
                        <Check className="h-2.5 w-2.5" />
                      </div>
                    </button>
                  );
                })}
              </>
            )}

            {/* Custom skills */}
            {customSkills.length > 0 && (
              <>
                <div className="px-2.5 pt-2 pb-0.5 flex items-center justify-between">
                  <span className="text-[0.55rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)] opacity-60">
                    Custom
                  </span>
                  <button
                    type="button"
                    onClick={() => router.push("/settings?tab=skills")}
                    className="text-[0.55rem] text-[var(--muted-foreground)] hover:text-[var(--sidebar-foreground)] transition-colors"
                    title="Manage skills"
                  >
                    +
                  </button>
                </div>
                {customSkills.map((skill) => {
                  const Icon = ICON_MAP[skill.icon] || Zap;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleCustomSkill(skill.id)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] hover:bg-[var(--sidebar-accent)] transition-colors w-full text-left group"
                    >
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${skill.enabled ? "text-green-500" : "text-[var(--muted-foreground)]"}`} />
                      <span className={`flex-1 truncate ${skill.enabled ? "text-[var(--sidebar-foreground)]" : "text-[var(--muted-foreground)]"}`}>
                        {skill.name}
                      </span>
                      <div className={`h-4 w-4 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        skill.enabled
                          ? "bg-green-500 text-white"
                          : "border border-[var(--sidebar-border)] text-transparent group-hover:border-[var(--muted-foreground)]"
                      }`}>
                        <Check className="h-2.5 w-2.5" />
                      </div>
                    </button>
                  );
                })}
              </>
            )}

            {/* Add skill link when no custom skills */}
            {customSkills.length === 0 && (
              <button
                type="button"
                onClick={() => router.push("/settings?tab=skills")}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] hover:bg-[var(--sidebar-accent)] transition-colors w-full text-left text-[var(--muted-foreground)] hover:text-[var(--sidebar-foreground)] mt-1"
              >
                <Plus className="h-3 w-3 shrink-0" />
                <span className="truncate">Create custom skill</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Recents label */}
      <div className="px-4 pt-2 pb-1">
        <span className="text-[0.65rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
          Recents
        </span>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-1.5">
        {!user ? (
          <div className="flex flex-col items-center justify-center py-8 px-3 text-center">
            <MessageSquare className="h-6 w-6 text-[var(--muted-foreground)] mb-2 opacity-30" />
            <p className="text-xs text-[var(--muted-foreground)]">
              Sign in to see your chat history
            </p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-3 text-center">
            <MessageSquare className="h-6 w-6 text-[var(--muted-foreground)] mb-2 opacity-30" />
            <p className="text-xs text-[var(--muted-foreground)]">
              {searchQuery ? "No matching chats" : "No conversations yet"}
            </p>
          </div>
        ) : (
          <div className="pb-2">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="px-2.5 pt-3 pb-1">
                  <span className="text-[0.6rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                    {group.label}
                  </span>
                </div>
                {group.items.map((c) => (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onLoadConversation(c.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") onLoadConversation(c.id); }}
                    className="group w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[var(--sidebar-accent)] transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <p className="flex-1 min-w-0 text-[13px] text-[var(--sidebar-foreground)] truncate">
                      {c.title || "Untitled"}
                    </p>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(c.id, e)}
                      disabled={deletingId === c.id}
                      className="opacity-0 group-hover:opacity-100 h-5 w-5 flex items-center justify-center rounded hover:bg-[var(--sidebar-accent)] transition-all text-[var(--muted-foreground)] hover:text-red-400 shrink-0"
                    >
                      {deletingId === c.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User section at bottom */}
      <div className="border-t border-[var(--sidebar-border)] p-2" ref={userMenuRef}>
        {user ? (
          <div className="relative">
            {/* User menu popup (opens upward) */}
            {userMenuOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-[var(--sidebar-border)] bg-[var(--card)] shadow-lg py-1 z-50">
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    router.push("/workflows");
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  Workflows
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    router.push("/whatsapp");
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  WhatsApp
                </button>
                <div className="border-t border-[var(--sidebar-border)] my-1" />
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    router.push("/settings");
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setUserMenuOpen(false);
                    await logout();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            )}

            {/* User bar */}
            <button
              type="button"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--sidebar-accent)] transition-colors"
            >
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="h-7 w-7 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="h-7 w-7 rounded-full bg-[var(--sidebar-accent)] text-[var(--sidebar-foreground)] flex items-center justify-center text-[0.6rem] font-semibold shrink-0">
                  {initials}
                </div>
              )}
              <span className="flex-1 min-w-0 text-sm text-[var(--sidebar-foreground)] truncate text-left">
                {user.display_name || user.email}
              </span>
              <ChevronUp className="h-3.5 w-3.5 text-[var(--muted-foreground)] shrink-0" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] transition-colors"
          >
            <div className="h-7 w-7 rounded-full bg-[var(--sidebar-accent)] text-[var(--muted-foreground)] flex items-center justify-center text-[0.6rem] font-semibold shrink-0">
              ?
            </div>
            Sign in
          </button>
        )}
      </div>
    </div>
  );
}
