"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { SearchBar, type ImageAttachment } from "@/components/search-bar";
import { ChatMessage } from "@/components/chat-message";
import {
  streamAsk,
  fetchStats,
  type SearchResultItem,
  type ChatMessage as ChatMsg,
  type ToolStats,
  type WebSource,
} from "@/lib/api";
import { Loader2, Plus, Mic } from "lucide-react";
import { LiveVoice, type LiveVoiceHandle } from "@/components/live-voice";

interface MessageImage {
  base64: string;
  mimeType: string;
  preview: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SearchResultItem[];
  usedTool?: SearchResultItem;
  images?: MessageImage[];
  webSources?: WebSource[];
  mode?: "agentnet" | "web" | "both";
}

type VoiceState = "connecting" | "listening" | "speaking" | "error";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<ToolStats | null>(null);
  const [mode, setMode] = useState<"agentnet" | "web" | "both">("agentnet");
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("connecting");
  const bottomRef = useRef<HTMLDivElement>(null);
  const liveVoiceRef = useRef<LiveVoiceHandle>(null);

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const handleSend = useCallback(
    async (query: string, attachments?: ImageAttachment[]) => {
      if (isStreaming) return;

      setError("");

      const msgImages: MessageImage[] | undefined = attachments?.map((a) => ({
        base64: a.base64,
        mimeType: a.mimeType,
        preview: a.preview,
      }));

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: query,
        images: msgImages,
      };

      const assistantId = crypto.randomUUID();
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        sources: [],
        mode,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      const history: ChatMsg[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const apiImages = msgImages?.map((img) => ({
        base64: img.base64,
        mime_type: img.mimeType,
      }));

      let finalContent = "";
      try {
        for await (const msg of streamAsk(query, history, apiImages, mode)) {
          if (msg.type === "token") {
            finalContent += msg.content;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + msg.content }
                  : m
              )
            );
          } else if (msg.type === "sources") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, sources: msg.sources } : m
              )
            );
          } else if (msg.type === "used_tool") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, usedTool: msg.tool } : m
              )
            );
          } else if (msg.type === "web_sources") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, webSources: msg.sources } : m
              )
            );
          }
        }
        // Feed AgentNet response back to Gemini Live so it speaks the answer
        if (voiceActive && finalContent) {
          liveVoiceRef.current?.sendText(finalContent);
        }
      } catch {
        setError("Could not connect to AgentNet. Make sure the server is running.");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, isStreaming, mode, voiceActive]
  );

  const hasMessages = messages.length > 0;

  // Voice glow styles
  const voiceGlowColor =
    voiceState === "speaking"
      ? "rgba(139,92,246,0.55)"   // violet when AI speaks
      : "rgba(99,102,241,0.55)";  // indigo when listening/connecting

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)] relative">

      {/* Page-level voice glow ring */}
      {voiceActive && (
        <div
          className="fixed inset-0 pointer-events-none z-50 transition-all duration-700"
          style={{
            boxShadow: `inset 0 0 0 2.5px ${voiceGlowColor}, inset 0 0 120px ${voiceGlowColor.replace("0.55", "0.08")}`,
            borderRadius: 0,
          }}
        />
      )}

      {/* LiveVoice side-effect component */}
      {voiceActive && (
        <LiveVoice
          ref={liveVoiceRef}
          onTranscript={handleSend}
          onStateChange={setVoiceState}
          onClose={() => setVoiceActive(false)}
        />
      )}

      {/* Landing */}
      {!hasMessages && (
        <div className="flex-1 flex flex-col items-center justify-start pt-4 pb-32 px-4">
          {/* Iris flower logo — click to toggle voice */}
          <button
            type="button"
            onClick={() => setVoiceActive((v) => !v)}
            className="group relative mb-8 flex flex-col items-center gap-3"
            title={voiceActive ? "Stop voice mode" : "Talk to Iris"}
          >
            {/* Flower image with glow ring when voice active */}
            <div className="relative">
              {voiceActive && (
                <span className={`absolute inset-0 rounded-full blur-xl opacity-60 animate-pulse ${
                  voiceState === "speaking" ? "bg-violet-400" : "bg-indigo-400"
                }`} style={{ transform: "scale(1.6)" }} />
              )}
              <img
                src="/iris-logo.png"
                alt="Iris"
                className={`relative h-36 w-auto object-contain transition-all duration-500 ${
                  voiceActive ? "drop-shadow-[0_0_16px_rgba(139,92,246,0.7)]" : "opacity-90 group-hover:opacity-100"
                }`}
              />
            </div>
            {/* Pulsing state label */}
            <span className={`text-[0.65rem] font-medium tracking-[0.18em] uppercase transition-colors ${
              voiceActive
                ? voiceState === "speaking" ? "text-violet-500" : "text-indigo-500"
                : "text-[var(--muted-foreground)] group-hover:text-indigo-400"
            }`}>
              {voiceActive
                ? voiceState === "connecting" ? "Connecting…"
                  : voiceState === "speaking" ? "Speaking"
                  : "Listening"
                : "Iris"}
            </span>
          </button>

          <h1
            className="text-4xl sm:text-5xl font-light text-[var(--foreground)] tracking-tight mb-12 text-center"
            style={{ fontFamily: "'Times New Roman', Georgia, serif" }}
          >
            What can I do for you?
          </h1>
          <SearchBar onSend={handleSend} isStreaming={isStreaming} light mode={mode} onModeChange={setMode} />
        </div>
      )}

      {/* Chat */}
      {hasMessages && (
        <>
          <div className="sticky top-0 z-10 bg-[var(--background)] border-b border-[var(--border)] px-4 py-3 flex items-center">
            <button
              type="button"
              onClick={() => {
                if (!isStreaming) {
                  setMessages([]);
                  setError("");
                }
              }}
              disabled={isStreaming}
              className="flex items-center justify-center h-7 w-7 rounded-lg transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-40"
              aria-label="New chat"
              title="New chat"
            >
              <Plus className="h-4 w-4" />
            </button>

            {/* Iris logo — click to toggle voice */}
            <button
              type="button"
              onClick={() => setVoiceActive((v) => !v)}
              className="group relative flex items-center gap-2 flex-1 justify-center"
              title={voiceActive ? "Stop voice mode" : "Talk to Iris"}
            >
              <div className="relative">
                {voiceActive && (
                  <span className={`absolute inset-0 rounded-full blur-md opacity-70 animate-pulse ${
                    voiceState === "speaking" ? "bg-violet-400" : "bg-indigo-400"
                  }`} style={{ transform: "scale(2)" }} />
                )}
                <img
                  src="/iris-logo.png"
                  alt="Iris"
                  className={`relative h-6 w-auto object-contain transition-all ${
                    voiceActive ? "drop-shadow-[0_0_8px_rgba(139,92,246,0.8)]" : "opacity-70 group-hover:opacity-100"
                  }`}
                />
              </div>
              <span className={`text-xs font-semibold tracking-[0.15em] uppercase transition-colors ${
                voiceActive ? voiceState === "speaking" ? "text-violet-500" : "text-indigo-500"
                : "text-[var(--muted-foreground)] group-hover:text-indigo-400"
              }`}>
                {voiceActive
                  ? voiceState === "speaking" ? "Speaking" : voiceState === "connecting" ? "Connecting…" : "Listening"
                  : "Iris"}
              </span>
              {voiceActive && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${
                    voiceState === "speaking" ? "bg-violet-500" : "bg-indigo-500"
                  }`} />
                  <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                    voiceState === "speaking" ? "bg-violet-500" : "bg-indigo-500"
                  }`} />
                </span>
              )}
            </button>

            <div className="w-7" />
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-8">
            <div className="max-w-2xl mx-auto">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  sources={msg.sources}
                  usedTool={msg.usedTool}
                  images={msg.images}
                  webSources={msg.webSources}
                  mode={msg.mode}
                  isStreaming={
                    isStreaming &&
                    msg.role === "assistant" &&
                    i === messages.length - 1
                  }
                  onSendChoice={handleSend}
                  fetchMoreContext={{
                    history: messages.slice(0, i + 1).map((m) => ({ role: m.role, content: m.content })),
                    mode,
                  }}
                />
              ))}

              {isStreaming &&
                messages[messages.length - 1]?.content === "" && (
                  <div className="flex items-center gap-2 text-[var(--muted-foreground)] ml-10">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span className="text-xs">Thinking...</span>
                  </div>
                )}

              {error && (
                <div className="text-center py-4">
                  <span className="text-xs text-[var(--muted-foreground)]">{error}</span>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          <div className="sticky bottom-0 bg-[var(--background)] border-t border-[var(--border)] px-4 py-3">
            <div className="max-w-2xl mx-auto">
              <SearchBar onSend={handleSend} isStreaming={isStreaming} compact mode={mode} onModeChange={setMode} />
            </div>
          </div>
        </>
      )}

      {/* Stats */}
      {!hasMessages && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-[var(--border)] py-3 flex justify-center gap-10 text-xs text-[var(--muted-foreground)]">
          <span>
            <span className="text-[var(--foreground)] font-semibold tabular-nums">{stats?.tools ?? "--"}</span> tools
          </span>
          <span>
            <span className="text-[var(--foreground)] font-semibold tabular-nums">{stats?.actions ?? "--"}</span> actions
          </span>
          <span>
            <span className="text-[var(--foreground)] font-semibold tabular-nums">{stats?.categories ?? "--"}</span> categories
          </span>
        </div>
      )}
    </div>
  );
}
