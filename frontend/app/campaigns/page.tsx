"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Plus,
  ArrowLeft,
  Target,
  Users,
  TrendingUp,
  MoreHorizontal,
  Trash2,
  Play,
  Pause,
  CheckCircle2,
  Sparkles,
  Search,
  UserPlus,
  ChevronDown,
  ChevronRight,
  Mail,
  Phone,
  Linkedin,
  Mic,
  Bell,
  Send,
  SkipForward,
  MessageCircle,
  Loader2,
  Zap,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { UserMenu } from "@/components/user-menu";
import {
  listCampaigns,
  createCampaign,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  addProspect,
  bulkAddProspects,
  updateProspect,
  deleteProspect,
  deleteSequenceStep,
  logOutreach,
  generateCopy,
  generateSequence,
  enrichProspect,
  getCampaignStats,
  type Campaign,
  type CampaignProspect,
  type SequenceStep,
  type CampaignFullStats,
  STEP_TYPE_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  TIER_LABELS,
  TIER_DESCRIPTIONS,
} from "@/lib/campaigns";

type View = "list" | "detail";
type Tab = "prospects" | "sequence" | "analytics";
type StatusFilter = "all" | "draft" | "active" | "paused" | "completed";

export default function CampaignsPage() {
  const { user } = useAuth();

  // ── View state ─────────────────────────────────
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── List state ─────────────────────────────────
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // ── Create modal ───────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newTier, setNewTier] = useState(2);
  const [newIndustry, setNewIndustry] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newSize, setNewSize] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [creating, setCreating] = useState(false);

  // ── Detail state ───────────────────────────────
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("prospects");
  const [stats, setStats] = useState<CampaignFullStats | null>(null);

  // Prospect state
  const [showAddProspect, setShowAddProspect] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProspect, setExpandedProspect] = useState<string | null>(null);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [generatingCopy, setGeneratingCopy] = useState<string | null>(null);
  const [generatedCopy, setGeneratedCopy] = useState<{ subject: string; body: string } | null>(null);

  // Add prospect form
  const [apName, setApName] = useState("");
  const [apEmail, setApEmail] = useState("");
  const [apCompany, setApCompany] = useState("");
  const [apTitle, setApTitle] = useState("");
  const [apLinkedin, setApLinkedin] = useState("");
  const [apPhone, setApPhone] = useState("");
  const [apTier, setApTier] = useState<number | null>(null);

  // Bulk add
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkText, setBulkText] = useState("");

  // Sequence state
  const [generatingSequence, setGeneratingSequence] = useState(false);
  const [valueProp, setValueProp] = useState("");

  // ── Load functions ─────────────────────────────

  const loadCampaigns = async () => {
    try {
      const data = await listCampaigns();
      setCampaigns(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await getCampaign(id);
      setCampaign(data);
    } catch {
      setView("list");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { loadCampaigns(); }, []);

  useEffect(() => {
    if (view === "detail" && selectedId) loadDetail(selectedId);
  }, [view, selectedId, loadDetail]);

  useEffect(() => {
    if (tab === "analytics" && selectedId) {
      getCampaignStats(selectedId).then(setStats).catch(() => {});
    }
  }, [tab, selectedId]);

  // ── Helpers ────────────────────────────────────

  const openCampaign = (id: string) => {
    setSelectedId(id);
    setView("detail");
    setTab("prospects");
    setExpandedProspect(null);
    setGeneratedCopy(null);
    setSearchQuery("");
  };

  const goBack = () => {
    setView("list");
    setSelectedId(null);
    setCampaign(null);
    loadCampaigns();
  };

  const reloadDetail = () => { if (selectedId) loadDetail(selectedId); };

  const filtered = filter === "all" ? campaigns : campaigns.filter((c) => c.status === filter);

  const statusIcon = (status: string) => {
    switch (status) {
      case "active": return <Play className="h-3 w-3 text-emerald-400" />;
      case "paused": return <Pause className="h-3 w-3 text-amber-400" />;
      case "completed": return <CheckCircle2 className="h-3 w-3 text-blue-400" />;
      default: return <div className="h-3 w-3 rounded-full border border-[var(--muted-foreground)]" />;
    }
  };

  const stepTypeIcon = (type: string) => {
    switch (type) {
      case "email": return <Mail className="h-4 w-4 text-blue-400" />;
      case "linkedin_connect": return <Linkedin className="h-4 w-4 text-sky-400" />;
      case "linkedin_message": return <MessageCircle className="h-4 w-4 text-sky-400" />;
      case "linkedin_voice_note": return <Mic className="h-4 w-4 text-purple-400" />;
      case "call": return <Phone className="h-4 w-4 text-green-400" />;
      case "reminder": return <Bell className="h-4 w-4 text-amber-400" />;
      default: return <Mail className="h-4 w-4" />;
    }
  };

  // ── List handlers ──────────────────────────────

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const c = await createCampaign({
        name: newName, description: newDesc, default_tier: newTier,
        target_industry: newIndustry, target_role: newRole,
        target_company_size: newSize, target_location: newLocation,
      });
      setShowCreate(false);
      setNewName(""); setNewDesc(""); setNewTier(2); setNewIndustry(""); setNewRole(""); setNewSize(""); setNewLocation("");
      openCampaign(c.id);
    } catch { /* ignore */ } finally { setCreating(false); }
  };

  const handleStatusChange = async (id: string, status: string) => {
    await updateCampaign(id, { status });
    setMenuOpen(null);
    if (view === "detail") reloadDetail();
    else loadCampaigns();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this campaign and all its prospects?")) return;
    await deleteCampaign(id);
    setMenuOpen(null);
    if (view === "detail") goBack();
    else loadCampaigns();
  };

  // ── Detail handlers ────────────────────────────

  const handleAddProspect = async () => {
    if (!apName.trim() || !selectedId || !campaign) return;
    await addProspect(selectedId, {
      name: apName, email: apEmail, company: apCompany, title: apTitle,
      linkedin: apLinkedin, phone: apPhone,
      tier: apTier ?? campaign.default_tier,
    } as Partial<CampaignProspect>);
    setShowAddProspect(false);
    setApName(""); setApEmail(""); setApCompany(""); setApTitle(""); setApLinkedin(""); setApPhone(""); setApTier(null);
    reloadDetail();
  };

  const handleBulkAdd = async () => {
    if (!selectedId) return;
    const lines = bulkText.trim().split("\n").filter(Boolean);
    const parsed = lines.map((l) => {
      const p = l.split(/[,\t]/).map((s) => s.trim());
      return { name: p[0] || "", email: p[1] || "", company: p[2] || "", title: p[3] || "" };
    }).filter((p) => p.name);
    if (!parsed.length) return;
    await bulkAddProspects(selectedId, parsed as Partial<CampaignProspect>[]);
    setShowBulkAdd(false); setBulkText("");
    reloadDetail();
  };

  const handleStatusUpdate = async (prospectId: string, status: string) => {
    if (!selectedId) return;
    await updateProspect(selectedId, prospectId, { prospect_status: status } as Partial<CampaignProspect>);
    reloadDetail();
  };

  const handleDeleteProspect = async (prospectId: string) => {
    if (!selectedId) return;
    await deleteProspect(selectedId, prospectId);
    reloadDetail();
  };

  const handleEnrich = async (prospectId: string) => {
    if (!selectedId) return;
    setEnrichingId(prospectId);
    try { await enrichProspect(selectedId, prospectId); reloadDetail(); }
    catch { /* ignore */ } finally { setEnrichingId(null); }
  };

  const handleGenerateCopy = async (channel: string, prospectId: string) => {
    if (!selectedId) return;
    setGeneratingCopy(prospectId);
    try {
      const copy = await generateCopy(selectedId, {
        channel, prospect_id: prospectId,
        value_proposition: valueProp || campaign?.description || "",
      });
      setGeneratedCopy(copy);
    } catch { /* ignore */ } finally { setGeneratingCopy(null); }
  };

  const handleLogOutreach = async (prospectId: string, stepOrder: number, stepType: string, action: string) => {
    if (!selectedId) return;
    await logOutreach(selectedId, prospectId, { step_order: stepOrder, step_type: stepType, action });
    reloadDetail();
  };

  const handleGenerateSequence = async () => {
    if (!selectedId || !campaign) return;
    setGeneratingSequence(true);
    try {
      await generateSequence(selectedId, {
        tier: campaign.default_tier,
        value_proposition: valueProp || campaign.description,
        target_industry: campaign.target_industry,
        target_role: campaign.target_role,
      });
      reloadDetail();
    } catch { /* ignore */ } finally { setGeneratingSequence(false); }
  };

  // ── Computed ───────────────────────────────────

  const totalProspects = campaigns.reduce((s, c) => s + c.prospect_count, 0);
  const totalActive = campaigns.filter((c) => c.status === "active").length;
  const totalReplied = campaigns.reduce((s, c) => s + (c.stats?.replied || 0), 0);

  const prospects = campaign?.prospects || [];
  const steps = campaign?.sequence_steps || [];
  const filteredProspects = searchQuery
    ? prospects.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.email.toLowerCase().includes(searchQuery.toLowerCase()))
    : prospects;

  // ══════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* ════════════ LIST VIEW ════════════ */}
      {view === "list" && (
        <>
          <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-sm">
            <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link href="/" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <div>
                  <h1 className="text-lg font-semibold text-[var(--foreground)]">Campaigns</h1>
                  <p className="text-xs text-[var(--muted-foreground)]">B2B Multichannel Prospecting</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
                  <Plus className="h-4 w-4" /> New Campaign
                </button>
                {user ? <UserMenu /> : <Link href="/login" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Sign in</Link>}
              </div>
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-4 py-6">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[
                { icon: <Target className="h-3.5 w-3.5" />, label: "Campaigns", value: campaigns.length, sub: `${totalActive} active`, subClass: "text-emerald-400" },
                { icon: <Users className="h-3.5 w-3.5" />, label: "Prospects", value: totalProspects, sub: "across all campaigns" },
                { icon: <TrendingUp className="h-3.5 w-3.5" />, label: "Replies", value: totalReplied, sub: "total responses" },
              ].map((s, i) => (
                <div key={i} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
                  <div className="flex items-center gap-2 text-[var(--muted-foreground)] text-xs mb-1">{s.icon} {s.label}</div>
                  <p className="text-2xl font-semibold text-[var(--foreground)]">{s.value}</p>
                  <p className={`text-xs ${s.subClass || "text-[var(--muted-foreground)]"}`}>{s.sub}</p>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 mb-4">
              {(["all", "draft", "active", "paused", "completed"] as StatusFilter[]).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === f ? "bg-indigo-600 text-white" : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}>
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            {/* List */}
            {loading ? (
              <div className="text-center py-20 text-[var(--muted-foreground)]"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20">
                <Target className="h-12 w-12 mx-auto text-[var(--muted-foreground)] mb-3 opacity-40" />
                <p className="text-[var(--muted-foreground)] mb-4">{filter === "all" ? "No campaigns yet" : `No ${filter} campaigns`}</p>
                <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm transition-colors">
                  <Plus className="h-4 w-4" /> Create your first campaign
                </button>
              </div>
            ) : (
              <div className="grid gap-3">
                {filtered.map((c) => (
                  <div key={c.id} onClick={() => openCampaign(c.id)} className="group bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 hover:border-indigo-500/30 transition-all cursor-pointer">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {statusIcon(c.status)}
                          <h3 className="font-medium text-[var(--foreground)] truncate">{c.name}</h3>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
                            {TIER_LABELS[c.default_tier]?.split(" — ")[0] || `Tier ${c.default_tier}`}
                          </span>
                        </div>
                        {c.description && <p className="text-xs text-[var(--muted-foreground)] mb-2 truncate">{c.description}</p>}
                        <div className="flex items-center gap-4 text-xs text-[var(--muted-foreground)]">
                          <span>{c.prospect_count} prospects</span>
                          <span>{c.step_count} steps</span>
                          {c.target_industry && <span>{c.target_industry}</span>}
                          {c.target_role && <span>{c.target_role}</span>}
                        </div>
                      </div>
                      {c.stats && c.stats.total > 0 && (
                        <div className="flex items-center gap-2 mr-8">
                          {c.stats.in_progress > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{c.stats.in_progress} active</span>}
                          {c.stats.replied > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">{c.stats.replied} replied</span>}
                          {c.stats.converted > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">{c.stats.converted} converted</span>}
                        </div>
                      )}
                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setMenuOpen(menuOpen === c.id ? null : c.id)} className="p-1 rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)]">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menuOpen === c.id && (
                          <div className="absolute right-0 top-8 w-40 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-lg py-1 z-20">
                            {c.status !== "active" && <button onClick={() => handleStatusChange(c.id, "active")} className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--muted)] flex items-center gap-2"><Play className="h-3 w-3" /> Activate</button>}
                            {c.status === "active" && <button onClick={() => handleStatusChange(c.id, "paused")} className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--muted)] flex items-center gap-2"><Pause className="h-3 w-3" /> Pause</button>}
                            <button onClick={() => handleStatusChange(c.id, "completed")} className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--muted)] flex items-center gap-2"><CheckCircle2 className="h-3 w-3" /> Complete</button>
                            <hr className="my-1 border-[var(--border)]" />
                            <button onClick={() => handleDelete(c.id)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--muted)] text-red-400 flex items-center gap-2"><Trash2 className="h-3 w-3" /> Delete</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </>
      )}

      {/* ════════════ DETAIL VIEW ════════════ */}
      {view === "detail" && (
        <>
          <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-sm">
            <div className="max-w-6xl mx-auto px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <button onClick={goBack} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  {campaign ? (
                    <div>
                      <h1 className="text-lg font-semibold text-[var(--foreground)]">{campaign.name}</h1>
                      <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${campaign.status === "active" ? "bg-emerald-500/10 text-emerald-400" : campaign.status === "paused" ? "bg-amber-500/10 text-amber-400" : campaign.status === "completed" ? "bg-blue-500/10 text-blue-400" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>
                          {campaign.status}
                        </span>
                        <span>{TIER_LABELS[campaign.default_tier]}</span>
                        {campaign.target_industry && <span>• {campaign.target_industry}</span>}
                      </div>
                    </div>
                  ) : <div className="h-10" />}
                </div>
                {campaign && (
                  <div className="flex items-center gap-2">
                    {campaign.status === "draft" && (
                      <button onClick={() => handleStatusChange(campaign.id, "active")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors">
                        <Play className="h-3 w-3" /> Launch
                      </button>
                    )}
                    {campaign.status === "active" && (
                      <button onClick={() => handleStatusChange(campaign.id, "paused")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition-colors">
                        <Pause className="h-3 w-3" /> Pause
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-1">
                {([
                  { key: "prospects" as Tab, label: "Prospects", count: prospects.length },
                  { key: "sequence" as Tab, label: "Sequence", count: steps.length },
                  { key: "analytics" as Tab, label: "Analytics", count: null },
                ]).map(({ key, label, count }) => (
                  <button key={key} onClick={() => setTab(key)} className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${tab === key ? "bg-[var(--card)] text-[var(--foreground)] border border-b-0 border-[var(--border)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}>
                    {label} {count !== null && <span className="ml-1 opacity-60">({count})</span>}
                  </button>
                ))}
              </div>
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-4 py-4">
            {detailLoading ? (
              <div className="text-center py-20"><Loader2 className="h-6 w-6 animate-spin mx-auto text-[var(--muted-foreground)]" /></div>
            ) : !campaign ? null : (
              <>
                {/* ── PROSPECTS TAB ── */}
                {tab === "prospects" && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
                        <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search prospects..." className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" />
                      </div>
                      <button onClick={() => setShowAddProspect(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"><UserPlus className="h-3.5 w-3.5" /> Add</button>
                      <button onClick={() => setShowBulkAdd(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--foreground)] text-xs hover:bg-[var(--muted)] transition-colors"><Plus className="h-3.5 w-3.5" /> Bulk Import</button>
                    </div>

                    {filteredProspects.length === 0 ? (
                      <div className="text-center py-16">
                        <UserPlus className="h-10 w-10 mx-auto text-[var(--muted-foreground)] mb-3 opacity-40" />
                        <p className="text-sm text-[var(--muted-foreground)] mb-3">No prospects yet</p>
                        <button onClick={() => setShowAddProspect(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm transition-colors"><UserPlus className="h-4 w-4" /> Add your first prospect</button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filteredProspects.map((p) => (
                          <div key={p.id} className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
                            <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-[var(--muted)]/30 transition-colors" onClick={() => setExpandedProspect(expandedProspect === p.id ? null : p.id)}>
                              {expandedProspect === p.id ? <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" /> : <ChevronRight className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" />}
                              <div className="h-8 w-8 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0">
                                <span className="text-xs font-medium text-indigo-400">{p.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm text-[var(--foreground)] truncate">{p.name}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">T{p.tier}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                                  {p.title && <span>{p.title}</span>}
                                  {p.title && p.company && <span>@</span>}
                                  {p.company && <span>{p.company}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <div className="flex gap-0.5">
                                  {steps.slice(0, 8).map((_, i) => (
                                    <div key={i} className={`h-1.5 w-1.5 rounded-full ${i < p.current_step ? "bg-indigo-400" : "bg-[var(--border)]"}`} />
                                  ))}
                                </div>
                                <select value={p.prospect_status} onChange={(e) => { e.stopPropagation(); handleStatusUpdate(p.id, e.target.value); }} onClick={(e) => e.stopPropagation()} className={`text-[10px] px-2 py-0.5 rounded-full bg-transparent border-none outline-none cursor-pointer font-medium ${STATUS_COLORS[p.prospect_status] || ""}`}>
                                  {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                              </div>
                            </div>

                            {expandedProspect === p.id && (
                              <div className="border-t border-[var(--border)] p-4 bg-[var(--background)]/50">
                                <div className="grid grid-cols-3 gap-4 mb-4 text-xs">
                                  <div><span className="text-[var(--muted-foreground)]">Email</span><p className="text-[var(--foreground)] font-mono">{p.email || "—"}</p></div>
                                  <div><span className="text-[var(--muted-foreground)]">Phone</span><p className="text-[var(--foreground)] font-mono">{p.phone || "—"}</p></div>
                                  <div><span className="text-[var(--muted-foreground)]">LinkedIn</span><p className="text-[var(--foreground)] font-mono truncate">{p.linkedin ? <a href={p.linkedin} target="_blank" rel="noopener" className="text-indigo-400 hover:underline">{p.linkedin.replace("https://", "")}</a> : "—"}</p></div>
                                </div>
                                {p.personalization && (
                                  <div className="mb-4 p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
                                    <span className="text-[10px] font-medium text-indigo-400 uppercase tracking-wider">Personalization Context</span>
                                    <p className="text-xs text-[var(--foreground)] mt-1">{p.personalization}</p>
                                  </div>
                                )}
                                <div className="flex items-center gap-2 mb-4">
                                  <button onClick={() => handleEnrich(p.id)} disabled={enrichingId === p.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs hover:bg-[var(--muted)] transition-colors disabled:opacity-50">
                                    {enrichingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                                    {enrichingId === p.id ? "Researching..." : "Enrich with AI"}
                                  </button>
                                  <button onClick={() => handleDeleteProspect(p.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="h-3 w-3" /> Remove</button>
                                </div>
                                <div>
                                  <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-2 uppercase tracking-wider">Outreach Sequence</h4>
                                  <div className="space-y-1.5">
                                    {steps.map((step) => {
                                      const isDone = p.outreach_logs?.some((l) => l.step_order === step.step_order);
                                      const isCurrent = step.step_order === p.current_step + 1;
                                      return (
                                        <div key={step.id} className={`flex items-center gap-3 p-2 rounded-lg text-xs ${isDone ? "bg-emerald-500/5 border border-emerald-500/10" : isCurrent ? "bg-indigo-500/5 border border-indigo-500/20" : "bg-[var(--card)] border border-[var(--border)]"}`}>
                                          {stepTypeIcon(step.step_type)}
                                          <span className="flex-1">
                                            <span className="font-medium">{STEP_TYPE_LABELS[step.step_type] || step.step_type}</span>
                                            {step.delay_days > 0 && <span className="ml-1 text-[var(--muted-foreground)]">Day {step.delay_days}</span>}
                                          </span>
                                          {isDone ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : isCurrent ? (
                                            <div className="flex items-center gap-1">
                                              <button onClick={() => handleGenerateCopy(step.step_type, p.id)} disabled={generatingCopy === p.id} className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-colors flex items-center gap-1">
                                                {generatingCopy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} AI Copy
                                              </button>
                                              <button onClick={() => handleLogOutreach(p.id, step.step_order, step.step_type, "sent")} className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center gap-1"><Send className="h-3 w-3" /> Done</button>
                                              <button onClick={() => handleLogOutreach(p.id, step.step_order, step.step_type, "skipped")} className="px-2 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--accent)] transition-colors flex items-center gap-1"><SkipForward className="h-3 w-3" /> Skip</button>
                                            </div>
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                                {generatedCopy && expandedProspect === p.id && (
                                  <div className="mt-4 p-3 rounded-lg bg-[var(--card)] border border-indigo-500/20">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-xs font-medium text-indigo-400">Generated Copy</span>
                                      <button onClick={() => setGeneratedCopy(null)} className="text-xs text-[var(--muted-foreground)]">Dismiss</button>
                                    </div>
                                    {generatedCopy.subject && <div className="mb-2"><span className="text-[10px] text-[var(--muted-foreground)]">Subject:</span><p className="text-sm text-[var(--foreground)]">{generatedCopy.subject}</p></div>}
                                    <div><span className="text-[10px] text-[var(--muted-foreground)]">Body:</span><p className="text-sm text-[var(--foreground)] whitespace-pre-wrap">{generatedCopy.body}</p></div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── SEQUENCE TAB ── */}
                {tab === "sequence" && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="flex-1">
                        <input value={valueProp} onChange={(e) => setValueProp(e.target.value)} placeholder="Your value proposition (for AI copy generation)..." className="w-full px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" />
                      </div>
                      <button onClick={handleGenerateSequence} disabled={generatingSequence} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors disabled:opacity-50">
                        {generatingSequence ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {generatingSequence ? "Generating..." : "AI Generate Sequence"}
                      </button>
                    </div>
                    <div className="mb-4 p-3 rounded-lg bg-[var(--card)] border border-[var(--border)]">
                      <p className="text-xs text-[var(--muted-foreground)]"><strong className="text-[var(--foreground)]">{TIER_LABELS[campaign.default_tier]}</strong> — {TIER_DESCRIPTIONS[campaign.default_tier]}</p>
                    </div>
                    {steps.length === 0 ? (
                      <div className="text-center py-16">
                        <Zap className="h-10 w-10 mx-auto text-[var(--muted-foreground)] mb-3 opacity-40" />
                        <p className="text-sm text-[var(--muted-foreground)] mb-3">No sequence steps defined</p>
                        <button onClick={handleGenerateSequence} disabled={generatingSequence} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm transition-colors"><Sparkles className="h-4 w-4" /> Generate with AI</button>
                      </div>
                    ) : (
                      <div className="relative">
                        <div className="absolute left-6 top-0 bottom-0 w-px bg-[var(--border)]" />
                        <div className="space-y-3">
                          {steps.map((step) => (
                            <div key={step.id} className="relative flex gap-4">
                              <div className="relative z-10 flex items-center justify-center h-12 w-12 shrink-0">
                                <div className="h-10 w-10 rounded-full bg-[var(--card)] border-2 border-[var(--border)] flex items-center justify-center">{stepTypeIcon(step.step_type)}</div>
                              </div>
                              <div className="flex-1 bg-[var(--card)] border border-[var(--border)] rounded-xl p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-[var(--foreground)]">Step {step.step_order}</span>
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">{STEP_TYPE_LABELS[step.step_type] || step.step_type}</span>
                                    <span className="text-[10px] text-[var(--muted-foreground)]">{step.delay_days === 0 ? "Same day" : `Day ${step.delay_days}`}</span>
                                  </div>
                                  <button onClick={() => { if (selectedId) deleteSequenceStep(selectedId, step.id).then(reloadDetail); }} className="text-[var(--muted-foreground)] hover:text-red-400 transition-colors"><Trash2 className="h-3 w-3" /></button>
                                </div>
                                {step.subject_template && <p className="text-xs text-[var(--foreground)] mb-1"><strong>Subject:</strong> {step.subject_template}</p>}
                                {step.body_template && <p className="text-xs text-[var(--muted-foreground)] whitespace-pre-wrap line-clamp-3">{step.body_template}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── ANALYTICS TAB ── */}
                {tab === "analytics" && (
                  <div>
                    {stats ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-4 gap-3">
                          {[
                            { value: stats.total_prospects, label: "Total Prospects", color: "" },
                            { value: stats.total_outreach_actions, label: "Outreach Actions", color: "" },
                            { value: `${stats.reply_rate}%`, label: "Reply Rate", color: "text-green-400" },
                            { value: `${stats.conversion_rate}%`, label: "Conversion Rate", color: "text-emerald-400" },
                          ].map((s, i) => (
                            <div key={i} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-center">
                              <p className={`text-2xl font-bold ${s.color || "text-[var(--foreground)]"}`}>{s.value}</p>
                              <p className="text-xs text-[var(--muted-foreground)]">{s.label}</p>
                            </div>
                          ))}
                        </div>
                        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
                          <h3 className="text-sm font-medium text-[var(--foreground)] mb-3">Prospect Pipeline</h3>
                          <div className="space-y-2">
                            {Object.entries(stats.status_breakdown).map(([status, count]) => (
                              <div key={status} className="flex items-center gap-3">
                                <span className={`text-xs w-28 ${STATUS_COLORS[status] || ""}`}>{STATUS_LABELS[status] || status}</span>
                                <div className="flex-1 h-2 bg-[var(--muted)] rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${status === "converted" || status === "meeting_booked" ? "bg-emerald-400" : status === "replied" ? "bg-green-400" : status === "in_progress" ? "bg-blue-400" : status === "dropped" ? "bg-red-400" : "bg-[var(--muted-foreground)]"}`} style={{ width: `${stats.total_prospects ? (count / stats.total_prospects * 100) : 0}%` }} />
                                </div>
                                <span className="text-xs text-[var(--muted-foreground)] w-8 text-right">{count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {Object.keys(stats.channel_breakdown).length > 0 && (
                          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
                            <h3 className="text-sm font-medium text-[var(--foreground)] mb-3">Channel Mix</h3>
                            <div className="grid grid-cols-3 gap-3">
                              {Object.entries(stats.channel_breakdown).map(([ch, cnt]) => (
                                <div key={ch} className="flex items-center gap-2 text-xs">{stepTypeIcon(ch)}<span className="text-[var(--foreground)]">{STEP_TYPE_LABELS[ch] || ch}</span><span className="text-[var(--muted-foreground)] ml-auto">{cnt}</span></div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-20 text-[var(--muted-foreground)]"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Loading analytics...</div>
                    )}
                  </div>
                )}
              </>
            )}
          </main>
        </>
      )}

      {/* ════════════ MODALS ════════════ */}

      {/* Create Campaign */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg mx-4 bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl p-6">
            <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">New Campaign</h2>
            <div className="space-y-3">
              <div><label className="text-xs text-[var(--muted-foreground)] mb-1 block">Campaign Name *</label><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g., Q1 SaaS Outreach — CTOs" className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" /></div>
              <div><label className="text-xs text-[var(--muted-foreground)] mb-1 block">Description</label><textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Campaign goals, messaging angle..." rows={2} className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] resize-none" /></div>
              <div>
                <label className="text-xs text-[var(--muted-foreground)] mb-2 block">Default Tier</label>
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((t) => (
                    <button key={t} onClick={() => setNewTier(t)} className={`p-2 rounded-lg border text-xs text-left transition-all ${newTier === t ? "border-indigo-500 bg-indigo-500/10" : "border-[var(--border)] hover:border-[var(--muted-foreground)]"}`}>
                      <span className="font-medium block">Tier {t}</span>
                      <span className="text-[var(--muted-foreground)] text-[10px]">{t === 1 ? "High touch" : t === 2 ? "Semi-auto" : "Automated"}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-[var(--muted-foreground)] mb-1 block">Industry</label><input value={newIndustry} onChange={(e) => setNewIndustry(e.target.value)} placeholder="SaaS, Fintech..." className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" /></div>
                <div><label className="text-xs text-[var(--muted-foreground)] mb-1 block">Target Role</label><input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="CTO, VP Engineering..." className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" /></div>
                <div><label className="text-xs text-[var(--muted-foreground)] mb-1 block">Company Size</label><input value={newSize} onChange={(e) => setNewSize(e.target.value)} placeholder="50-500 employees" className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" /></div>
                <div><label className="text-xs text-[var(--muted-foreground)] mb-1 block">Location</label><input value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="USA, Europe..." className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" /></div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={!newName.trim() || creating} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50">{creating ? "Creating..." : "Create Campaign"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Prospect */}
      {showAddProspect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl p-6">
            <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">Add Prospect</h2>
            <div className="space-y-3">
              <input value={apName} onChange={(e) => setApName(e.target.value)} placeholder="Full Name *" className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" />
              <div className="grid grid-cols-2 gap-3">
                <input value={apEmail} onChange={(e) => setApEmail(e.target.value)} placeholder="Email" className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" />
                <input value={apPhone} onChange={(e) => setApPhone(e.target.value)} placeholder="Phone" className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input value={apCompany} onChange={(e) => setApCompany(e.target.value)} placeholder="Company" className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" />
                <input value={apTitle} onChange={(e) => setApTitle(e.target.value)} placeholder="Job Title" className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" />
              </div>
              <input value={apLinkedin} onChange={(e) => setApLinkedin(e.target.value)} placeholder="LinkedIn URL" className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]" />
              <div>
                <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Tier</label>
                <div className="flex gap-2">
                  {[1, 2, 3].map((t) => (
                    <button key={t} onClick={() => setApTier(t)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${(apTier ?? campaign?.default_tier ?? 2) === t ? "border-indigo-500 bg-indigo-500/10 text-indigo-400" : "border-[var(--border)] text-[var(--muted-foreground)]"}`}>Tier {t}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowAddProspect(false)} className="px-4 py-2 rounded-lg text-sm text-[var(--muted-foreground)]">Cancel</button>
              <button onClick={handleAddProspect} disabled={!apName.trim()} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50">Add Prospect</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import */}
      {showBulkAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg mx-4 bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl p-6">
            <h2 className="text-lg font-semibold text-[var(--foreground)] mb-2">Bulk Import</h2>
            <p className="text-xs text-[var(--muted-foreground)] mb-4">Paste CSV: <code className="font-mono bg-[var(--muted)] px-1 rounded">name, email, company, title</code> (one per line)</p>
            <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={"John Doe, john@acme.com, Acme Corp, CTO\nJane Smith, jane@tech.io, Tech Inc, VP Engineering"} rows={8} className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] font-mono resize-none" />
            <div className="flex justify-between items-center mt-4">
              <span className="text-xs text-[var(--muted-foreground)]">{bulkText.trim().split("\n").filter(Boolean).length} prospects detected</span>
              <div className="flex gap-2">
                <button onClick={() => setShowBulkAdd(false)} className="px-4 py-2 rounded-lg text-sm text-[var(--muted-foreground)]">Cancel</button>
                <button onClick={handleBulkAdd} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium">Import</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
