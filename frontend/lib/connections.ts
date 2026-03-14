import { API_BASE } from "@/lib/config";

export interface ConnectionStatus {
  connected: boolean;
  provider?: string;
  scopes?: string;
  expires_at?: string;
}

export interface ExecuteResult {
  success: boolean;
  data?: Record<string, unknown> | unknown[] | null;
  error?: string | null;
}

export async function checkConnection(toolId: string): Promise<ConnectionStatus> {
  const res = await fetch(`${API_BASE}/v1/oauth/status/${toolId}`, {
    credentials: "include",
  });
  if (!res.ok) return { connected: false };
  return res.json();
}

export function startOAuthFlow(toolId: string) {
  window.location.href = `${API_BASE}/v1/oauth/google/start?tool_id=${toolId}`;
}

export async function disconnectTool(toolId: string): Promise<void> {
  await fetch(`${API_BASE}/v1/oauth/disconnect/${toolId}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function executeAction(
  actionId: string,
  params: Record<string, unknown> = {}
): Promise<ExecuteResult> {
  const res = await fetch(`${API_BASE}/v1/actions/${actionId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ params }),
  });
  if (!res.ok) {
    return { success: false, error: `HTTP ${res.status}` };
  }
  return res.json();
}
