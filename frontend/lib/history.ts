/** API client for chat history endpoints */

export interface ConversationSummary {
  id: string;
  title: string;
  started_at: string | null;
  message_count: number;
  preview: string;
}

export interface ConversationMessage {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  tools_shown: { tools?: string[] } | null;
  created_at: string | null;
}

export interface ConversationDetail {
  id: string;
  title: string;
  started_at: string | null;
  messages: ConversationMessage[];
}

export async function fetchConversations(
  limit = 50,
  offset = 0
): Promise<{ conversations: ConversationSummary[]; total: number }> {
  const res = await fetch(
    `/v1/history/conversations?limit=${limit}&offset=${offset}`,
    { credentials: "include" }
  );
  if (!res.ok) throw new Error("Failed to fetch conversations");
  return res.json();
}

export async function fetchConversation(id: string): Promise<ConversationDetail> {
  const res = await fetch(`/v1/history/conversations/${id}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch conversation");
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/v1/history/conversations/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete conversation");
}
