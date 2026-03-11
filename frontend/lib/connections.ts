const API_BASE = "http://localhost:8000/v1";

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
  const res = await fetch(`${API_BASE}/oauth/status/${toolId}`, {
    credentials: "include",
  });
  if (!res.ok) return { connected: false };
  return res.json();
}

export function startOAuthFlow(toolId: string) {
  // Redirect directly to the backend (not through Next.js proxy)
  // because OAuth callback from Google goes to the backend directly
  window.location.href = `http://localhost:8000/v1/oauth/google/start?tool_id=${toolId}`;
}

export async function disconnectTool(toolId: string): Promise<void> {
  await fetch(`${API_BASE}/oauth/disconnect/${toolId}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function executeAction(
  actionId: string,
  params: Record<string, unknown> = {}
): Promise<ExecuteResult> {
  const res = await fetch(`${API_BASE}/actions/${actionId}/execute`, {
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
