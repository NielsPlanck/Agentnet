"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Trash2, Clock, MessageSquare, Loader2 } from "lucide-react";
import {
  fetchConversations,
  deleteConversation,
  type ConversationSummary,
} from "@/lib/history";

interface HistorySidebarProps {
  open: boolean;
  onClose: () => void;
  onLoadConversation: (id: string) => void;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function groupByTime(
  conversations: ConversationSummary[]
): { label: string; items: ConversationSummary[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  const groups: { label: string; items: ConversationSummary[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const c of conversations) {
    const d = c.started_at ? new Date(c.started_at) : new Date(0);
    if (d >= today) groups[0].items.push(c);
    else if (d >= yesterday) groups[1].items.push(c);
    else if (d >= weekAgo) groups[2].items.push(c);
    else groups[3].items.push(c);
  }

  return groups.filter((g) => g.items.length > 0);
}

export function HistorySidebar({
  open,
  onClose,
  onLoadConversation,
}: HistorySidebarProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchConversations(100);
      setConversations(data.conversations);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // silently fail
    } finally {
      setDeletingId(null);
    }
  };

  if (!open) return null;

  const groups = groupByTime(conversations);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Sidebar panel */}
      <div className="fixed left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-[var(--card)] border-r border-[var(--border)] z-50 flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[var(--muted-foreground)]" />
            <span className="text-sm font-semibold text-[var(--foreground)]">
              Chat History
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-[var(--muted)] transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <MessageSquare className="h-8 w-8 text-[var(--muted-foreground)] mb-3 opacity-40" />
              <p className="text-sm text-[var(--muted-foreground)]">
                No conversations yet
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1 opacity-60">
                Start a chat and it will appear here
              </p>
            </div>
          ) : (
            <div className="py-2">
              {groups.map((group) => (
                <div key={group.label}>
                  <div className="px-4 py-1.5">
                    <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      {group.label}
                    </span>
                  </div>
                  {group.items.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onLoadConversation(c.id);
                        onClose();
                      }}
                      className="group w-full text-left px-4 py-2.5 hover:bg-[var(--muted)] transition-colors flex items-start gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--foreground)] truncate">
                          {c.title}
                        </p>
                        <p className="text-[0.65rem] text-[var(--muted-foreground)] mt-0.5">
                          {timeAgo(c.started_at)} · {c.message_count} messages
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(c.id, e)}
                        disabled={deletingId === c.id}
                        className="opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--accent)] transition-all text-[var(--muted-foreground)] hover:text-red-400 shrink-0"
                      >
                        {deletingId === c.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
