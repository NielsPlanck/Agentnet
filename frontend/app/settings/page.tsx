"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useTheme, type ColorMode, type ChatFont, type FrontStyle } from "@/lib/theme";
import {
  fetchStats,
  type ToolStats,
} from "@/lib/api";
import {
  updateProfile,
  changePassword,
  fetchConnections,
  clearHistory,
  exportData,
  type OAuthConnectionInfo,
} from "@/lib/settings";
import {
  fetchConversations,
} from "@/lib/history";
import {
  fetchCustomSkills,
  createCustomSkill,
  updateCustomSkill,
  deleteCustomSkill,
  shareSkill,
  importSkillByCode,
  importSkillFromJSON,
  addLocalCustomSkill,
  updateLocalCustomSkill,
  deleteLocalCustomSkill,
  loadLocalCustomSkills,
  type CustomSkillData,
  type SkillExportData,
} from "@/lib/skills";
import {
  ArrowLeft,
  Sun,
  Moon,
  Monitor,
  Check,
  Loader2,
  Download,
  Trash2,
  LogIn,
  Brain,
  Pencil,
  X,
  Search,
  Zap,
  Plus,
  Share2,
  Copy,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";

type Tab = "general" | "account" | "privacy" | "usage" | "connectors" | "memory" | "skills";

interface MemoryItem {
  id: string;
  category: string;
  key: string;
  content: string;
  source: string;
  importance: number;
  last_used_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const ICON_OPTIONS = [
  "Zap", "Globe", "Code2", "TrendingUp", "FileText", "Mail", "Cloud",
  "BookOpen", "MessageCircle", "Search", "Bell", "Briefcase", "Inbox",
  "CalendarCheck", "GitBranch", "Star", "Heart", "Shield", "Terminal", "Palette",
];

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const { colorMode, chatFont, frontStyle, setColorMode, setChatFont, setFrontStyle } = useTheme();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("general");

  // General tab state
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  // Account tab state
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);
  const [changingPw, setChangingPw] = useState(false);

  // Connectors tab state
  const [connections, setConnections] = useState<OAuthConnectionInfo[]>([]);
  const [loadingConns, setLoadingConns] = useState(false);

  // Usage tab state
  const [stats, setStats] = useState<ToolStats | null>(null);
  const [convCount, setConvCount] = useState<number | null>(null);

  // Privacy tab state
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Memory tab state
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoryTotal, setMemoryTotal] = useState(0);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [memoryFilter, setMemoryFilter] = useState<string>("");
  const [memorySearch, setMemorySearch] = useState("");
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editKey, setEditKey] = useState("");
  const [editCategory, setEditCategory] = useState("");

  // Skills tab state
  const [customSkills, setCustomSkills] = useState<CustomSkillData[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [skillView, setSkillView] = useState<"list" | "create" | "edit" | "import">("list");
  const [editingSkill, setEditingSkill] = useState<CustomSkillData | null>(null);
  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");
  const [skillIcon, setSkillIcon] = useState("Zap");
  const [skillInstructions, setSkillInstructions] = useState("");
  const [skillMcpUrl, setSkillMcpUrl] = useState("");
  const [savingSkill, setSavingSkill] = useState(false);
  const [skillError, setSkillError] = useState("");
  const [importCode, setImportCode] = useState("");
  const [importJson, setImportJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [shareData, setShareData] = useState<SkillExportData | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || "");
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === "connectors" && user) {
      setLoadingConns(true);
      fetchConnections()
        .then(setConnections)
        .catch(() => {})
        .finally(() => setLoadingConns(false));
    }
  }, [activeTab, user]);

  // Load skills
  const loadSkills = useCallback(async () => {
    setLoadingSkills(true);
    try {
      if (user) {
        const skills = await fetchCustomSkills();
        setCustomSkills(skills);
      } else {
        setCustomSkills(loadLocalCustomSkills());
      }
    } catch {
      setCustomSkills(loadLocalCustomSkills());
    } finally {
      setLoadingSkills(false);
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === "skills") {
      loadSkills();
    }
  }, [activeTab, loadSkills]);

  const loadMemories = useCallback(async (cat?: string) => {
    setLoadingMemories(true);
    try {
      const params = new URLSearchParams();
      if (cat) params.set("category", cat);
      params.set("limit", "100");
      const res = await fetch(`/v1/memories/?${params}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
        setMemoryTotal(data.total || 0);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMemories(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "memory" && user) {
      loadMemories(memoryFilter || undefined);
    }
  }, [activeTab, user, memoryFilter, loadMemories]);

  const handleDeleteMemory = useCallback(async (id: string) => {
    try {
      await fetch(`/v1/memories/${id}`, { method: "DELETE", credentials: "include" });
      setMemories((prev) => prev.filter((m) => m.id !== id));
      setMemoryTotal((prev) => prev - 1);
    } catch {
      // ignore
    }
  }, []);

  const handleSaveMemory = useCallback(async (id: string) => {
    try {
      await fetch(`/v1/memories/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: editKey, content: editContent, category: editCategory }),
      });
      setMemories((prev) =>
        prev.map((m) => (m.id === id ? { ...m, key: editKey, content: editContent, category: editCategory } : m))
      );
      setEditingMemory(null);
    } catch {
      // ignore
    }
  }, [editKey, editContent, editCategory]);

  const handleSearchMemories = useCallback(async () => {
    if (!memorySearch.trim()) {
      loadMemories(memoryFilter || undefined);
      return;
    }
    setLoadingMemories(true);
    try {
      const res = await fetch(`/v1/memories/search?q=${encodeURIComponent(memorySearch)}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setMemories(data.results || []);
        setMemoryTotal(data.results?.length || 0);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMemories(false);
    }
  }, [memorySearch, memoryFilter, loadMemories]);

  useEffect(() => {
    if (activeTab === "usage") {
      fetchStats().then(setStats).catch(() => {});
      if (user) {
        fetchConversations(1, 0)
          .then((d) => setConvCount(d.total))
          .catch(() => {});
      }
    }
  }, [activeTab, user]);

  const handleSaveName = useCallback(async () => {
    if (!displayName.trim()) return;
    setSavingName(true);
    try {
      await updateProfile({ display_name: displayName.trim() });
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
      await refresh();
    } catch {
      // ignore
    } finally {
      setSavingName(false);
    }
  }, [displayName, refresh]);

  const handleChangePassword = useCallback(async () => {
    setPwError("");
    setPwSuccess(false);
    if (newPw.length < 6) {
      setPwError("Password must be at least 6 characters");
      return;
    }
    setChangingPw(true);
    try {
      await changePassword(currentPw, newPw);
      setPwSuccess(true);
      setCurrentPw("");
      setNewPw("");
    } catch (e: unknown) {
      setPwError(e instanceof Error ? e.message : "Failed to change password");
    } finally {
      setChangingPw(false);
    }
  }, [currentPw, newPw]);

  const handleClearHistory = useCallback(async () => {
    if (!confirm("This will permanently delete all your chat history. Continue?")) return;
    setClearing(true);
    try {
      await clearHistory();
      setConvCount(0);
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportData();
    } catch {
      // ignore
    } finally {
      setExporting(false);
    }
  }, []);

  // ── Skill handlers ──
  const resetSkillForm = () => {
    setSkillName("");
    setSkillDesc("");
    setSkillIcon("Zap");
    setSkillInstructions("");
    setSkillMcpUrl("");
    setSkillError("");
    setEditingSkill(null);
  };

  const handleCreateSkill = async () => {
    if (!skillName.trim()) { setSkillError("Name is required"); return; }
    setSavingSkill(true);
    setSkillError("");
    try {
      const payload = {
        name: skillName.trim(),
        description: skillDesc.trim(),
        icon: skillIcon,
        instructions: skillInstructions,
        mcp_server_url: skillMcpUrl.trim() || undefined,
      };
      if (user) {
        const created = await createCustomSkill(payload);
        setCustomSkills((prev) => [...prev, created]);
      } else {
        const created = addLocalCustomSkill(payload);
        setCustomSkills((prev) => [...prev, created]);
      }
      resetSkillForm();
      setSkillView("list");
    } catch (e: unknown) {
      setSkillError(e instanceof Error ? e.message : "Failed to create skill");
    } finally {
      setSavingSkill(false);
    }
  };

  const handleUpdateSkill = async () => {
    if (!editingSkill || !skillName.trim()) { setSkillError("Name is required"); return; }
    setSavingSkill(true);
    setSkillError("");
    try {
      const payload = {
        name: skillName.trim(),
        description: skillDesc.trim(),
        icon: skillIcon,
        instructions: skillInstructions,
        mcp_server_url: skillMcpUrl.trim() || null,
      };
      if (user) {
        const updated = await updateCustomSkill(editingSkill.id, payload);
        setCustomSkills((prev) => prev.map((s) => s.id === updated.id ? updated : s));
      } else {
        updateLocalCustomSkill(editingSkill.id, payload);
        setCustomSkills(loadLocalCustomSkills());
      }
      resetSkillForm();
      setSkillView("list");
    } catch (e: unknown) {
      setSkillError(e instanceof Error ? e.message : "Failed to update skill");
    } finally {
      setSavingSkill(false);
    }
  };

  const handleDeleteSkill = async (id: string) => {
    if (!confirm("Delete this skill?")) return;
    try {
      if (user) {
        await deleteCustomSkill(id);
      } else {
        deleteLocalCustomSkill(id);
      }
      setCustomSkills((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // ignore
    }
  };

  const handleShareSkill = async (id: string) => {
    try {
      const data = await shareSkill(id);
      setShareData(data);
    } catch {
      // ignore
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setSkillError("");
    try {
      if (importCode.trim()) {
        const imported = await importSkillByCode(importCode.trim());
        setCustomSkills((prev) => [...prev, imported]);
        setImportCode("");
        setSkillView("list");
      } else if (importJson.trim()) {
        const parsed = JSON.parse(importJson.trim()) as SkillExportData;
        const imported = await importSkillFromJSON(parsed);
        setCustomSkills((prev) => [...prev, imported]);
        setImportJson("");
        setSkillView("list");
      } else {
        setSkillError("Enter a share code or paste skill JSON");
      }
    } catch (e: unknown) {
      setSkillError(e instanceof Error ? e.message : "Failed to import skill");
    } finally {
      setImporting(false);
    }
  };

  const handleToggleSkill = async (skill: CustomSkillData) => {
    const newEnabled = !skill.enabled;
    try {
      if (user) {
        await updateCustomSkill(skill.id, { enabled: newEnabled });
      } else {
        updateLocalCustomSkill(skill.id, { enabled: newEnabled });
      }
      setCustomSkills((prev) => prev.map((s) => s.id === skill.id ? { ...s, enabled: newEnabled } : s));
    } catch {
      // ignore
    }
  };

  const handleCopyShareCode = (code: string) => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyJson = (data: SkillExportData) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Not logged in view
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--background)] px-4">
        <div className="text-center max-w-sm">
          <LogIn className="h-10 w-10 text-[var(--muted-foreground)] mx-auto mb-4 opacity-40" />
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-2">Sign in to access Settings</h2>
          <p className="text-sm text-[var(--muted-foreground)] mb-6">
            Create an account or sign in to manage your profile, appearance, and privacy settings.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={() => router.push("/login")}
              className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              Back to chat
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "account", label: "Account" },
    { id: "skills", label: "Skills" },
    { id: "memory", label: "Memory" },
    { id: "privacy", label: "Privacy" },
    { id: "usage", label: "Usage" },
    { id: "connectors", label: "Connectors" },
  ];

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Minimal back button */}
      <div className="fixed top-4 left-4 z-10">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-[var(--muted)] transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-10 pb-16">
        {/* Title — large, like Claude */}
        <h1 className="text-3xl font-semibold text-[var(--foreground)] mb-8 pl-0 sm:pl-[184px]">Settings</h1>

        <div className="flex gap-8">
          {/* Left sidebar tabs — text only, Claude-style */}
          <nav className="w-44 shrink-0 hidden sm:block">
            <div className="flex flex-col gap-0.5">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-2 rounded-lg text-[0.9rem] transition-colors text-left ${
                    activeTab === tab.id
                      ? "bg-[var(--muted)] text-[var(--foreground)] font-medium"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </nav>

          {/* Mobile tab bar */}
          <div className="sm:hidden flex gap-1 w-full overflow-x-auto pb-4 -mt-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? "bg-[var(--muted)] text-[var(--foreground)] font-medium"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* ── General Tab ── */}
            {activeTab === "general" && (
              <div className="space-y-10">
                {/* Profile */}
                <section>
                  <h2 className="text-base font-semibold text-[var(--foreground)] mb-4">Profile</h2>
                  <div className="flex items-start gap-4">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
                    ) : (
                      <div className="h-14 w-14 rounded-full bg-[var(--muted)] text-[var(--muted-foreground)] flex items-center justify-center text-xl font-semibold">
                        {(user.display_name || user.email)[0].toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1">
                      <label className="text-xs text-[var(--muted-foreground)] mb-1.5 block">Display name</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] placeholder:text-[var(--muted-foreground)]"
                          placeholder="Your name"
                        />
                        <button
                          type="button"
                          onClick={handleSaveName}
                          disabled={savingName}
                          className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--muted)] transition-colors disabled:opacity-50 flex items-center gap-1.5 text-[var(--foreground)]"
                        >
                          {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : nameSaved ? <Check className="h-3.5 w-3.5" /> : null}
                          {nameSaved ? "Saved" : "Save"}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                <hr className="border-[var(--border)]" />

                {/* Color Mode */}
                <section>
                  <h2 className="text-base font-semibold text-[var(--foreground)] mb-1">Color mode</h2>
                  <p className="text-sm text-[var(--muted-foreground)] mb-4">Choose how the interface looks</p>
                  <div className="grid grid-cols-3 gap-3">
                    {(
                      [
                        { mode: "light" as ColorMode, label: "Light", icon: <Sun className="h-4 w-4" /> },
                        { mode: "auto" as ColorMode, label: "Auto", icon: <Monitor className="h-4 w-4" /> },
                        { mode: "dark" as ColorMode, label: "Dark", icon: <Moon className="h-4 w-4" /> },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.mode}
                        type="button"
                        onClick={() => setColorMode(item.mode)}
                        className={`relative flex flex-col items-center gap-2.5 p-4 rounded-xl border-2 transition-all ${
                          colorMode === item.mode
                            ? "border-[var(--foreground)] bg-[var(--muted)]"
                            : "border-[var(--border)] hover:border-[var(--muted-foreground)]"
                        }`}
                      >
                        {/* Preview mini UI */}
                        <div className={`w-full h-[52px] rounded-lg overflow-hidden ${
                          item.mode === "light" ? "bg-[#f0f0f0] border border-[#ddd]"
                          : item.mode === "dark" ? "bg-[#35322f] border border-[#4a4744]"
                          : "bg-gradient-to-r from-[#f0f0f0] to-[#35322f] border border-[#999]"
                        }`}>
                          <div className="h-full flex flex-col justify-end p-2 gap-1">
                            <div className={`h-1 w-8 rounded-full ${
                              item.mode === "light" ? "bg-[#ccc]" : item.mode === "dark" ? "bg-[#555]" : "bg-[#888]"
                            }`} />
                            <div className={`h-1 w-5 rounded-full ${
                              item.mode === "light" ? "bg-[#ddd]" : item.mode === "dark" ? "bg-[#444]" : "bg-[#777]"
                            }`} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-[var(--foreground)]">
                          {item.icon}
                          <span className="text-sm font-medium">{item.label}</span>
                        </div>
                        {colorMode === item.mode && (
                          <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-[var(--foreground)] text-[var(--background)] flex items-center justify-center">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </section>

                <hr className="border-[var(--border)]" />

                {/* Landing Style */}
                <section>
                  <h2 className="text-base font-semibold text-[var(--foreground)] mb-1">Landing style</h2>
                  <p className="text-sm text-[var(--muted-foreground)] mb-4">Choose the landing page layout</p>
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        { style: "claude" as FrontStyle, label: "Claude" },
                        { style: "chatgpt" as FrontStyle, label: "ChatGPT" },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.style}
                        type="button"
                        onClick={() => setFrontStyle(item.style)}
                        className={`relative flex flex-col items-center gap-2.5 p-4 rounded-xl border-2 transition-all ${
                          frontStyle === item.style
                            ? "border-[var(--foreground)] bg-[var(--muted)]"
                            : "border-[var(--border)] hover:border-[var(--muted-foreground)]"
                        }`}
                      >
                        {/* Preview mini UI */}
                        <div className="w-full h-[60px] rounded-lg overflow-hidden bg-[var(--card)] border border-[var(--border)] flex flex-col items-center justify-center p-2">
                          {item.style === "claude" ? (
                            <>
                              <div className="h-3.5 w-3.5 rounded-full bg-[var(--muted-foreground)] opacity-30 mb-1" />
                              <div className="h-1 w-12 rounded-full bg-[var(--muted-foreground)] opacity-20 italic" />
                              <div className="h-2 w-16 rounded-full bg-[var(--muted)] mt-1.5" />
                            </>
                          ) : (
                            <>
                              <div className="h-1.5 w-14 rounded-full bg-[var(--muted-foreground)] opacity-25 mb-1.5" />
                              <div className="h-2 w-16 rounded-full bg-[var(--muted)] mb-1.5" />
                              <div className="flex gap-1">
                                <div className="h-1.5 w-6 rounded-full bg-[var(--muted-foreground)] opacity-15" />
                                <div className="h-1.5 w-6 rounded-full bg-[var(--muted-foreground)] opacity-15" />
                                <div className="h-1.5 w-6 rounded-full bg-[var(--muted-foreground)] opacity-15" />
                              </div>
                            </>
                          )}
                        </div>
                        <span className="text-sm font-medium text-[var(--foreground)]">{item.label}</span>
                        {frontStyle === item.style && (
                          <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-[var(--foreground)] text-[var(--background)] flex items-center justify-center">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </section>

                <hr className="border-[var(--border)]" />

                {/* Chat Font */}
                <section>
                  <h2 className="text-base font-semibold text-[var(--foreground)] mb-1">Chat font</h2>
                  <p className="text-sm text-[var(--muted-foreground)] mb-4">Choose the font for chat messages</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {(
                      [
                        { font: "default" as ChatFont, label: "Default", family: "var(--font-geist-sans)" },
                        { font: "sans" as ChatFont, label: "Sans", family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
                        { font: "system" as ChatFont, label: "System", family: "system-ui, sans-serif" },
                        { font: "dyslexic" as ChatFont, label: "Dyslexic", family: "'OpenDyslexic', 'Comic Sans MS', sans-serif" },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.font}
                        type="button"
                        onClick={() => setChatFont(item.font)}
                        className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                          chatFont === item.font
                            ? "border-[var(--foreground)] bg-[var(--muted)]"
                            : "border-[var(--border)] hover:border-[var(--muted-foreground)]"
                        }`}
                      >
                        <span
                          className="text-2xl font-medium text-[var(--foreground)]"
                          style={{ fontFamily: item.family }}
                        >
                          Aa
                        </span>
                        <span className="text-xs font-medium text-[var(--muted-foreground)]">{item.label}</span>
                        {chatFont === item.font && (
                          <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-[var(--foreground)] text-[var(--background)] flex items-center justify-center">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* ── Account Tab ── */}
            {activeTab === "account" && (
              <div className="space-y-10">
                <section>
                  <h2 className="text-base font-semibold text-[var(--foreground)] mb-5">Account info</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1.5 block">Email</label>
                      <div className="px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/50 text-sm text-[var(--muted-foreground)]">
                        {user.email}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1.5 block">Auth provider</label>
                      <div className="px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/50 text-sm text-[var(--muted-foreground)] capitalize">
                        {user.auth_provider}
                      </div>
                    </div>
                  </div>
                </section>

                {user.auth_provider === "email" && (
                  <>
                    <hr className="border-[var(--border)]" />
                    <section>
                      <h2 className="text-base font-semibold text-[var(--foreground)] mb-5">Change password</h2>
                      <div className="space-y-4 max-w-sm">
                        <div>
                          <label className="text-xs text-[var(--muted-foreground)] mb-1.5 block">Current password</label>
                          <input
                            type="password"
                            value={currentPw}
                            onChange={(e) => setCurrentPw(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[var(--muted-foreground)] mb-1.5 block">New password</label>
                          <input
                            type="password"
                            value={newPw}
                            onChange={(e) => setNewPw(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                            placeholder="Min 6 characters"
                          />
                        </div>
                        {pwError && <p className="text-xs text-red-400">{pwError}</p>}
                        {pwSuccess && <p className="text-xs text-emerald-400">Password changed successfully</p>}
                        <button
                          type="button"
                          onClick={handleChangePassword}
                          disabled={changingPw || !currentPw || !newPw}
                          className="px-4 py-2.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--muted)] transition-colors disabled:opacity-50 flex items-center gap-1.5 text-[var(--foreground)]"
                        >
                          {changingPw && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Update password
                        </button>
                      </div>
                    </section>
                  </>
                )}
              </div>
            )}

            {/* ── Skills Tab ── */}
            {activeTab === "skills" && (
              <div className="space-y-6">
                {/* Skills Header */}
                <section>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Zap className="h-5 w-5 text-[var(--muted-foreground)]" />
                      <h2 className="text-base font-semibold text-[var(--foreground)]">Custom Skills</h2>
                    </div>
                    {skillView === "list" && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setSkillView("import"); resetSkillForm(); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                        >
                          <Upload className="h-3 w-3" />
                          Import
                        </button>
                        <button
                          type="button"
                          onClick={() => { setSkillView("create"); resetSkillForm(); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--foreground)] text-[var(--background)] text-xs font-medium hover:opacity-90 transition-opacity"
                        >
                          <Plus className="h-3 w-3" />
                          Create skill
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)] mb-5">
                    Create custom skills with instructions that Iris follows during conversations. Share them with others via share codes.
                  </p>
                </section>

                {/* Skills List */}
                {skillView === "list" && (
                  <>
                    {loadingSkills ? (
                      <div className="flex items-center gap-2 text-[var(--muted-foreground)] py-8 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Loading skills...</span>
                      </div>
                    ) : customSkills.length === 0 ? (
                      <div className="py-10 text-center border border-[var(--border)] rounded-xl">
                        <Zap className="h-8 w-8 text-[var(--muted-foreground)] mx-auto mb-3 opacity-30" />
                        <p className="text-sm text-[var(--muted-foreground)]">No custom skills yet</p>
                        <p className="text-xs text-[var(--muted-foreground)] mt-1 opacity-60">
                          Create a skill to give Iris custom instructions for specific tasks
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {customSkills.map((skill) => (
                          <div
                            key={skill.id}
                            className="p-4 rounded-xl border border-[var(--border)] hover:border-[var(--muted-foreground)]/30 transition-colors"
                          >
                            <div className="flex items-start gap-3">
                              <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                                skill.enabled ? "bg-green-500/15 text-green-500" : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                              }`}>
                                <Zap className="h-4 w-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-sm font-medium text-[var(--foreground)]">{skill.name}</span>
                                  {skill.enabled && (
                                    <span className="text-[10px] font-medium text-green-500 uppercase tracking-wide">Active</span>
                                  )}
                                </div>
                                {skill.description && (
                                  <p className="text-xs text-[var(--muted-foreground)] line-clamp-1">{skill.description}</p>
                                )}
                                {skill.instructions && (
                                  <p className="text-[10px] text-[var(--muted-foreground)] mt-1 opacity-60 line-clamp-1 font-mono">
                                    {skill.instructions.slice(0, 100)}
                                  </p>
                                )}
                              </div>
                              <div className="flex gap-1 shrink-0">
                                {/* Toggle */}
                                <button
                                  type="button"
                                  onClick={() => handleToggleSkill(skill)}
                                  className={`h-7 px-2 flex items-center justify-center rounded text-xs font-medium transition-colors ${
                                    skill.enabled
                                      ? "bg-green-500/15 text-green-500 hover:bg-green-500/25"
                                      : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                                  }`}
                                  title={skill.enabled ? "Disable" : "Enable"}
                                >
                                  {skill.enabled ? "On" : "Off"}
                                </button>
                                {/* Edit */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSkill(skill);
                                    setSkillName(skill.name);
                                    setSkillDesc(skill.description);
                                    setSkillIcon(skill.icon);
                                    setSkillInstructions(skill.instructions);
                                    setSkillMcpUrl(skill.mcp_server_url || "");
                                    setSkillError("");
                                    setSkillView("edit");
                                  }}
                                  className="h-7 w-7 flex items-center justify-center rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                                  title="Edit"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                {/* Share (only for logged-in users) */}
                                {user && (
                                  <button
                                    type="button"
                                    onClick={() => handleShareSkill(skill.id)}
                                    className="h-7 w-7 flex items-center justify-center rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                                    title="Share"
                                  >
                                    <Share2 className="h-3 w-3" />
                                  </button>
                                )}
                                {/* Delete */}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSkill(skill.id)}
                                  className="h-7 w-7 flex items-center justify-center rounded hover:bg-red-500/10 text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Share modal */}
                    {shareData && (
                      <div className="mt-4 p-4 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold text-[var(--foreground)]">Share Skill</h3>
                          <button
                            type="button"
                            onClick={() => { setShareData(null); setCopied(false); }}
                            className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Share code</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                readOnly
                                value={shareData.share_code}
                                className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/50 text-sm text-[var(--foreground)] font-mono"
                              />
                              <button
                                type="button"
                                onClick={() => handleCopyShareCode(shareData.share_code)}
                                className="px-3 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--muted)] transition-colors flex items-center gap-1.5 text-[var(--foreground)]"
                              >
                                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                {copied ? "Copied" : "Copy"}
                              </button>
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Or copy as JSON</label>
                            <button
                              type="button"
                              onClick={() => handleCopyJson(shareData)}
                              className="px-3 py-2 rounded-lg border border-[var(--border)] text-xs hover:bg-[var(--muted)] transition-colors flex items-center gap-1.5 text-[var(--muted-foreground)]"
                            >
                              <Copy className="h-3 w-3" />
                              Copy JSON
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Create / Edit Skill Form */}
                {(skillView === "create" || skillView === "edit") && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-[var(--foreground)]">
                        {skillView === "create" ? "Create New Skill" : "Edit Skill"}
                      </h3>
                      <button
                        type="button"
                        onClick={() => { setSkillView("list"); resetSkillForm(); }}
                        className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      >
                        Cancel
                      </button>
                    </div>

                    {/* Name */}
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1.5 block">Name *</label>
                      <input
                        type="text"
                        value={skillName}
                        onChange={(e) => setSkillName(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] placeholder:text-[var(--muted-foreground)]"
                        placeholder="e.g. Code Reviewer, Email Writer"
                        maxLength={100}
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1.5 block">Description</label>
                      <input
                        type="text"
                        value={skillDesc}
                        onChange={(e) => setSkillDesc(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] placeholder:text-[var(--muted-foreground)]"
                        placeholder="What does this skill do?"
                        maxLength={500}
                      />
                    </div>

                    {/* Icon */}
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1.5 block">Icon</label>
                      <div className="flex flex-wrap gap-1.5">
                        {ICON_OPTIONS.map((icon) => (
                          <button
                            key={icon}
                            type="button"
                            onClick={() => setSkillIcon(icon)}
                            className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs transition-colors ${
                              skillIcon === icon
                                ? "bg-[var(--foreground)] text-[var(--background)]"
                                : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                            }`}
                            title={icon}
                          >
                            <Zap className="h-3.5 w-3.5" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Instructions */}
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1.5 block">Instructions</label>
                      <textarea
                        value={skillInstructions}
                        onChange={(e) => setSkillInstructions(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] placeholder:text-[var(--muted-foreground)] resize-none font-mono"
                        rows={8}
                        placeholder="Write instructions that Iris will follow when this skill is active. Be specific about the behavior, tone, and format you want."
                        maxLength={5000}
                      />
                      <p className="text-[10px] text-[var(--muted-foreground)] mt-1 text-right">{skillInstructions.length}/5000</p>
                    </div>

                    {/* MCP Server URL */}
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1.5 block">MCP Server URL (optional)</label>
                      <input
                        type="url"
                        value={skillMcpUrl}
                        onChange={(e) => setSkillMcpUrl(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] placeholder:text-[var(--muted-foreground)] font-mono"
                        placeholder="https://mcp.example.com/server"
                      />
                      <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
                        Reference an MCP server for this skill. Currently informational only.
                      </p>
                    </div>

                    {skillError && <p className="text-xs text-red-400">{skillError}</p>}

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => { setSkillView("list"); resetSkillForm(); }}
                        className="px-4 py-2.5 rounded-lg border border-[var(--border)] text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={skillView === "create" ? handleCreateSkill : handleUpdateSkill}
                        disabled={savingSkill || !skillName.trim()}
                        className="px-4 py-2.5 rounded-lg bg-[var(--foreground)] text-[var(--background)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {savingSkill && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {skillView === "create" ? "Create Skill" : "Save Changes"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Import Skill */}
                {skillView === "import" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-[var(--foreground)]">Import Skill</h3>
                      <button
                        type="button"
                        onClick={() => { setSkillView("list"); setImportCode(""); setImportJson(""); setSkillError(""); }}
                        className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      >
                        Cancel
                      </button>
                    </div>

                    {/* By share code */}
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1.5 block">Share code</label>
                      <input
                        type="text"
                        value={importCode}
                        onChange={(e) => { setImportCode(e.target.value); setImportJson(""); }}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] placeholder:text-[var(--muted-foreground)] font-mono"
                        placeholder="Paste a share code (UUID)"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <hr className="flex-1 border-[var(--border)]" />
                      <span className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">or</span>
                      <hr className="flex-1 border-[var(--border)]" />
                    </div>

                    {/* By JSON */}
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1.5 block">Paste skill JSON</label>
                      <textarea
                        value={importJson}
                        onChange={(e) => { setImportJson(e.target.value); setImportCode(""); }}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] placeholder:text-[var(--muted-foreground)] resize-none font-mono"
                        rows={6}
                        placeholder='{"name": "...", "instructions": "...", ...}'
                      />
                    </div>

                    {skillError && <p className="text-xs text-red-400">{skillError}</p>}

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => { setSkillView("list"); setImportCode(""); setImportJson(""); setSkillError(""); }}
                        className="px-4 py-2.5 rounded-lg border border-[var(--border)] text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleImport}
                        disabled={importing || (!importCode.trim() && !importJson.trim())}
                        className="px-4 py-2.5 rounded-lg bg-[var(--foreground)] text-[var(--background)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Import Skill
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Privacy Tab ── */}
            {activeTab === "privacy" && (
              <div className="space-y-10">
                <section>
                  <h2 className="text-base font-semibold text-[var(--foreground)] mb-1">Export data</h2>
                  <p className="text-sm text-[var(--muted-foreground)] mb-4">
                    Download all your data including conversations, preferences, and profile info as JSON.
                  </p>
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={exporting}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--border)] text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                  >
                    {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    Export all data
                  </button>
                </section>

                <hr className="border-[var(--border)]" />

                <section>
                  <h2 className="text-base font-semibold text-[var(--foreground)] mb-1">Clear history</h2>
                  <p className="text-sm text-[var(--muted-foreground)] mb-4">
                    Permanently delete all your chat conversations. This action cannot be undone.
                  </p>
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    disabled={clearing}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-500/30 text-sm text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Clear all history
                  </button>
                </section>
              </div>
            )}

            {/* ── Usage Tab ── */}
            {activeTab === "usage" && (
              <div className="space-y-10">
                <section>
                  <h2 className="text-base font-semibold text-[var(--foreground)] mb-5">Platform stats</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                      <p className="text-2xl font-semibold text-[var(--foreground)] tabular-nums">{stats?.tools ?? "\u2014"}</p>
                      <p className="text-sm text-[var(--muted-foreground)] mt-1">Tools indexed</p>
                    </div>
                    <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                      <p className="text-2xl font-semibold text-[var(--foreground)] tabular-nums">{stats?.actions ?? "\u2014"}</p>
                      <p className="text-sm text-[var(--muted-foreground)] mt-1">Actions available</p>
                    </div>
                    <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                      <p className="text-2xl font-semibold text-[var(--foreground)] tabular-nums">{stats?.categories ?? "\u2014"}</p>
                      <p className="text-sm text-[var(--muted-foreground)] mt-1">Categories</p>
                    </div>
                  </div>
                </section>

                <hr className="border-[var(--border)]" />

                <section>
                  <h2 className="text-base font-semibold text-[var(--foreground)] mb-5">Your usage</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                      <p className="text-2xl font-semibold text-[var(--foreground)] tabular-nums">{convCount ?? "\u2014"}</p>
                      <p className="text-sm text-[var(--muted-foreground)] mt-1">Conversations</p>
                    </div>
                    <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                      <p className="text-2xl font-semibold text-[var(--foreground)] tabular-nums">{connections.length > 0 ? connections.length : "\u2014"}</p>
                      <p className="text-sm text-[var(--muted-foreground)] mt-1">Connected services</p>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* ── Memory Tab ── */}
            {activeTab === "memory" && (
              <div className="space-y-6">
                <section>
                  <div className="flex items-center gap-2 mb-1">
                    <Brain className="h-5 w-5 text-[var(--muted-foreground)]" />
                    <h2 className="text-base font-semibold text-[var(--foreground)]">AI Memory</h2>
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)] mb-5">
                    Iris remembers important information from your conversations. {memoryTotal > 0 && `${memoryTotal} memories stored.`}
                  </p>

                  {/* Search + Filter */}
                  <div className="flex gap-2 mb-4">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                      <input
                        type="text"
                        value={memorySearch}
                        onChange={(e) => setMemorySearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearchMemories()}
                        placeholder="Search memories..."
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] placeholder:text-[var(--muted-foreground)]"
                      />
                    </div>
                    <select
                      value={memoryFilter}
                      onChange={(e) => { setMemoryFilter(e.target.value); setMemorySearch(""); }}
                      className="px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    >
                      <option value="">All</option>
                      <option value="preference">Preferences</option>
                      <option value="contact">Contacts</option>
                      <option value="fact">Facts</option>
                      <option value="decision">Decisions</option>
                      <option value="pattern">Patterns</option>
                    </select>
                  </div>

                  {/* Memory List */}
                  {loadingMemories ? (
                    <div className="flex items-center gap-2 text-[var(--muted-foreground)] py-8 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Loading memories...</span>
                    </div>
                  ) : memories.length === 0 ? (
                    <div className="py-10 text-center border border-[var(--border)] rounded-xl">
                      <Brain className="h-8 w-8 text-[var(--muted-foreground)] mx-auto mb-3 opacity-30" />
                      <p className="text-sm text-[var(--muted-foreground)]">No memories yet</p>
                      <p className="text-xs text-[var(--muted-foreground)] mt-1 opacity-60">
                        Iris will automatically remember important things from your conversations
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {memories.map((m) => (
                        <div
                          key={m.id}
                          className="p-3 rounded-xl border border-[var(--border)] hover:border-[var(--muted-foreground)]/30 transition-colors"
                        >
                          {editingMemory === m.id ? (
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={editKey}
                                  onChange={(e) => setEditKey(e.target.value)}
                                  className="flex-1 px-2 py-1 rounded border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none"
                                  placeholder="Label"
                                />
                                <select
                                  value={editCategory}
                                  onChange={(e) => setEditCategory(e.target.value)}
                                  className="px-2 py-1 rounded border border-[var(--border)] bg-transparent text-xs text-[var(--foreground)]"
                                >
                                  <option value="preference">Preference</option>
                                  <option value="contact">Contact</option>
                                  <option value="fact">Fact</option>
                                  <option value="decision">Decision</option>
                                  <option value="pattern">Pattern</option>
                                </select>
                              </div>
                              <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full px-2 py-1 rounded border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] focus:outline-none resize-none"
                                rows={2}
                              />
                              <div className="flex gap-2 justify-end">
                                <button
                                  type="button"
                                  onClick={() => setEditingMemory(null)}
                                  className="px-3 py-1 text-xs rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveMemory(m.id)}
                                  className="px-3 py-1 text-xs rounded bg-[var(--foreground)] text-[var(--background)] hover:opacity-90"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
                                    m.category === "preference" ? "bg-blue-500/15 text-blue-400" :
                                    m.category === "contact" ? "bg-emerald-500/15 text-emerald-400" :
                                    m.category === "decision" ? "bg-amber-500/15 text-amber-400" :
                                    m.category === "pattern" ? "bg-purple-500/15 text-purple-400" :
                                    "bg-[var(--muted)] text-[var(--muted-foreground)]"
                                  }`}>
                                    {m.category}
                                  </span>
                                  <span className="text-sm font-medium text-[var(--foreground)] truncate">{m.key}</span>
                                </div>
                                <p className="text-sm text-[var(--muted-foreground)] line-clamp-2">{m.content}</p>
                                <p className="text-[10px] text-[var(--muted-foreground)] mt-1 opacity-50">
                                  {m.source === "manual" ? "Added manually" : m.source.startsWith("conversation:") ? "From conversation" : "Auto-extracted"}
                                  {m.created_at && ` \u00b7 ${new Date(m.created_at).toLocaleDateString()}`}
                                </p>
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingMemory(m.id);
                                    setEditKey(m.key);
                                    setEditContent(m.content);
                                    setEditCategory(m.category);
                                  }}
                                  className="h-7 w-7 flex items-center justify-center rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                                  title="Edit"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMemory(m.id)}
                                  className="h-7 w-7 flex items-center justify-center rounded hover:bg-red-500/10 text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                                  title="Delete"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* ── Connectors Tab ── */}
            {activeTab === "connectors" && (
              <div className="space-y-6">
                <section>
                  <h2 className="text-base font-semibold text-[var(--foreground)] mb-1">Connectors</h2>
                  <p className="text-sm text-[var(--muted-foreground)] mb-5">
                    Allow Iris to reference other apps and services for more context.
                  </p>
                  {loadingConns ? (
                    <div className="flex items-center gap-2 text-[var(--muted-foreground)] py-8">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Loading...</span>
                    </div>
                  ) : connections.length === 0 ? (
                    <div className="py-10 text-center border border-[var(--border)] rounded-xl">
                      <p className="text-sm text-[var(--muted-foreground)]">No connectors configured</p>
                      <p className="text-xs text-[var(--muted-foreground)] mt-1 opacity-60">
                        Connectors are created when you authorize tools that need API access
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {connections.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between p-4 rounded-xl border border-[var(--border)]"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-[var(--muted)] flex items-center justify-center text-[var(--muted-foreground)]">
                              <span className="text-sm font-semibold uppercase">{c.provider[0]}</span>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-[var(--foreground)] capitalize">{c.provider}</p>
                              <p className="text-xs text-[var(--muted-foreground)]">
                                {c.tool_id}
                                {c.expires_at && ` \u00b7 Expires ${new Date(c.expires_at).toLocaleDateString()}`}
                              </p>
                            </div>
                          </div>
                          <span className="text-xs font-medium text-emerald-500">Connected</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
