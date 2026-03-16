"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { SearchBar, type ImageAttachment } from "@/components/search-bar";
import { ChatMessage } from "@/components/chat-message";
import {
  streamAsk,
  streamJobAgent,
  saveJobProfile,
  uploadJobCV,
  fetchStats,
  type SearchResultItem,
  type ChatMessage as ChatMsg,
  type ToolStats,
  type WebSource,
  type UrlSource,
  type AgentScreenshot,
  type AgentStatus,
  type AgentFoundJob,
  type AgentAsk,
} from "@/lib/api";
import { Loader2, User, Bell, Plus, X } from "lucide-react";
import {
  createCalendarEvent,
  createReminder,
  createNote,
  createRoutine,
  getNotifications,
  markNotificationsRead,
  type NotificationItem,
} from "@/lib/routines";
import { LiveVoice, type LiveVoiceHandle } from "@/components/live-voice";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { SignupPrompt } from "@/components/signup-prompt";
import { ChatSidebar } from "@/components/chat-sidebar";
import { fetchConversation } from "@/lib/history";
import { useRouter } from "next/navigation";
import { API_BASE } from "@/lib/config";
import {
  fetchCustomSkills,
  loadLocalCustomSkills,
  customToSkill,
  getEnabledSkills,
  type CustomSkillData,
  type Skill,
} from "@/lib/skills";
import type { SkillPayload } from "@/lib/api";

interface MessageImage {
  base64: string;
  mimeType: string;
  preview: string;
}

interface MessageDocument {
  fileName: string;
  mimeType: string;
}

interface BrowserScreenshotData {
  image: string;
  url: string;
  action: string;
}

interface FoundJobData {
  title: string;
  company: string;
  url: string;
  description?: string;
}

interface AgentStatusData {
  phase: string;
  message: string;
  step?: number;
  action?: string;
  jobs_found?: number;
}

interface AgentQuestionData {
  question: string;
  reason: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SearchResultItem[];
  usedTool?: SearchResultItem;
  images?: MessageImage[];
  documents?: MessageDocument[];
  webSources?: WebSource[];
  urlSources?: UrlSource[];
  mode?: "agentnet" | "web" | "both";
  // Job agent fields
  browserScreenshots?: BrowserScreenshotData[];
  agentStatus?: AgentStatusData;
  foundJobs?: FoundJobData[];
  agentQuestion?: AgentQuestionData;
  jobAgentActive?: boolean;
  // Proactive assistant
  appleActions?: { type: "calendar" | "reminder" | "note"; data: Record<string, string>; status: "created" | "pending" | "error" }[];
  routineSetup?: { name: string; schedule: string; status: "activated" | "pending" | "error" } | null;
  // Artifacts (generated documents, slides, sheets)
  artifact?: { artifact_id: string; artifact_type: string; title: string; files: { name: string; size: number; type: string }[]; slides_count?: number } | null;
  // Activity indicators (searching, thinking, etc.)
  activities?: { action: string; status: string; detail: string }[];
}

// ── Multi-tab types ───────────────────────────────────────────────
interface ChatTab {
  id: string;
  label: string;
  messages: Message[];
  isStreaming: boolean;
  mode: "agentnet" | "web" | "both";
  error: string;
  conversationId?: string;
  createdAt: number;
}

function createTab(label = "New Chat"): ChatTab {
  return {
    id: crypto.randomUUID(),
    label,
    messages: [],
    isStreaming: false,
    mode: "agentnet",
    error: "",
    createdAt: Date.now(),
  };
}

const MAX_TABS = 3;
const TABS_KEY = "agentnet_chat_tabs";

type VoiceState = "connecting" | "listening" | "speaking" | "error";

// ── ChatTabBar ────────────────────────────────────────────────────
function ChatTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: ChatTab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  // Only show the tab bar when there are 2+ tabs
  if (tabs.length < 2) return null;

  return (
    <div className="shrink-0 flex items-center gap-1 border-b border-[var(--border)] bg-[var(--card)] px-3 py-1">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              isActive
                ? "bg-[var(--muted)] text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/50"
            }`}
          >
            {/* Running / streaming indicator */}
            {tab.isStreaming && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            )}
            <span className="max-w-[120px] truncate">{tab.label}</span>
            {tab.isStreaming && (
              <span className="text-[0.6rem] text-emerald-500 font-semibold ml-0.5">Running</span>
            )}
            {/* Close button — only show on hover for non-streaming tabs */}
            {!tab.isStreaming && tabs.length > 1 && (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className="ml-0.5 p-0.5 rounded hover:bg-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </button>
        );
      })}

      {/* New tab button */}
      {tabs.length < MAX_TABS && (
        <button
          type="button"
          onClick={onNew}
          className="p-1 ml-0.5 rounded-md hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          title="New Chat"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Notification bell — shows unread routine run results */
function NotificationBell() {
  const [count, setCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const poll = async () => {
      try {
        const data = await getNotifications();
        setCount(data.unread_count);
        setNotifications(data.notifications);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 60_000);
    return () => clearInterval(interval);
  }, []);

  const handleMarkRead = async () => {
    try {
      await markNotificationsRead();
      setCount(0);
    } catch {}
  };

  return (
    <div className="absolute right-4 top-1/2 -translate-y-1/2">
      <button
        type="button"
        onClick={() => { setOpen(!open); if (!open && count > 0) handleMarkRead(); }}
        className="relative p-1.5 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-red-500 text-[8px] text-white font-bold flex items-center justify-center">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 max-h-80 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl z-50">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-xs text-[var(--muted-foreground)]">No notifications</div>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className="border-b border-[var(--border)] last:border-b-0 p-3 hover:bg-[var(--muted)]/50 transition-colors cursor-pointer">
                <div className="text-[0.7rem] text-[var(--muted-foreground)] mb-1">
                  {n.completed_at ? new Date(n.completed_at).toLocaleString() : ""}
                </div>
                <div className="text-xs text-[var(--foreground)] line-clamp-3">{n.result_preview}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  // ── Multi-tab state ─────────────────────────────────────────────
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");

  // Refs always hold the latest values (updated eagerly, not just at render time)
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);

  // Wrappers that keep refs + state in sync (refs update immediately, state triggers re-render)
  const setActiveTabIdSync = useCallback((id: string) => {
    activeTabIdRef.current = id;
    setActiveTabId(id);
  }, []);
  const setTabsSync = useCallback((updater: ChatTab[] | ((prev: ChatTab[]) => ChatTab[])) => {
    // Compute next state from ref (synchronous), update ref, THEN tell React
    const next = typeof updater === "function" ? updater(tabsRef.current) : updater;
    tabsRef.current = next;
    setTabs(next);
  }, []);

  // Derived state from active tab
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const messages = activeTab?.messages ?? [];
  const isStreaming = activeTab?.isStreaming ?? false;
  const anyTabStreaming = tabs.some((t) => t.isStreaming);
  const backgroundStreaming = anyTabStreaming && !isStreaming; // another tab is streaming
  const mode = activeTab?.mode ?? "agentnet";
  const error = activeTab?.error ?? "";

  const [stats, setStats] = useState<ToolStats | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("connecting");
  const bottomRef = useRef<HTMLDivElement>(null);
  const liveVoiceRef = useRef<LiveVoiceHandle>(null);
  const { user } = useAuth();
  const { frontStyle } = useTheme();
  const router = useRouter();
  const [showSignupPrompt, setShowSignupPrompt] = useState(false);
  const [signupDismissed, setSignupDismissed] = useState(false);
  const conversationCount = useRef(0);
  const restoredRef = useRef(false);
  const customSkillsRef = useRef<CustomSkillData[]>([]);

  const [serverStatus, setServerStatus] = useState<"checking" | "online" | "offline">("checking");

  // Update browser tab title when agent is running
  useEffect(() => {
    if (anyTabStreaming) {
      document.title = "⚡ Agent running… — Iris";
    } else {
      document.title = "Iris — AgentNet";
    }
  }, [anyTabStreaming]);

  // Request notification permission on mount
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Load custom skills once on mount and when user changes
  useEffect(() => {
    async function loadCustomSkills() {
      try {
        if (user) {
          customSkillsRef.current = await fetchCustomSkills();
        } else {
          customSkillsRef.current = loadLocalCustomSkills();
        }
      } catch {
        customSkillsRef.current = loadLocalCustomSkills();
      }
    }
    loadCustomSkills();
  }, [user]);

  // ── Tab helper ──────────────────────────────────────────────────
  const updateTab = useCallback((tabId: string, updater: (tab: ChatTab) => ChatTab) => {
    setTabsSync((prev) => prev.map((t) => (t.id === tabId ? updater(t) : t)));
  }, [setTabsSync]);

  const setMode = useCallback(
    (newMode: "agentnet" | "web" | "both") => {
      const curId = activeTabIdRef.current;
      if (curId) {
        updateTab(curId, (t) => ({ ...t, mode: newMode }));
      }
    },
    [updateTab]
  );

  // ── Restore tabs from sessionStorage on mount ───────────────────
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const saved = sessionStorage.getItem(TABS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { tabs: ChatTab[]; activeTabId: string };
        if (parsed.tabs && parsed.tabs.length > 0) {
          // Reset isStreaming on all tabs — if page reloaded during streaming, it would be stuck forever
          const restoredTabs = parsed.tabs.map((t: ChatTab) => ({ ...t, isStreaming: false }));
          tabsRef.current = restoredTabs;
          setTabs(restoredTabs);
          setActiveTabIdSync(parsed.activeTabId || restoredTabs[0].id);
          return;
        }
      }
    } catch {
      // ignore
    }
    // Default: create one empty tab
    const first = createTab();
    tabsRef.current = [first];
    setTabs([first]);
    setActiveTabIdSync(first.id);
  }, []);

  // ── Save tabs to sessionStorage (debounced to avoid blocking main thread) ──
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!restoredRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        if (tabs.length > 0) {
          const toSave = {
            tabs: tabs.slice(-10).map((t) => ({
              ...t,
              messages: t.messages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                mode: m.mode,
              })),
            })),
            activeTabId,
          };
          sessionStorage.setItem(TABS_KEY, JSON.stringify(toSave));
        } else {
          sessionStorage.removeItem(TABS_KEY);
        }
      } catch {
        // ignore quota errors
      }
    }, 500); // 500ms debounce — writes happen after user stops typing
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [tabs, activeTabId]);

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {});

    const checkHealth = () => {
      fetch(`${API_BASE}/health`)
        .then((r) => setServerStatus(r.ok ? "online" : "offline"))
        .catch(() => setServerStatus("offline"));
    };
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // ── handleNewChat — creates a new tab ───────────────────────────
  const handleNewChat = useCallback(() => {
    setTabsSync((prev) => {
      // If current active tab is empty (no messages, not streaming), reuse it
      const activeT = prev.find((t) => t.id === activeTabIdRef.current);
      if (activeT && activeT.messages.length === 0 && !activeT.isStreaming) {
        return prev; // already on an empty tab
      }
      if (prev.length >= MAX_TABS) {
        // Replace the oldest non-streaming tab
        const oldest = [...prev].filter((t) => !t.isStreaming).sort((a, b) => a.createdAt - b.createdAt)[0];
        if (oldest) {
          const newTab = createTab();
          setActiveTabIdSync(newTab.id);
          return prev.map((t) => (t.id === oldest.id ? newTab : t));
        }
        return prev;
      }
      const newTab = createTab();
      setActiveTabIdSync(newTab.id);
      return [...prev, newTab];
    });
  }, [setActiveTabIdSync, setTabsSync]);

  // ── handleLoadConversation — open in new tab or reuse ───────────
  const handleLoadConversation = useCallback(async (id: string) => {
    // Check if already open in a tab
    const existing = tabsRef.current.find((t) => t.conversationId === id);
    if (existing) {
      setActiveTabIdSync(existing.id);
      return;
    }

    try {
      const conv = await fetchConversation(id);
      const loaded: Message[] = conv.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      }));

      const firstUserMsg = loaded.find((m) => m.role === "user");
      const label = firstUserMsg ? firstUserMsg.content.slice(0, 30) : "Loaded Chat";

      setTabsSync((prev) => {
        // If active tab is empty, reuse it
        const activeT = prev.find((t) => t.id === activeTabIdRef.current);
        if (activeT && activeT.messages.length === 0 && !activeT.isStreaming) {
          const updated: ChatTab = { ...activeT, messages: loaded, label, conversationId: id, error: "" };
          return prev.map((t) => (t.id === activeT.id ? updated : t));
        }
        // Otherwise create new tab
        if (prev.length >= MAX_TABS) {
          const oldest = [...prev].filter((t) => !t.isStreaming).sort((a, b) => a.createdAt - b.createdAt)[0];
          if (oldest) {
            const newTab: ChatTab = { ...createTab(label), messages: loaded, conversationId: id };
            setActiveTabIdSync(newTab.id);
            return prev.map((t) => (t.id === oldest.id ? newTab : t));
          }
          return prev;
        }
        const newTab: ChatTab = { ...createTab(label), messages: loaded, conversationId: id };
        setActiveTabIdSync(newTab.id);
        return [...prev, newTab];
      });
    } catch {
      const curTabId = activeTabIdRef.current;
      if (curTabId) {
        updateTab(curTabId, (t) => ({ ...t, error: "Could not load conversation" }));
      }
    }
  }, [updateTab, setActiveTabIdSync, setTabsSync]);

  // ── handleCloseTab ──────────────────────────────────────────────
  const handleCloseTab = useCallback((tabId: string) => {
    setTabsSync((prev) => {
      const tab = prev.find((t) => t.id === tabId);
      if (!tab) return prev;

      // If this is the only tab, replace with a fresh one
      if (prev.length === 1) {
        const fresh = createTab();
        setActiveTabIdSync(fresh.id);
        return [fresh];
      }

      const remaining = prev.filter((t) => t.id !== tabId);
      // If closing the active tab, switch to the nearest
      if (tabId === activeTabIdRef.current) {
        const idx = prev.findIndex((t) => t.id === tabId);
        const nextIdx = Math.min(idx, remaining.length - 1);
        setActiveTabIdSync(remaining[nextIdx].id);
      }
      return remaining;
    });
  }, [setActiveTabIdSync, setTabsSync]);

  // ── handleSend — tab-scoped ─────────────────────────────────────
  const handleSend = useCallback(
    async (query: string, attachments?: ImageAttachment[]) => {
      // Read from refs (eagerly updated by setTabsSync / setActiveTabIdSync)
      const tabId = activeTabIdRef.current;
      const currentTab = tabsRef.current.find((t) => t.id === tabId);
      if (!currentTab) { console.warn("handleSend: no active tab found", tabId, "tabs:", tabsRef.current.map(t => t.id.slice(0,8))); return; }
      if (currentTab.isStreaming) { console.warn("handleSend: tab is already streaming", tabId); return; }

      const tabMode = currentTab.mode;
      const tabMessages = currentTab.messages;

      updateTab(tabId, (t) => ({ ...t, error: "" }));

      // Set temporary label (overridden by tab_title SSE event from backend)
      if (tabMessages.length === 0) {
        updateTab(tabId, (t) => ({ ...t, label: "Thinking…" }));
      }

      const imageAttachments = attachments?.filter((a) => a.type === "image" || a.mimeType.startsWith("image/")) ?? [];
      const docAttachments = attachments?.filter((a) => a.type === "document" && !a.mimeType.startsWith("image/")) ?? [];

      const msgImages: MessageImage[] | undefined = imageAttachments.length > 0
        ? imageAttachments.map((a) => ({ base64: a.base64, mimeType: a.mimeType, preview: a.preview }))
        : undefined;

      const msgDocs: MessageDocument[] | undefined = docAttachments.length > 0
        ? docAttachments.map((a) => ({ fileName: a.fileName || "document", mimeType: a.mimeType }))
        : undefined;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: query,
        images: msgImages,
        documents: msgDocs,
      };

      const assistantId = crypto.randomUUID();
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        sources: [],
        mode: tabMode,
      };

      updateTab(tabId, (t) => ({
        ...t,
        messages: [...t.messages, userMsg, assistantMsg],
        isStreaming: true,
      }));

      const history: ChatMsg[] = tabMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const apiImages = msgImages?.map((img) => ({
        base64: img.base64,
        mime_type: img.mimeType,
      }));

      const apiDocs = docAttachments.length > 0
        ? docAttachments.map((d) => ({
            base64: d.base64,
            mime_type: d.mimeType,
            filename: d.fileName || "document",
            text_content: d.textContent || "",
          }))
        : undefined;

      // Helper to update a specific message in this tab
      const updateMsg = (msgId: string, updater: (m: Message) => Message) => {
        updateTab(tabId, (t) => ({
          ...t,
          messages: t.messages.map((m) => (m.id === msgId ? updater(m) : m)),
        }));
      };

      // Gather enabled skills (custom + integration) to send as instructions
      const customPayloads: SkillPayload[] = customSkillsRef.current
        .filter((s) => s.enabled && s.instructions?.trim())
        .map((s) => ({ id: s.id, name: s.name, instructions: s.instructions }));
      const integrationPayloads: SkillPayload[] = getEnabledSkills()
        .filter((s) => s.category === "integration" && s.instructions?.trim())
        .map((s) => ({ id: s.id, name: s.name, instructions: s.instructions! }));
      const enabledSkillPayloads = [...customPayloads, ...integrationPayloads];

      let finalContent = "";
      try {
        for await (const msg of streamAsk(query, history, apiImages, tabMode, apiDocs, enabledSkillPayloads.length > 0 ? enabledSkillPayloads : undefined)) {
          if (msg.type === "token") {
            finalContent += msg.content;
            updateMsg(assistantId, (m) => ({ ...m, content: m.content + msg.content }));
          } else if (msg.type === "sources") {
            updateMsg(assistantId, (m) => ({ ...m, sources: msg.sources }));
          } else if (msg.type === "used_tool") {
            updateMsg(assistantId, (m) => ({ ...m, usedTool: msg.tool }));
          } else if (msg.type === "web_sources") {
            updateMsg(assistantId, (m) => ({ ...m, webSources: msg.sources }));
          } else if (msg.type === "url_sources") {
            updateMsg(assistantId, (m) => ({ ...m, urlSources: msg.sources }));
          } else if (msg.type === "artifact") {
            updateMsg(assistantId, (m) => ({
              ...m,
              artifact: {
                artifact_id: (msg as { artifact_id: string }).artifact_id,
                artifact_type: (msg as { artifact_type: string }).artifact_type,
                title: (msg as { title: string }).title,
                files: (msg as { files: { name: string; size: number; type: string }[] }).files,
                slides_count: (msg as { slides_count?: number }).slides_count,
              },
            }));
          } else if (msg.type === "activity") {
            const act = msg as { action: string; status: string; detail: string };
            updateMsg(assistantId, (m) => {
              const activities = [...(m.activities || [])];
              // Update existing activity of same action, or add new
              const idx = activities.findIndex((a) => a.action === act.action);
              if (idx >= 0) {
                activities[idx] = { action: act.action, status: act.status, detail: act.detail };
              } else {
                activities.push({ action: act.action, status: act.status, detail: act.detail });
              }
              return { ...m, activities };
            });
          } else if (msg.type === "tab_title") {
            const title = (msg as { title: string }).title;
            if (title) {
              updateTab(tabId, (t) => ({ ...t, label: title }));
            }
          }
        }
        if (voiceActive && finalContent) {
          liveVoiceRef.current?.sendText(finalContent);
        }

        // Check if LLM saved a job profile
        const profileMatch = finalContent.match(/\[JOB_PROFILE\]([\s\S]*?)\[\/JOB_PROFILE\]/);
        if (profileMatch) {
          try {
            const profileData = JSON.parse(profileMatch[1].trim());
            await saveJobProfile(profileData);
          } catch (profileErr) {
            console.error("Failed to save job profile:", profileErr);
          }
        }

        // Check if LLM triggered the job agent
        const agentMatch = finalContent.match(/\[JOB_AGENT_START\]([\s\S]*?)\[\/JOB_AGENT_START\]/);
        if (agentMatch) {
          try {
            const agentParams = JSON.parse(agentMatch[1].trim());

            // Mark message as having an active job agent
            updateMsg(assistantId, (m) => ({
              ...m,
              jobAgentActive: true,
              browserScreenshots: [],
              foundJobs: [],
            }));

            // Stream job agent events into the same message
            for await (const evt of streamJobAgent(agentParams)) {
              if (evt.type === "browser_screenshot") {
                updateMsg(assistantId, (m) => ({
                  ...m,
                  browserScreenshots: [
                    ...(m.browserScreenshots || []),
                    { image: evt.image, url: evt.url, action: evt.action },
                  ],
                }));
              } else if (evt.type === "agent_status") {
                updateMsg(assistantId, (m) => ({
                  ...m,
                  agentStatus: {
                    phase: evt.phase,
                    message: evt.message,
                    step: evt.step,
                    action: evt.action,
                    jobs_found: evt.jobs_found,
                  },
                  jobAgentActive: evt.phase !== "done" && evt.phase !== "error",
                }));
              } else if (evt.type === "agent_found_job") {
                updateMsg(assistantId, (m) => ({
                  ...m,
                  foundJobs: [
                    ...(m.foundJobs || []),
                    { title: evt.title, company: evt.company, url: evt.url, description: evt.description },
                  ],
                }));
              } else if (evt.type === "agent_ask") {
                updateMsg(assistantId, (m) => ({
                  ...m,
                  agentQuestion: { question: evt.question, reason: evt.reason },
                  jobAgentActive: false,
                }));
              } else if (evt.type === "agent_error") {
                updateMsg(assistantId, (m) => ({
                  ...m,
                  agentStatus: { phase: "error", message: evt.message },
                  jobAgentActive: false,
                }));
              }
            }
          } catch (agentErr) {
            console.error("Job agent error:", agentErr);
          }
        }

        // Auto-execute Apple actions from LLM response
        const calendarMatches = [...finalContent.matchAll(/\[APPLE_CALENDAR\]([\s\S]*?)\[\/APPLE_CALENDAR\]/g)];
        const reminderMatches = [...finalContent.matchAll(/\[APPLE_REMINDER\]([\s\S]*?)\[\/APPLE_REMINDER\]/g)];
        const noteMatches = [...finalContent.matchAll(/\[APPLE_NOTE\]([\s\S]*?)\[\/APPLE_NOTE\]/g)];

        const allAppleActions: { type: "calendar" | "reminder" | "note"; data: Record<string, string>; status: "pending" }[] = [];
        for (const m of calendarMatches) {
          try { allAppleActions.push({ type: "calendar", data: JSON.parse(m[1].trim()), status: "pending" }); } catch {}
        }
        for (const m of reminderMatches) {
          try { allAppleActions.push({ type: "reminder", data: JSON.parse(m[1].trim()), status: "pending" }); } catch {}
        }
        for (const m of noteMatches) {
          try { allAppleActions.push({ type: "note", data: JSON.parse(m[1].trim()), status: "pending" }); } catch {}
        }

        if (allAppleActions.length > 0) {
          // Show pending state
          updateMsg(assistantId, (m) => ({ ...m, appleActions: allAppleActions as Message["appleActions"] }));

          // Execute each action
          for (let i = 0; i < allAppleActions.length; i++) {
            const action = allAppleActions[i];
            try {
              if (action.type === "calendar") {
                await createCalendarEvent({
                  title: action.data.title || "",
                  start: action.data.start || "",
                  end: action.data.end || "",
                  calendar_name: action.data.calendar_name || "",
                  notes: action.data.notes || "",
                  location: action.data.location || "",
                });
              } else if (action.type === "reminder") {
                await createReminder({
                  name: action.data.name || "",
                  due_date: action.data.due_date || "",
                  notes: action.data.notes || "",
                  list_name: action.data.list_name || "",
                });
              } else if (action.type === "note") {
                await createNote({
                  title: action.data.title || "",
                  body: action.data.body || "",
                  folder: action.data.folder || "Notes",
                });
              }
              // Update to "created"
              updateTab(tabId, (t) => ({
                ...t,
                messages: t.messages.map((msg) => {
                  if (msg.id !== assistantId) return msg;
                  const updated = [...(msg.appleActions || [])];
                  updated[i] = { ...updated[i], status: "created" };
                  return { ...msg, appleActions: updated };
                }),
              }));
            } catch (err) {
              console.error("Apple action failed:", err);
              updateTab(tabId, (t) => ({
                ...t,
                messages: t.messages.map((msg) => {
                  if (msg.id !== assistantId) return msg;
                  const updated = [...(msg.appleActions || [])];
                  updated[i] = { ...updated[i], status: "error" };
                  return { ...msg, appleActions: updated };
                }),
              }));
            }
          }
        }

        // Auto-execute routine setup
        const routineMatch = finalContent.match(/\[ROUTINE_SETUP\]([\s\S]*?)\[\/ROUTINE_SETUP\]/);
        if (routineMatch) {
          try {
            const routineData = JSON.parse(routineMatch[1].trim());
            const humanSchedule = routineData.schedule_type === "cron"
              ? `Cron: ${routineData.schedule_value}`
              : routineData.schedule_type === "interval"
              ? `Every ${routineData.schedule_value}`
              : routineData.schedule_value;

            updateMsg(assistantId, (m) => ({
              ...m,
              routineSetup: { name: routineData.name, schedule: humanSchedule, status: "pending" },
            }));

            await createRoutine({
              name: routineData.name,
              prompt: routineData.prompt,
              schedule_type: routineData.schedule_type || "cron",
              schedule_value: routineData.schedule_value || "",
            });

            updateMsg(assistantId, (m) => ({
              ...m,
              routineSetup: { name: routineData.name, schedule: humanSchedule, status: "activated" },
            }));
          } catch (routineErr) {
            console.error("Routine setup failed:", routineErr);
            updateTab(tabId, (t) => ({
              ...t,
              messages: t.messages.map((msg) =>
                msg.id === assistantId && msg.routineSetup
                  ? { ...msg, routineSetup: { ...msg.routineSetup, status: "error" as const } }
                  : msg
              ),
            }));
          }
        }
      } catch {
        updateTab(tabId, (t) => ({
          ...t,
          error: "Could not connect to AgentNet. Make sure the server is running.",
          messages: t.messages.filter((m) => m.id !== assistantId),
        }));
      } finally {
        updateTab(tabId, (t) => ({ ...t, isStreaming: false }));
        conversationCount.current += 1;
        if (!user && !signupDismissed && conversationCount.current >= 2) {
          setShowSignupPrompt(true);
        }

        // Notify user if the response needs their input (choice options or agent question)
        // and they're on a different tab or the browser isn't focused
        if (document.hidden || tabId !== activeTabId) {
          const finalTab = tabs.find((t) => t.id === tabId);
          const lastMsg = finalTab?.messages[finalTab.messages.length - 1];
          const hasChoices = lastMsg?.content && /^[A-E]\)\s/m.test(lastMsg.content);
          const hasAgentQ = lastMsg?.agentQuestion;
          if (hasChoices || hasAgentQ) {
            try {
              if (Notification.permission === "granted") {
                new Notification("Iris needs your input", {
                  body: hasAgentQ ? hasAgentQ.question : "Please choose an option to continue.",
                  icon: "/iris-logo.png",
                  tag: "iris-input-needed",
                });
              } else if (Notification.permission !== "denied") {
                Notification.requestPermission();
              }
            } catch {}
          }
        }

        // Auto-extract memories from conversation (fire-and-forget, only if logged in)
        if (user) {
          try {
            // Read the tab's latest messages for memory extraction
            const latestTab = tabs.find((t) => t.id === tabId);
            const convMessages = latestTab?.messages ?? tabMessages;
            const convText = convMessages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .slice(-4)
              .map((m) => `${m.role}: ${m.content}`)
              .join("\n");
            if (convText.length > 100) {
              fetch(`${API_BASE}/v1/memories/extract`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversation_text: convText }),
              }).catch(() => {});
            }
          } catch {
            // fire-and-forget
          }
        }
      }
    },
    [updateTab, voiceActive, user, signupDismissed]
  );

  const hasMessages = messages.length > 0;

  // Voice glow styles
  const voiceGlowColor =
    voiceState === "speaking"
      ? "rgba(139,92,246,0.55)"
      : "rgba(99,102,241,0.55)";

  return (
    <div className="h-screen flex bg-[var(--background)] relative overflow-hidden">

      {/* Persistent left sidebar */}
      <ChatSidebar
        onNewChat={handleNewChat}
        onLoadConversation={handleLoadConversation}
        isStreaming={isStreaming}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Page-level voice glow ring */}
        {voiceActive && (
          <div
            className="fixed inset-0 pointer-events-none z-50 transition-all duration-700"
            style={{
              boxShadow: `inset 0 0 0 2.5px ${voiceGlowColor}, inset 0 0 120px ${voiceGlowColor.replace("0.55", "0.08")}`,
              borderRadius: 0,
            }}
          />
        )}

        {/* LiveVoice side-effect component */}
        {voiceActive && (
          <LiveVoice
            ref={liveVoiceRef}
            onTranscript={handleSend}
            onStateChange={setVoiceState}
            onClose={() => setVoiceActive(false)}
          />
        )}

        {/* Landing */}
        {!hasMessages && (
          <div className={`flex-1 flex flex-col items-center px-3 sm:px-4 pb-24 sm:pb-32 ${
            frontStyle === "chatgpt" ? "justify-center" : "justify-start pt-4"
          }`}>
            {/* Iris flower logo — only in Claude style */}
            {frontStyle === "claude" && (
              <button
                type="button"
                onClick={() => setVoiceActive((v) => !v)}
                className="group relative mb-8 flex flex-col items-center gap-3"
                title={voiceActive ? "Stop voice mode" : "Talk to Iris"}
              >
                <div className="relative">
                  {voiceActive && (
                    <span className={`absolute inset-0 rounded-full blur-xl opacity-60 animate-pulse ${
                      voiceState === "speaking" ? "bg-violet-400" : "bg-indigo-400"
                    }`} style={{ transform: "scale(1.6)" }} />
                  )}
                  <img
                    src="/iris-logo.png"
                    alt="Iris"
                    className={`relative h-24 sm:h-36 w-auto object-contain transition-all duration-500 ${
                      voiceActive ? "drop-shadow-[0_0_16px_rgba(139,92,246,0.7)]" : "opacity-90 group-hover:opacity-100"
                    }`}
                  />
                </div>
                <span className={`text-[0.65rem] font-medium tracking-[0.18em] uppercase transition-colors ${
                  voiceActive
                    ? voiceState === "speaking" ? "text-violet-500" : "text-indigo-500"
                    : "text-[var(--muted-foreground)] group-hover:text-indigo-400"
                }`}>
                  {voiceActive
                    ? voiceState === "connecting" ? "Connecting…"
                      : voiceState === "speaking" ? "Speaking"
                      : "Listening"
                    : "Iris"}
                </span>
              </button>
            )}

            <h1
              className={`text-[var(--foreground)] tracking-tight mb-8 sm:mb-12 text-center ${
                frontStyle === "chatgpt"
                  ? "text-2xl sm:text-3xl md:text-4xl font-semibold"
                  : "text-3xl sm:text-4xl md:text-5xl font-light"
              }`}
              style={frontStyle === "claude" ? { fontFamily: "'Times New Roman', Georgia, serif" } : undefined}
            >
              {frontStyle === "chatgpt" ? "What can I help with?" : "What can I do for you?"}
            </h1>
            <SearchBar onSend={handleSend} isStreaming={isStreaming} light mode={mode} onModeChange={setMode} />
          </div>
        )}

        {/* Chat view */}
        {hasMessages && (
          <>
            {/* Slim top bar with Iris branding + notification bell */}
            <div className="shrink-0 px-4 py-3 flex items-center justify-center relative">
              <button
                type="button"
                onClick={() => setVoiceActive((v) => !v)}
                className="group relative flex items-center gap-2"
                title={voiceActive ? "Stop voice mode" : "Talk to Iris"}
              >
                <div className="relative">
                  {voiceActive && (
                    <span className={`absolute inset-0 rounded-full blur-md opacity-70 animate-pulse ${
                      voiceState === "speaking" ? "bg-violet-400" : "bg-indigo-400"
                    }`} style={{ transform: "scale(2)" }} />
                  )}
                  <img
                    src="/iris-logo.png"
                    alt="Iris"
                    className={`relative h-6 w-auto object-contain transition-all ${
                      voiceActive ? "drop-shadow-[0_0_8px_rgba(139,92,246,0.8)]" : "opacity-70 group-hover:opacity-100"
                    }`}
                  />
                </div>
                <span className={`text-xs font-semibold tracking-[0.15em] uppercase transition-colors ${
                  voiceActive ? voiceState === "speaking" ? "text-violet-500" : "text-indigo-500"
                  : "text-[var(--muted-foreground)] group-hover:text-indigo-400"
                }`}>
                  {voiceActive
                    ? voiceState === "speaking" ? "Speaking" : voiceState === "connecting" ? "Connecting…" : "Listening"
                    : "Iris"}
                </span>
                {voiceActive && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${
                      voiceState === "speaking" ? "bg-violet-500" : "bg-indigo-500"
                    }`} />
                    <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                      voiceState === "speaking" ? "bg-violet-500" : "bg-indigo-500"
                    }`} />
                  </span>
                )}
              </button>
              {/* Background streaming indicator — another tab has an agent running */}
              {backgroundStreaming && !voiceActive && (
                <span className="relative flex h-1.5 w-1.5 ml-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-500" />
                </span>
              )}
              {/* Notification Bell */}
              <NotificationBell />
            </div>

            {/* Progress bar when any agent is running */}
            {anyTabStreaming && (
              <div className="shrink-0 h-0.5 w-full overflow-hidden bg-[var(--border)]">
                <div className="h-full w-1/3 bg-indigo-500/70 rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]" />
              </div>
            )}

            {/* Tab bar — only visible with 2+ tabs */}
            <ChatTabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelect={setActiveTabIdSync}
              onClose={handleCloseTab}
              onNew={handleNewChat}
            />

            <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-6 sm:py-8">
              <div className="max-w-2xl mx-auto">
                {messages.map((msg, i) => (
                  <ChatMessage
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    sources={msg.sources}
                    usedTool={msg.usedTool}
                    images={msg.images}
                    documents={msg.documents}
                    webSources={msg.webSources}
                    urlSources={msg.urlSources}
                    mode={msg.mode}
                    isStreaming={
                      isStreaming &&
                      msg.role === "assistant" &&
                      i === messages.length - 1
                    }
                    onSendChoice={handleSend}
                    fetchMoreContext={{
                      history: messages.slice(0, i + 1).map((m) => ({ role: m.role, content: m.content })),
                      mode,
                    }}
                    browserScreenshots={msg.browserScreenshots}
                    agentStatus={msg.agentStatus}
                    foundJobs={msg.foundJobs}
                    agentQuestion={msg.agentQuestion}
                    jobAgentActive={msg.jobAgentActive}
                    appleActions={msg.appleActions}
                    routineSetup={msg.routineSetup}
                    artifact={msg.artifact}
                    activities={msg.activities}
                  />
                ))}

                {isStreaming &&
                  messages[messages.length - 1]?.content === "" && (
                    <div className="flex items-center gap-2 text-[var(--muted-foreground)] ml-10">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span className="text-xs">Thinking...</span>
                    </div>
                  )}

                {error && (
                  <div className="text-center py-4">
                    <span className="text-xs text-[var(--muted-foreground)]">{error}</span>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </div>

            <div className="shrink-0 px-4 py-3">
              <div className="max-w-2xl mx-auto">
                <SearchBar onSend={handleSend} isStreaming={isStreaming} compact mode={mode} onModeChange={setMode} />
              </div>
            </div>
          </>
        )}

        {/* Stats bar */}
        {!hasMessages && (
          <div className="shrink-0 py-3 flex justify-center items-center gap-6 sm:gap-10 text-xs text-[var(--muted-foreground)]">
            <span
              className={`inline-block h-2 w-2 rounded-sm ${
                serverStatus === "online"
                  ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]"
                  : serverStatus === "offline"
                  ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]"
                  : "bg-yellow-500 animate-pulse"
              }`}
              title={serverStatus === "online" ? "Server online" : serverStatus === "offline" ? "Server offline" : "Checking…"}
            />
            <span>
              <span className="text-[var(--foreground)] font-semibold tabular-nums">{stats?.tools ?? "--"}</span> tools
            </span>
            <span>
              <span className="text-[var(--foreground)] font-semibold tabular-nums">{stats?.actions ?? "--"}</span> actions
            </span>
            <span>
              <span className="text-[var(--foreground)] font-semibold tabular-nums">{stats?.categories ?? "--"}</span> categories
            </span>
          </div>
        )}
      </div>

      {/* Signup prompt modal */}
      {showSignupPrompt && (
        <SignupPrompt
          onClose={() => {
            setShowSignupPrompt(false);
            setSignupDismissed(true);
          }}
          onGoToSignup={() => {
            setShowSignupPrompt(false);
            window.location.href = `${API_BASE}/v1/auth/google/start`;
          }}
        />
      )}
    </div>
  );
}
