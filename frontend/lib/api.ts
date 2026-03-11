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

type SSEMessage = AskStreamToken | AskStreamSources | AskStreamUsedTool | AskStreamWebSources;

export interface ImagePayload {
  base64: string;
  mime_type: string;
}

export async function* streamAsk(
  query: string,
  history: ChatMessage[] = [],
  images?: ImagePayload[],
  mode: "agentnet" | "web" | "both" = "agentnet"
): AsyncGenerator<SSEMessage, void, unknown> {
  const res = await fetch("/v1/ask/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, history, images, mode }),
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
  await fetch("/v1/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: messageContent, vote }),
  }).catch(() => {});
}

export async function suggestTool(name: string, url: string, reason: string): Promise<void> {
  await fetch("/v1/suggestions", {
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
    fetch("/v1/tools"),
    fetch("/v1/capabilities"),
  ]);

  const tools = toolsRes.ok ? await toolsRes.json() : [];
  const caps = capsRes.ok ? await capsRes.json() : [];

  return {
    tools: tools.length,
    actions: tools.length * 3,
    categories: caps.length,
  };
}
