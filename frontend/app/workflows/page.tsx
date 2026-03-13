"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Play,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Settings,
  Loader2,
  Check,
  X,
  GitBranch,
  Mail,
  Calendar,
  Bell,
  MessageSquare,
  Zap,
  Brain,
  ArrowDown,
  Clock,
  Power,
  Save,
  Copy,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import {
  type Workflow,
  type WorkflowStep,
  type WorkflowRun,
  STEP_TYPES,
  listWorkflows,
  createWorkflow,
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
  addStep,
  updateStep,
  deleteStep,
  runWorkflow,
  listRuns,
} from "@/lib/workflows";
import { useAuth } from "@/lib/auth";

// ── Icon map for step types ─────────────────────────────────────────
const STEP_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Mail, Calendar, Bell, MessageSquare, Zap, GitBranch, Brain,
};

function getStepMeta(type: string) {
  return STEP_TYPES.find((s) => s.type === type) || STEP_TYPES[0];
}

// ── Step config field definitions ───────────────────────────────────
interface ConfigField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "textarea";
  placeholder?: string;
  options?: { value: string; label: string }[];
  defaultValue?: string | number;
}

const STEP_CONFIG_FIELDS: Record<string, ConfigField[]> = {
  email_check: [
    { key: "since_hours", label: "Check last N hours", type: "number", placeholder: "4", defaultValue: 4 },
    { key: "max_emails", label: "Max emails to process", type: "number", placeholder: "20", defaultValue: 20 },
  ],
  calendar_check: [
    { key: "days_ahead", label: "Days ahead to check", type: "number", placeholder: "2", defaultValue: 2 },
  ],
  apple_action: [
    { key: "action_type", label: "Action type", type: "select", options: [
      { value: "reminder", label: "Create Reminder" },
      { value: "calendar", label: "Create Calendar Event" },
      { value: "note", label: "Create Note" },
    ], defaultValue: "reminder" },
    { key: "name", label: "Name / Title", type: "text", placeholder: "Follow up with client" },
    { key: "due_date", label: "Due date (for reminders)", type: "text", placeholder: "2026-03-15 09:00" },
    { key: "notes", label: "Notes", type: "textarea", placeholder: "Additional notes..." },
    { key: "list_name", label: "List / Calendar name", type: "text", placeholder: "Reminders" },
    { key: "start", label: "Start (for events)", type: "text", placeholder: "2026-03-15 09:00" },
    { key: "end", label: "End (for events)", type: "text", placeholder: "2026-03-15 10:00" },
    { key: "body", label: "Body (for notes)", type: "textarea", placeholder: "Note content..." },
    { key: "folder", label: "Folder (for notes)", type: "text", placeholder: "Notes" },
  ],
  whatsapp_check: [
    { key: "limit", label: "Number of chats to check", type: "number", placeholder: "10", defaultValue: 10 },
  ],
  llm_call: [
    { key: "prompt", label: "AI Prompt", type: "textarea", placeholder: "Analyze the data from previous steps and summarize key findings..." },
  ],
  notification: [
    { key: "title", label: "Notification title", type: "text", placeholder: "AgentNet Workflow", defaultValue: "AgentNet Workflow" },
    { key: "message", label: "Message", type: "textarea", placeholder: "Workflow completed. {result}" },
  ],
  condition: [
    { key: "field", label: "Field to check", type: "text", placeholder: "urgent_count" },
    { key: "operator", label: "Operator", type: "select", options: [
      { value: "exists", label: "Exists (not empty)" },
      { value: "gt", label: "Greater than" },
      { value: "lt", label: "Less than" },
      { value: "eq", label: "Equals" },
      { value: "contains", label: "Contains" },
    ], defaultValue: "exists" },
    { key: "value", label: "Compare value", type: "text", placeholder: "0" },
  ],
  memory_save: [
    { key: "key", label: "Memory key", type: "text", placeholder: "Workflow result" },
    { key: "content", label: "Content to save", type: "textarea", placeholder: "{result}" },
    { key: "category", label: "Category", type: "select", options: [
      { value: "fact", label: "Fact" },
      { value: "preference", label: "Preference" },
      { value: "decision", label: "Decision" },
      { value: "pattern", label: "Pattern" },
    ], defaultValue: "fact" },
  ],
};

// ── Workflow Templates ──────────────────────────────────────────────
interface WorkflowTemplate {
  name: string;
  description: string;
  icon: string;
  color: string;
  steps: { step_type: string; config: Record<string, unknown> }[];
}

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    name: "Morning Briefing",
    description: "Check email & calendar, then get an AI summary",
    icon: "Zap",
    color: "bg-yellow-100 text-yellow-700",
    steps: [
      { step_type: "email_check", config: { since_hours: 12, max_emails: 20 } },
      { step_type: "calendar_check", config: { days_ahead: 1 } },
      { step_type: "llm_call", config: { prompt: "Create a concise morning briefing from my emails and calendar. Highlight urgent items first, then today's schedule, then important emails to respond to." } },
      { step_type: "notification", config: { title: "Morning Briefing", message: "{result}" } },
    ],
  },
  {
    name: "Urgent Email Alert",
    description: "Check inbox, alert if urgent emails found",
    icon: "Mail",
    color: "bg-red-100 text-red-700",
    steps: [
      { step_type: "email_check", config: { since_hours: 1, max_emails: 10 } },
      { step_type: "condition", config: { field: "urgent_count", operator: "gt", value: "0" } },
      { step_type: "notification", config: { title: "Urgent Emails", message: "You have urgent emails that need attention. {result}" } },
    ],
  },
  {
    name: "Daily Digest & Save",
    description: "Full email + calendar check, AI analysis, save to memory",
    icon: "Brain",
    color: "bg-pink-100 text-pink-700",
    steps: [
      { step_type: "email_check", config: { since_hours: 24, max_emails: 30 } },
      { step_type: "calendar_check", config: { days_ahead: 3 } },
      { step_type: "llm_call", config: { prompt: "Create a comprehensive daily digest. Include: 1) Email summary by priority, 2) Upcoming meetings for next 3 days, 3) Action items. Be concise." } },
      { step_type: "memory_save", config: { key: "Daily Digest", content: "{result}", category: "fact" } },
      { step_type: "notification", config: { title: "Daily Digest Ready", message: "Your daily digest has been saved to memory." } },
    ],
  },
  {
    name: "WhatsApp Monitor",
    description: "Check WhatsApp, summarize with AI, notify",
    icon: "MessageSquare",
    color: "bg-green-100 text-green-700",
    steps: [
      { step_type: "whatsapp_check", config: { limit: 15 } },
      { step_type: "llm_call", config: { prompt: "Summarize the WhatsApp conversations. Highlight any messages that need a reply or contain important information." } },
      { step_type: "notification", config: { title: "WhatsApp Summary", message: "{result}" } },
    ],
  },
];

// ── Step Config Editor Component ────────────────────────────────────
function StepConfigEditor({
  step,
  workflowId,
  onUpdate,
}: {
  step: WorkflowStep;
  workflowId: string;
  onUpdate: () => void;
}) {
  const fields = STEP_CONFIG_FIELDS[step.step_type] || [];
  const [config, setConfig] = useState<Record<string, unknown>>(step.config || {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Initialize defaults
  useEffect(() => {
    const defaults: Record<string, unknown> = {};
    let needsUpdate = false;
    for (const f of fields) {
      if (f.defaultValue !== undefined && config[f.key] === undefined) {
        defaults[f.key] = f.defaultValue;
        needsUpdate = true;
      }
    }
    if (needsUpdate) {
      setConfig((prev) => ({ ...defaults, ...prev }));
    }
  }, [step.step_type]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateStep(workflowId, step.id, { config });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onUpdate();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  if (fields.length === 0) {
    return <div className="text-[10px] text-[var(--muted-foreground)] italic mt-2">No configuration needed for this step.</div>;
  }

  return (
    <div className="mt-3 space-y-2.5 border-t border-[var(--border)]/50 pt-3">
      {fields.map((field) => {
        // Hide irrelevant apple_action fields based on action_type
        if (step.step_type === "apple_action") {
          const actionType = config.action_type as string;
          if (actionType === "reminder" && ["start", "end", "body", "folder", "title"].includes(field.key)) return null;
          if (actionType === "calendar" && ["due_date", "list_name", "body", "folder"].includes(field.key)) return null;
          if (actionType === "note" && ["due_date", "list_name", "start", "end", "name"].includes(field.key)) return null;
          if (actionType === "reminder" && field.key === "name") { /* show */ }
          else if (actionType === "calendar" && field.key === "name") {
            field = { ...field, label: "Event Title" };
          } else if (actionType === "note" && field.key === "name") return null;
        }
        return (
          <div key={field.key}>
            <label className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">{field.label}</label>
            {field.type === "textarea" ? (
              <textarea
                value={String(config[field.key] ?? "")}
                onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                placeholder={field.placeholder}
                rows={3}
                className="w-full mt-1 text-xs bg-[var(--muted)]/50 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50 outline-none focus:border-[var(--primary)]/40 resize-none"
              />
            ) : field.type === "select" ? (
              <select
                value={String(config[field.key] ?? field.defaultValue ?? "")}
                onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                className="w-full mt-1 text-xs bg-[var(--muted)]/50 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[var(--foreground)] outline-none focus:border-[var(--primary)]/40"
              >
                {field.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type}
                value={String(config[field.key] ?? "")}
                onChange={(e) => setConfig({ ...config, [field.key]: field.type === "number" ? Number(e.target.value) : e.target.value })}
                placeholder={field.placeholder}
                className="w-full mt-1 text-xs bg-[var(--muted)]/50 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50 outline-none focus:border-[var(--primary)]/40"
              />
            )}
          </div>
        );
      })}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 disabled:opacity-50 transition-all"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saved ? <Check className="h-3 w-3" /> : <Save className="h-3 w-3" />}
        {saved ? "Saved!" : "Save Config"}
      </button>
    </div>
  );
}

// ── Run Detail Viewer ───────────────────────────────────────────────
function RunDetail({ run }: { run: WorkflowRun }) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = run.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : run.status === "failed" ? <XCircle className="h-3.5 w-3.5 text-red-500" /> : <Loader2 className="h-3.5 w-3.5 text-yellow-500 animate-spin" />;

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full p-3 hover:bg-[var(--muted)]/30 transition-colors text-left"
      >
        {statusIcon}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-[var(--foreground)] font-medium capitalize">{run.status} &middot; {run.steps_completed} step{run.steps_completed !== 1 ? "s" : ""}</div>
          <div className="text-[10px] text-[var(--muted-foreground)]">{new Date(run.started_at).toLocaleString()}</div>
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-[var(--muted-foreground)]" /> : <ChevronDown className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />}
      </button>
      {expanded && (
        <div className="border-t border-[var(--border)] p-3 bg-[var(--muted)]/20">
          {run.error && (
            <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-2 mb-2">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>{run.error}</span>
            </div>
          )}
          {run.result && Object.keys(run.result).length > 0 ? (
            <div className="space-y-1.5">
              {Object.entries(run.result).map(([key, value]) => {
                if (key.startsWith("step_")) {
                  // Namespaced step result
                  const stepResult = value as Record<string, unknown>;
                  return (
                    <div key={key} className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-2">
                      <div className="text-[10px] font-mono text-[var(--primary)] mb-1">{key}</div>
                      <div className="text-[10px] text-[var(--foreground)] font-mono whitespace-pre-wrap break-all">
                        {typeof stepResult === "object" ? JSON.stringify(stepResult, null, 2).slice(0, 500) : String(stepResult).slice(0, 500)}
                      </div>
                    </div>
                  );
                }
                return null;
              })}
              {/* Show non-step keys as summary */}
              {Object.entries(run.result).filter(([k]) => !k.startsWith("step_")).length > 0 && (
                <details className="text-[10px]">
                  <summary className="cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Raw context</summary>
                  <pre className="mt-1 text-[9px] font-mono text-[var(--muted-foreground)] bg-[var(--card)] rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
                    {JSON.stringify(Object.fromEntries(Object.entries(run.result).filter(([k]) => !k.startsWith("step_"))), null, 2).slice(0, 2000)}
                  </pre>
                </details>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-[var(--muted-foreground)] italic">No result data available.</div>
          )}
          {run.completed_at && (
            <div className="text-[9px] text-[var(--muted-foreground)] mt-2">
              Duration: {((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)}s
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showStepPalette, setShowStepPalette] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [showTemplates, setShowTemplates] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState(false);
  const [triggerType, setTriggerType] = useState<string>("manual");
  const [cronExpression, setCronExpression] = useState("");

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  // Load workflows
  const loadWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const wfs = await listWorkflows();
      setWorkflows(wfs);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadWorkflows();
  }, [user, loadWorkflows]);

  // Load selected workflow details
  const loadWorkflowDetail = useCallback(async (id: string) => {
    try {
      const wf = await getWorkflow(id);
      setSelectedWorkflow(wf);
      setTriggerType(wf.trigger_type);
      setCronExpression((wf.trigger_config as Record<string, string>)?.cron || "");
      const r = await listRuns(id);
      setRuns(r);
    } catch {
      setSelectedWorkflow(null);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedWorkflow(null);
      setRuns([]);
      return;
    }
    loadWorkflowDetail(selectedId);
  }, [selectedId, loadWorkflowDetail]);

  const toggleStepExpanded = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const wf = await createWorkflow(newName.trim());
      setWorkflows((prev) => [wf, ...prev]);
      setSelectedId(wf.id);
      setNewName("");
      setCreating(false);
    } catch {
      /* ignore */
    }
  };

  const handleCreateFromTemplate = async (template: WorkflowTemplate) => {
    try {
      const wf = await createWorkflow(template.name, template.description);
      // Add steps sequentially
      for (const step of template.steps) {
        await addStep(wf.id, step);
      }
      setWorkflows((prev) => [wf, ...prev]);
      setSelectedId(wf.id);
      setShowTemplates(false);
    } catch {
      /* ignore */
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkflow(id);
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch {
      /* ignore */
    }
  };

  const handleRun = async () => {
    if (!selectedId) return;
    setRunning(true);
    try {
      await runWorkflow(selectedId);
      const r = await listRuns(selectedId);
      setRuns(r);
    } catch {
      /* ignore */
    } finally {
      setRunning(false);
    }
  };

  const handleAddStep = async (stepType: string) => {
    if (!selectedId) return;
    try {
      // Apply defaults from config fields
      const fields = STEP_CONFIG_FIELDS[stepType] || [];
      const defaultConfig: Record<string, unknown> = {};
      for (const f of fields) {
        if (f.defaultValue !== undefined) defaultConfig[f.key] = f.defaultValue;
      }
      const newStep = await addStep(selectedId, { step_type: stepType, config: defaultConfig });
      await loadWorkflowDetail(selectedId);
      setShowStepPalette(false);
      // Auto-expand new step for configuration
      setExpandedSteps((prev) => new Set(prev).add(newStep.id));
    } catch {
      /* ignore */
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!selectedId) return;
    try {
      await deleteStep(selectedId, stepId);
      await loadWorkflowDetail(selectedId);
    } catch {
      /* ignore */
    }
  };

  const handleToggle = async (wf: Workflow) => {
    try {
      await updateWorkflow(wf.id, { enabled: !wf.enabled } as Partial<Workflow>);
      setWorkflows((prev) => prev.map((w) => w.id === wf.id ? { ...w, enabled: !w.enabled } : w));
      if (selectedWorkflow?.id === wf.id) {
        setSelectedWorkflow({ ...selectedWorkflow, enabled: !selectedWorkflow.enabled });
      }
    } catch {
      /* ignore */
    }
  };

  const handleSaveTrigger = async () => {
    if (!selectedId) return;
    try {
      const triggerConfig: Record<string, unknown> = {};
      if (triggerType === "schedule" && cronExpression) {
        triggerConfig.cron = cronExpression;
      }
      await updateWorkflow(selectedId, {
        trigger_type: triggerType as "manual" | "schedule" | "event",
        trigger_config: triggerConfig,
      } as Partial<Workflow>);
      await loadWorkflowDetail(selectedId);
      setEditingTrigger(false);
    } catch {
      /* ignore */
    }
  };

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--background)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      {/* Left panel — Workflow list */}
      <div className="w-72 border-r border-[var(--border)] bg-[var(--card)] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <button onClick={() => router.push("/")} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Workflows</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowTemplates(true)}
              className="p-1.5 rounded-lg hover:bg-[var(--muted)] transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              title="Create from template"
            >
              <Sparkles className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCreating(true)}
              className="p-1.5 rounded-lg hover:bg-[var(--muted)] transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              title="Create blank workflow"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {creating && (
          <div className="p-3 border-b border-[var(--border)]">
            <input
              type="text"
              placeholder="Workflow name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
              className="w-full text-sm bg-[var(--muted)] border-0 rounded-lg px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={handleCreate} className="text-xs px-3 py-1 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90">Create</button>
              <button onClick={() => { setCreating(false); setNewName(""); }} className="text-xs px-3 py-1 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)]">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
            </div>
          ) : workflows.length === 0 ? (
            <div className="text-center py-8 text-sm text-[var(--muted-foreground)]">
              <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No workflows yet</p>
              <button
                onClick={() => setShowTemplates(true)}
                className="mt-2 text-xs text-[var(--primary)] hover:underline"
              >
                Start from a template
              </button>
            </div>
          ) : (
            workflows.map((wf) => (
              <button
                key={wf.id}
                onClick={() => setSelectedId(wf.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-[var(--border)] transition-colors ${
                  selectedId === wf.id ? "bg-[var(--muted)]" : "hover:bg-[var(--muted)]/50"
                }`}
              >
                <GitBranch className="h-4 w-4 flex-shrink-0 text-[var(--primary)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--foreground)] truncate">{wf.name}</div>
                  <div className="text-[10px] text-[var(--muted-foreground)]">
                    {wf.trigger_type} {wf.enabled ? "" : "· disabled"}
                  </div>
                </div>
                <div className={`w-2 h-2 rounded-full ${wf.enabled ? "bg-green-400" : "bg-gray-300"}`} />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Template modal */}
      {showTemplates && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-[var(--card)] rounded-2xl border border-[var(--border)] w-full max-w-lg mx-4 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Workflow Templates</h3>
              <button onClick={() => setShowTemplates(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
              {WORKFLOW_TEMPLATES.map((t, i) => {
                const Icon = STEP_ICON_MAP[t.icon] || Zap;
                return (
                  <button
                    key={i}
                    onClick={() => handleCreateFromTemplate(t)}
                    className="w-full flex items-start gap-3 p-3 rounded-xl border border-[var(--border)] hover:bg-[var(--muted)]/50 hover:border-[var(--primary)]/30 transition-colors text-left"
                  >
                    <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${t.color} flex-shrink-0`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--foreground)]">{t.name}</div>
                      <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{t.description}</div>
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {t.steps.map((s, j) => {
                          const sm = getStepMeta(s.step_type);
                          return (
                            <span key={j} className={`text-[8px] px-1.5 py-0.5 rounded ${sm.color}`}>{sm.label}</span>
                          );
                        })}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Center — Workflow canvas */}
      <div className="flex-1 flex flex-col">
        {selectedWorkflow ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border)]">
              <div className="flex-1 min-w-0">
                <h1 className="text-lg font-semibold text-[var(--foreground)]">{selectedWorkflow.name}</h1>
                {selectedWorkflow.description && (
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{selectedWorkflow.description}</p>
                )}
              </div>

              {/* Trigger config */}
              <button
                onClick={() => setEditingTrigger(!editingTrigger)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                <Clock className="h-3 w-3" />
                {selectedWorkflow.trigger_type === "schedule" ? "Scheduled" : selectedWorkflow.trigger_type === "event" ? "Event" : "Manual"}
              </button>

              <button
                onClick={() => handleToggle(selectedWorkflow)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedWorkflow.enabled
                    ? "bg-green-50 text-green-700 hover:bg-green-100"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                <Power className="h-3 w-3" />
                {selectedWorkflow.enabled ? "Enabled" : "Disabled"}
              </button>
              <button
                onClick={handleRun}
                disabled={running}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Run Now
              </button>
              <button
                onClick={() => handleDelete(selectedWorkflow.id)}
                className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {/* Trigger editor */}
            {editingTrigger && (
              <div className="px-6 py-3 border-b border-[var(--border)] bg-[var(--muted)]/20">
                <div className="max-w-lg space-y-2">
                  <label className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">Trigger Type</label>
                  <div className="flex gap-2">
                    {["manual", "schedule", "event"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setTriggerType(t)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          triggerType === t
                            ? "bg-[var(--foreground)] text-[var(--background)]"
                            : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        }`}
                      >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                  {triggerType === "schedule" && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">Cron Expression</label>
                      <input
                        type="text"
                        value={cronExpression}
                        onChange={(e) => setCronExpression(e.target.value)}
                        placeholder="0 8 * * * (every day at 8am)"
                        className="w-full text-xs bg-[var(--muted)]/50 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50 outline-none focus:border-[var(--primary)]/40 font-mono"
                      />
                      <div className="text-[9px] text-[var(--muted-foreground)]">
                        Examples: <code className="bg-[var(--muted)] px-1 rounded">0 8 * * *</code> daily 8am &middot; <code className="bg-[var(--muted)] px-1 rounded">0 8 * * 1-5</code> weekdays 8am &middot; <code className="bg-[var(--muted)] px-1 rounded">*/30 * * * *</code> every 30min
                      </div>
                    </div>
                  )}
                  <button
                    onClick={handleSaveTrigger}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-all"
                  >
                    <Save className="h-3 w-3" /> Save Trigger
                  </button>
                </div>
              </div>
            )}

            {/* Step Canvas */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-lg mx-auto space-y-0">
                {selectedWorkflow.steps && selectedWorkflow.steps.length > 0 ? (
                  selectedWorkflow.steps.map((step, i) => {
                    const meta = getStepMeta(step.step_type);
                    const Icon = STEP_ICON_MAP[meta.icon] || Zap;
                    const isExpanded = expandedSteps.has(step.id);
                    return (
                      <div key={step.id}>
                        {/* Step card */}
                        <div className={`relative group rounded-xl border bg-[var(--card)] transition-colors ${isExpanded ? "border-[var(--primary)]/40" : "border-[var(--border)] hover:border-[var(--primary)]/20"}`}>
                          <button
                            onClick={() => toggleStepExpanded(step.id)}
                            className="flex items-center gap-3 w-full p-4 text-left"
                          >
                            <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${meta.color}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-[var(--foreground)]">{meta.label}</div>
                              <div className="text-[10px] text-[var(--muted-foreground)]">
                                {Object.keys(step.config).length > 0
                                  ? Object.entries(step.config).filter(([, v]) => v).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).slice(0, 2).join(" · ")
                                  : meta.description}
                              </div>
                            </div>
                            <span className="text-[9px] text-[var(--muted-foreground)] bg-[var(--muted)] px-1.5 py-0.5 rounded">{i + 1}</span>
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-[var(--muted-foreground)]" /> : <Settings className="h-3.5 w-3.5 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity" />}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteStep(step.id); }}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </button>

                          {/* Expanded config editor */}
                          {isExpanded && (
                            <div className="px-4 pb-4">
                              <StepConfigEditor
                                step={step}
                                workflowId={selectedWorkflow.id}
                                onUpdate={() => loadWorkflowDetail(selectedWorkflow.id)}
                              />
                            </div>
                          )}
                        </div>

                        {/* Connector arrow */}
                        {i < selectedWorkflow.steps!.length - 1 && (
                          <div className="flex justify-center py-1">
                            <ArrowDown className="h-4 w-4 text-[var(--muted-foreground)]/40" />
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-12 text-[var(--muted-foreground)]">
                    <GitBranch className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">No steps yet. Add steps to build your workflow.</p>
                  </div>
                )}

                {/* Add step button */}
                <div className="flex justify-center pt-4">
                  <button
                    onClick={() => setShowStepPalette(!showStepPalette)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border-2 border-dashed border-[var(--border)] text-sm text-[var(--muted-foreground)] hover:border-[var(--primary)]/40 hover:text-[var(--foreground)] transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Add Step
                  </button>
                </div>

                {/* Step palette */}
                {showStepPalette && (
                  <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                    <div className="text-xs font-medium text-[var(--muted-foreground)] mb-2">Choose a step type:</div>
                    <div className="grid grid-cols-2 gap-2">
                      {STEP_TYPES.map((st) => {
                        const Icon = STEP_ICON_MAP[st.icon] || Zap;
                        return (
                          <button
                            key={st.type}
                            onClick={() => handleAddStep(st.type)}
                            className="flex items-center gap-2 p-2.5 rounded-lg border border-[var(--border)] hover:bg-[var(--muted)]/50 hover:border-[var(--primary)]/30 transition-colors text-left"
                          >
                            <div className={`flex items-center justify-center w-7 h-7 rounded-lg ${st.color}`}>
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div>
                              <div className="text-xs font-medium text-[var(--foreground)]">{st.label}</div>
                              <div className="text-[9px] text-[var(--muted-foreground)]">{st.description}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Recent runs */}
              {runs.length > 0 && (
                <div className="max-w-lg mx-auto mt-8 pt-6 border-t border-[var(--border)]">
                  <h3 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-3">Recent Runs</h3>
                  <div className="space-y-2">
                    {runs.slice(0, 10).map((run) => (
                      <RunDetail key={run.id} run={run} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--muted-foreground)]">
            <div className="text-center">
              <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p className="text-sm">Select a workflow or create a new one</p>
              <p className="text-xs mt-1">Chain email, calendar, WhatsApp, and AI actions together</p>
              <button
                onClick={() => setShowTemplates(true)}
                className="mt-4 flex items-center gap-1.5 mx-auto px-4 py-2 rounded-xl text-xs font-medium bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-all"
              >
                <Sparkles className="h-3.5 w-3.5" /> Start from Template
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
