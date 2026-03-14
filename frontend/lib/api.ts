import { API_BASE } from "@/lib/config";

export interface InputSchema {
  type: string;
  properties: Record<string, { type: string; description?: string; default?: unknown }>;
  required?: string[];
}

export interface WorkflowStep {
  action_id: string;
  action_name: string;
  description: string;
  step_number: number;
  input_schema?: InputSchema | null;
}

export interface SearchResultItem {
  tool_name: string;
  display_name?: string;
  tool_id: string;
  transport: string;
  base_url: string;
  page_url?: string | null;
  description: string;
  similarity: number;
  status: string;
  auth_type: string;
  rank: number;
  workflow: WorkflowStep[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AskStreamToken {
  type: "token";
  content: string;
}

export interface AskStreamSources {
  type: "sources";
  sources: SearchResultItem[];
}

export interface AskStreamUsedTool {
  type: "used_tool";
  tool: SearchResultItem;
}

export interface WebSource {
  title: string;
  url: string;
}

export interface AskStreamWebSources {
  type: "web_sources";
  sources: WebSource[];
}

export interface UrlSource {
  url: string;
  title: string;
  status: "ok" | "error";
  error?: string;
}

export interface AskStreamUrlSources {
  type: "url_sources";
  sources: UrlSource[];
}

// ── Job Agent SSE Events ─────────────────────────────────────────────

export interface AgentScreenshot {
  type: "browser_screenshot";
  image: string;   // base64 JPEG
  url: string;
  action: string;
}

export interface AgentStatus {
  type: "agent_status";
  phase: string;    // starting | navigating | acting | done | error
  message: string;
  step?: number;
  action?: string;
  jobs_found?: number;
}

export interface AgentFoundJob {
  type: "agent_found_job";
  title: string;
  company: string;
  url: string;
  description?: string;
}

export interface AgentAsk {
  type: "agent_ask";
  question: string;
  reason: string;
}

export interface AgentError {
  type: "agent_error";
  message: string;
}

type SSEMessage =
  | AskStreamToken
  | AskStreamSources
  | AskStreamUsedTool
  | AskStreamWebSources
  | AskStreamUrlSources
  | AgentScreenshot
  | AgentStatus
  | AgentFoundJob
  | AgentAsk
  | AgentError;

export interface ImagePayload {
  base64: string;
  mime_type: string;
}

export interface DocumentPayload {
  base64: string;
  mime_type: string;
  filename: string;
  text_content: string;
}

export interface SkillPayload {
  id: string;
  name: string;
  instructions: string;
}

export async function* streamAsk(
  query: string,
  history: ChatMessage[] = [],
  images?: ImagePayload[],
  mode: "agentnet" | "web" | "both" = "agentnet",
  documents?: DocumentPayload[],
  enabledSkills?: SkillPayload[],
): AsyncGenerator<SSEMessage, void, unknown> {
  const body: Record<string, unknown> = { query, history, images, documents, mode };
  if (enabledSkills && enabledSkills.length > 0) {
    body.enabled_skills = enabledSkills;
  }
  const res = await fetch(`${API_BASE}/v1/ask/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") return;

      try {
        yield JSON.parse(payload) as SSEMessage;
      } catch {
        // skip malformed
      }
    }
  }
}

export async function sendFeedback(messageContent: string, vote: "up" | "down"): Promise<void> {
  await fetch(`${API_BASE}/v1/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: messageContent, vote }),
  }).catch(() => {});
}

export async function suggestTool(name: string, url: string, reason: string): Promise<void> {
  await fetch(`${API_BASE}/v1/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, url, reason }),
  }).catch(() => {});
}

export interface ToolStats {
  tools: number;
  actions: number;
  categories: number;
}

export async function fetchStats(): Promise<ToolStats> {
  const [toolsRes, capsRes] = await Promise.all([
    fetch(`${API_BASE}/v1/tools`),
    fetch(`${API_BASE}/v1/capabilities`),
  ]);

  const tools = toolsRes.ok ? await toolsRes.json() : [];
  const caps = capsRes.ok ? await capsRes.json() : [];

  return {
    tools: tools.length,
    actions: tools.length * 3,
    categories: caps.length,
  };
}


// ── Job Agent API ────────────────────────────────────────────────────

export type JobAgentSSE = AgentScreenshot | AgentStatus | AgentFoundJob | AgentAsk | AgentError;

export interface StartAgentParams {
  board: string;
  search_query: string;
  location: string;
  job_type?: string;
  max_results?: number;
  url?: string;  // optional: direct URL to a specific job board page
}

export async function* streamJobAgent(
  params: StartAgentParams,
): AsyncGenerator<JobAgentSSE, void, unknown> {
  const res = await fetch(`${API_BASE}/v1/jobs/agent/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new Error(`Job agent error: ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") return;

      try {
        yield JSON.parse(payload) as JobAgentSSE;
      } catch {
        // skip malformed
      }
    }
  }
}

export interface JobProfileData {
  full_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin_url: string;
  portfolio_url: string;
  target_roles: string[];
  target_locations: string[];
  salary_range: string;
  job_type: string;
  additional_info: string;
}

export async function saveJobProfile(data: JobProfileData): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/jobs/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save profile");
}

export async function uploadJobCV(base64: string, filename: string, mimeType: string, textContent: string = ""): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/jobs/profile/cv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64, filename, mime_type: mimeType, text_content: textContent }),
  });
  if (!res.ok) throw new Error("Failed to upload CV");
}

export async function getJobProfile(): Promise<{ exists: boolean; [key: string]: unknown }> {
  const res = await fetch(`${API_BASE}/v1/jobs/profile`);
  if (!res.ok) throw new Error("Failed to get profile");
  return res.json();
}

export interface JobApplicationItem {
  id: string;
  job_title: string;
  company: string;
  job_url: string;
  board: string;
  status: string;
  applied_at: string | null;
  created_at: string;
}

export async function getJobApplications(): Promise<{ applications: JobApplicationItem[] }> {
  const res = await fetch(`${API_BASE}/v1/jobs/applications`);
  if (!res.ok) throw new Error("Failed to get applications");
  return res.json();
}
