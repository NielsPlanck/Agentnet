"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  QrCode,
  Wifi,
  WifiOff,
  Search,
  ChevronRight,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

// ── API helpers ─────────────────────────────────────────────────────
async function waApi(path: string, options?: RequestInit) {
  const res = await fetch(`/v1/whatsapp${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`WhatsApp API error: ${res.status}`);
  return res.json();
}

interface WAChat {
  name: string;
  last_message: string;
  unread: number;
  time: string;
}

interface WAMessage {
  sender: string;
  text: string;
  time: string;
  is_me: boolean;
}

// ── Main Page ───────────────────────────────────────────────────────
export default function WhatsAppPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<"disconnected" | "connecting" | "qr_needed" | "connected">("disconnected");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [chats, setChats] = useState<WAChat[]>([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<WAMessage[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  // Check connection status
  const checkStatus = useCallback(async () => {
    try {
      const data = await waApi("/status");
      if (data.authenticated) {
        setStatus("connected");
        setQrImage(null);
      } else if (data.status === "needs_qr") {
        setStatus("qr_needed");
      } else {
        setStatus("disconnected");
      }
    } catch {
      setStatus("disconnected");
    }
  }, []);

  useEffect(() => {
    if (user) checkStatus();
  }, [user, checkStatus]);

  // Load chats when connected
  const loadChats = useCallback(async () => {
    if (status !== "connected") return;
    setLoadingChats(true);
    try {
      const data = await waApi("/chats");
      setChats(data.chats || []);
    } catch (e) {
      setError("Failed to load chats");
    } finally {
      setLoadingChats(false);
    }
  }, [status]);

  useEffect(() => {
    if (status === "connected") loadChats();
  }, [status, loadChats]);

  // Load messages for selected chat
  const loadMessages = useCallback(async (chatName: string) => {
    setLoadingMessages(true);
    try {
      const data = await waApi(`/messages/${encodeURIComponent(chatName)}`);
      setMessages(data.messages || []);
    } catch {
      setError("Failed to load messages");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedChat) loadMessages(selectedChat);
  }, [selectedChat, loadMessages]);

  const handleConnect = async () => {
    setStatus("connecting");
    setError(null);
    try {
      const data = await waApi("/connect", { method: "POST" });
      if (data.qr_screenshot) {
        setQrImage(data.qr_screenshot);
        setStatus("qr_needed");
      } else if (data.authenticated) {
        setStatus("connected");
      }
    } catch (e) {
      setError("Failed to start WhatsApp session. Make sure Playwright is installed.");
      setStatus("disconnected");
    }
  };

  const handleRefreshQR = async () => {
    try {
      const data = await waApi("/qr");
      if (data.qr_screenshot) {
        setQrImage(data.qr_screenshot);
      }
    } catch {
      setError("Failed to refresh QR code");
    }
  };

  const handleSend = async () => {
    if (!selectedChat || !replyText.trim()) return;
    setSending(true);
    try {
      await waApi("/send", {
        method: "POST",
        body: JSON.stringify({ chat_name: selectedChat, message: replyText.trim() }),
      });
      setReplyText("");
      // Reload messages
      await loadMessages(selectedChat);
    } catch {
      setError("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await waApi("/disconnect", { method: "POST" });
      setStatus("disconnected");
      setQrImage(null);
      setChats([]);
      setMessages([]);
      setSelectedChat(null);
    } catch {
      /* ignore */
    }
  };

  const filteredChats = searchQuery
    ? chats.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : chats;

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--background)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      {/* Left panel — Connection & Chat List */}
      <div className="w-80 border-r border-[var(--border)] bg-[var(--card)] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <button onClick={() => router.push("/")} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">WhatsApp</h2>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${status === "connected" ? "bg-green-400" : status === "connecting" || status === "qr_needed" ? "bg-yellow-400 animate-pulse" : "bg-gray-300"}`} />
            <span className="text-[10px] text-[var(--muted-foreground)]">{status === "connected" ? "Connected" : status === "qr_needed" ? "Scan QR" : status === "connecting" ? "Connecting..." : "Disconnected"}</span>
          </div>
        </div>

        {/* Connection panel */}
        {status !== "connected" && (
          <div className="p-4 border-b border-[var(--border)]">
            {status === "disconnected" && (
              <div className="text-center">
                <MessageSquare className="h-10 w-10 mx-auto mb-3 text-green-500 opacity-50" />
                <p className="text-sm text-[var(--muted-foreground)] mb-3">Connect your WhatsApp to read chats and send messages</p>
                <button
                  onClick={handleConnect}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
                >
                  <Wifi className="h-4 w-4" /> Connect WhatsApp
                </button>
              </div>
            )}

            {status === "connecting" && (
              <div className="text-center py-4">
                <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-green-500" />
                <p className="text-sm text-[var(--muted-foreground)]">Starting WhatsApp session...</p>
              </div>
            )}

            {status === "qr_needed" && (
              <div className="text-center">
                <p className="text-xs text-[var(--muted-foreground)] mb-3">Scan this QR code with WhatsApp on your phone</p>
                {qrImage ? (
                  <div className="bg-white rounded-xl p-3 inline-block mx-auto mb-3">
                    <img src={`data:image/png;base64,${qrImage}`} alt="WhatsApp QR Code" className="w-48 h-48" />
                  </div>
                ) : (
                  <div className="bg-[var(--muted)] rounded-xl p-8 mx-auto mb-3 flex items-center justify-center">
                    <QrCode className="h-16 w-16 text-[var(--muted-foreground)] opacity-30" />
                  </div>
                )}
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={handleRefreshQR}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" /> Refresh QR
                  </button>
                  <button
                    onClick={checkStatus}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
                  >
                    <Wifi className="h-3 w-3" /> Check Connection
                  </button>
                </div>
                <p className="text-[10px] text-[var(--muted-foreground)] mt-2">Open WhatsApp &gt; Settings &gt; Linked Devices &gt; Link a Device</p>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        {status === "connected" && (
          <div className="p-2 border-b border-[var(--border)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats..."
                className="w-full text-xs bg-[var(--muted)]/50 border-0 rounded-lg pl-8 pr-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
              />
            </div>
          </div>
        )}

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto">
          {status === "connected" && loadingChats ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
            </div>
          ) : status === "connected" && filteredChats.length === 0 ? (
            <div className="text-center py-8 text-sm text-[var(--muted-foreground)]">No chats found</div>
          ) : (
            filteredChats.map((chat, i) => (
              <button
                key={i}
                onClick={() => setSelectedChat(chat.name)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-[var(--border)] transition-colors ${
                  selectedChat === chat.name ? "bg-[var(--muted)]" : "hover:bg-[var(--muted)]/50"
                }`}
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-green-100 text-green-700 flex-shrink-0">
                  <Users className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--foreground)] truncate">{chat.name}</div>
                  <div className="text-[10px] text-[var(--muted-foreground)] truncate">{chat.last_message}</div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-[9px] text-[var(--muted-foreground)]">{chat.time}</span>
                  {chat.unread > 0 && (
                    <span className="bg-green-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{chat.unread}</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Disconnect button */}
        {status === "connected" && (
          <div className="p-3 border-t border-[var(--border)]">
            <button
              onClick={handleDisconnect}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
            >
              <WifiOff className="h-3 w-3" /> Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Center — Messages */}
      <div className="flex-1 flex flex-col">
        {selectedChat ? (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border)]">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 text-green-700">
                <Users className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">{selectedChat}</h2>
              </div>
              <button
                onClick={() => loadMessages(selectedChat)}
                className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              <button
                onClick={() => { setSelectedChat(null); setMessages([]); }}
                className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loadingMessages ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-8 text-sm text-[var(--muted-foreground)]">No messages loaded</div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.is_me ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] rounded-2xl px-3.5 py-2 ${
                      msg.is_me
                        ? "bg-green-600 text-white rounded-br-md"
                        : "bg-[var(--muted)] text-[var(--foreground)] rounded-bl-md"
                    }`}>
                      {!msg.is_me && (
                        <div className="text-[10px] font-medium text-green-600 mb-0.5">{msg.sender}</div>
                      )}
                      <div className="text-[13px] leading-relaxed">{msg.text}</div>
                      <div className={`text-[9px] mt-1 ${msg.is_me ? "text-green-200" : "text-[var(--muted-foreground)]"}`}>{msg.time}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Reply input */}
            <div className="p-3 border-t border-[var(--border)]">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  placeholder="Type a message..."
                  className="flex-1 text-sm bg-[var(--muted)] border-0 rounded-xl px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !replyText.trim()}
                  className="flex items-center justify-center w-10 h-10 rounded-xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--muted-foreground)]">
            <div className="text-center">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p className="text-sm">Select a chat to view messages</p>
              {status !== "connected" && (
                <p className="text-xs mt-1">Connect WhatsApp first to see your chats</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 z-50">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-white/70 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
