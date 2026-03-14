import { API_BASE } from "@/lib/config";

/**
 * Workflow Builder — API client for workflow CRUD and execution.
 */

export interface WorkflowStep {
  id: string;
  position: number;
  step_type: string;
  config: Record<string, unknown>;
  on_success: string;
  on_failure: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger_type: "manual" | "schedule" | "event";
  trigger_config: Record<string, unknown>;
  enabled: boolean;
  steps?: WorkflowStep[];
  created_at: string;
  updated_at: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  status: "running" | "completed" | "failed";
  steps_completed: number;
  result: Record<string, unknown>;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

// ── Step type metadata ──────────────────────────────────────────────

export const STEP_TYPES: {
  type: string;
  label: string;
  icon: string;
  color: string;
  description: string;
}[] = [
  { type: "email_check", label: "Check Email", icon: "Mail", color: "bg-red-100 text-red-700", description: "Scan inbox for new emails" },
  { type: "calendar_check", label: "Check Calendar", icon: "Calendar", color: "bg-blue-100 text-blue-700", description: "Get upcoming calendar events" },
  { type: "apple_action", label: "Apple Action", icon: "Bell", color: "bg-purple-100 text-purple-700", description: "Create reminders, notes, or events" },
  { type: "whatsapp_check", label: "Check WhatsApp", icon: "MessageSquare", color: "bg-green-100 text-green-700", description: "Read recent WhatsApp chats" },
  { type: "llm_call", label: "AI Analysis", icon: "Zap", color: "bg-yellow-100 text-yellow-700", description: "Process data with AI" },
  { type: "notification", label: "Notify", icon: "Bell", color: "bg-indigo-100 text-indigo-700", description: "Send a notification" },
  { type: "condition", label: "Condition", icon: "GitBranch", color: "bg-orange-100 text-orange-700", description: "Branch based on a condition" },
  { type: "memory_save", label: "Save Memory", icon: "Brain", color: "bg-pink-100 text-pink-700", description: "Store result in memory" },
];

// ── API calls ───────────────────────────────────────────────────────

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}/v1/workflows${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`Workflow API error: ${res.status}`);
  return res.json();
}

export async function listWorkflows(): Promise<Workflow[]> {
  const data = await api("/");
  return data.workflows;
}

export async function createWorkflow(name: string, description?: string, triggerType?: string): Promise<Workflow> {
  return api("/", {
    method: "POST",
    body: JSON.stringify({ name, description: description || "", trigger_type: triggerType || "manual" }),
  });
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return api(`/${id}`);
}

export async function updateWorkflow(id: string, updates: Partial<Workflow>): Promise<Workflow> {
  return api(`/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteWorkflow(id: string): Promise<void> {
  await api(`/${id}`, { method: "DELETE" });
}

export async function addStep(workflowId: string, step: { step_type: string; config: Record<string, unknown>; position?: number }): Promise<WorkflowStep> {
  return api(`/${workflowId}/steps`, {
    method: "POST",
    body: JSON.stringify(step),
  });
}

export async function updateStep(workflowId: string, stepId: string, updates: Partial<WorkflowStep>): Promise<WorkflowStep> {
  return api(`/${workflowId}/steps/${stepId}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteStep(workflowId: string, stepId: string): Promise<void> {
  await api(`/${workflowId}/steps/${stepId}`, { method: "DELETE" });
}

export async function runWorkflow(id: string): Promise<{ status: string; run_id: string; steps_completed: number; result: Record<string, unknown> }> {
  return api(`/${id}/run`, { method: "POST" });
}

export async function listRuns(workflowId: string): Promise<WorkflowRun[]> {
  const data = await api(`/${workflowId}/runs`);
  return data.runs;
}
