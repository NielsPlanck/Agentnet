"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowUp, Square, Plus, X, Globe, Zap, Code2, TrendingUp, Bot, Search, FlaskConical, Sparkles, Target, Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { RecordingIndicator } from "@/components/voice-wave";

// ── Rotating placeholder examples ────────────────────────────────────────────
const PLACEHOLDER_EXAMPLES = [
  "Find me the cheapest flight from Paris to New York next weekend",
  "Run a full security audit on my GitHub repo and flag vulnerabilities",
  "Create an internal agent that monitors my AWS costs and alerts on spikes",
  "Analyze our Q4 revenue data and generate an executive summary",
  "Build me a HIPAA-compliant patient intake workflow with MedTech tools",
  "Deploy a RAG pipeline over our internal docs using open-source tools",
  "Find all Series B fintech companies that raised in the last 6 months",
  "Write and run a Python script to clean and deduplicate my CSV dataset",
  "Scan my codebase for SQL injection and XSS vulnerabilities",
  "Build a list of 20 Series A AI startups in Europe with founder emails",
  "Create a B2B outreach campaign for fintech decision-makers in the US",
  "Generate a cold email sequence for VP Sales at SaaS companies",
];

// ── Categorised prompt examples ───────────────────────────────────────────────
export const PROMPT_CATEGORIES = [
  {
    id: "life",
    label: "Life",
    icon: Sparkles,
    prompts: [
      "Find me an apartment to rent in Paris",
      "Book me a flight from Paris to New York next weekend",
      "Order me a burger delivered to my home",
      "Plan a 5-day trip to Tokyo with hotels and activities",
    ],
  },
  {
    id: "agents",
    label: "Agents",
    icon: Bot,
    prompts: [
      "Send me a morning briefing every day with my calendar, tasks, and weather",
      "Notify me when my flight is delayed and find me the next available one",
      "Connect to my email and summarize investor updates every Monday",
      "Alert me when a competitor launches a new product or funding round",
    ],
  },
  {
    id: "code",
    label: "Code",
    icon: Code2,
    prompts: [
      "Do a full code review of my web application and flag issues",
      "Build me a landing page for my SaaS product",
      "Review my React codebase for performance and accessibility issues",
      "Vibe code with me on a new feature",
    ],
  },
  {
    id: "research",
    label: "Research",
    icon: Search,
    prompts: [
      "Find all Series B fintech companies that raised in the last 6 months",
      "Build a list of 20 Series A AI startups in Europe with founder emails",
      "Generate a competitive analysis for Stripe vs Adyen vs Braintree",
      "Find recent academic papers on RAG and summarise key findings",
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: TrendingUp,
    prompts: [
      "Analyse our Q4 revenue data and generate an executive summary",
      "Model three growth scenarios for our SaaS business for 2025",
      "Build an investor update template with key metrics and charts",
      "Find all VCs actively investing in fintech Series A right now",
    ],
  },
  {
    id: "science",
    label: "Science",
    icon: FlaskConical,
    prompts: [
      "Find the latest clinical trials for GLP-1 receptor agonists and summarise",
      "Analyse a genomic dataset and flag statistically significant variants",
      "Search PubMed for papers on CRISPR base editing published in 2024",
      "Compare FDA approval pathways for SaMD vs traditional medical devices",
    ],
  },
  {
    id: "campaigns",
    label: "Marketing",
    icon: Target,
    prompts: [
      "Create a multichannel outreach campaign targeting SaaS CTOs in Europe",
      "Add 5 prospects to my campaign and generate personalized email sequences",
      "Generate a 5-step outreach sequence: email, LinkedIn connect, follow-up, call, reminder",
      "Enrich my prospect John Doe at Acme Corp and write a personalized cold email",
    ],
  },
];

// ── Prompt category panel ─────────────────────────────────────────────────────
function PromptPanel({
  category,
  onSelect,
  onClose,
}: {
  category: typeof PROMPT_CATEGORIES[0];
  onSelect: (p: string) => void;
  onClose: () => void;
}) {
  const Icon = category.icon;
  return (
    <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)]">
          <Icon className="h-4 w-4" />
          {category.label}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Prompt list */}
      <div className="divide-y divide-[var(--border)]">
        {category.prompts.map((prompt, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(prompt)}
            className="w-full text-left px-5 py-3.5 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Types & helpers ───────────────────────────────────────────────────────────
const MIN_ROWS = 1;
const MAX_ROWS = 6;
const LINE_HEIGHT = 24;

export interface ImageAttachment {
  id: string;
  file: File;
  preview: string;
  base64: string;
  mimeType: string;
  type: "image" | "document";
  fileName?: string;
  textContent?: string;  // Pre-extracted text for text files
}

// File types the chat accepts
const ACCEPTED_FILES = ".pdf,.doc,.docx,.txt,.csv,.md,.json,.xml,.yaml,.yml,.py,.js,.ts,.png,.jpg,.jpeg,.gif,.webp,.svg";
const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".md", ".json", ".xml", ".yaml", ".yml", ".py", ".js", ".ts", ".html"]);
const DOC_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);

function getFileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/") || file.type === "application/json") return true;
  return TEXT_EXTENSIONS.has(getFileExt(file.name));
}

interface SearchBarProps {
  onSend: (query: string, images?: ImageAttachment[]) => void;
  isStreaming: boolean;
  compact?: boolean;
  light?: boolean;
  mode?: "agentnet" | "web" | "both";
  onModeChange?: (mode: "agentnet" | "web" | "both") => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ── SearchBar ─────────────────────────────────────────────────────────────────
export function SearchBar({ onSend, isStreaming, compact, light, mode = "agentnet", onModeChange }: SearchBarProps) {
  const agentnetOn = mode === "agentnet" || mode === "both";
  const webOn = mode === "web" || mode === "both";

  const toggleAgentnet = () => {
    if (!onModeChange) return;
    if (agentnetOn && webOn) onModeChange("web");
    else if (agentnetOn) return;
    else onModeChange("both");
  };

  const toggleWeb = () => {
    if (!onModeChange) return;
    if (webOn && agentnetOn) onModeChange("agentnet");
    else if (webOn) return;
    else onModeChange("both");
  };

  const [value, setValue] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [sttStatus, setSttStatus] = useState<"idle" | "connecting" | "listening" | "error">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sttWsRef = useRef<WebSocket | null>(null);
  const sttStreamRef = useRef<MediaStream | null>(null);
  const sttProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sttAudioCtxRef = useRef<AudioContext | null>(null);
  const sttBaseTextRef = useRef("");
  const sttPartialRef = useRef("");

  // Rotate placeholder
  useEffect(() => {
    if (compact) return;
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length), 3500);
    return () => clearInterval(id);
  }, [compact]);

  // Auto-height textarea — use rAF to avoid layout thrashing on every keystroke
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.style.height = "auto";
      const lines = el.value.split("\n").length;
      el.style.height = `${Math.min(MAX_ROWS, Math.max(MIN_ROWS, lines)) * LINE_HEIGHT}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = value.trim().replace(/\n+/g, "\n");
    if ((query || images.length > 0) && !isStreaming) {
      const fallback = images.some((a) => a.type === "document")
        ? "Analyze this document"
        : "What is this image?";
      onSend(query || fallback, images.length > 0 ? images : undefined);
      setValue("");
      setImages([]);
      setActiveCategory(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newAttachments: ImageAttachment[] = [];
    for (const file of Array.from(files)) {
      const base64 = await fileToBase64(file);

      if (file.type.startsWith("image/")) {
        // Image — same as before
        newAttachments.push({
          id: crypto.randomUUID(), file, preview: URL.createObjectURL(file),
          base64, mimeType: file.type, type: "image", fileName: file.name,
        });
      } else {
        // Document — extract text for text files, show filename for others
        let textContent = "";
        if (isTextFile(file)) {
          try { textContent = await fileToText(file); } catch { /* ignore */ }
        }
        newAttachments.push({
          id: crypto.randomUUID(), file, preview: file.name,
          base64, mimeType: file.type || "application/octet-stream",
          type: "document", fileName: file.name, textContent,
        });
      }
    }
    setImages((prev) => [...prev, ...newAttachments]);
    e.target.value = "";
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.preview);
      return prev.filter((i) => i.id !== id);
    });
  };

  const handlePromptSelect = (prompt: string) => {
    if (!isStreaming) {
      onSend(prompt);
      setActiveCategory(null);
    }
  };

  // ── Voice input (OpenAI GPT-4o Realtime Transcription) ──────────────────
  const stopRecording = useCallback(() => {
    sttProcessorRef.current?.disconnect();
    sttStreamRef.current?.getTracks().forEach((t) => t.stop());
    sttAudioCtxRef.current?.close().catch(() => {});
    if (sttWsRef.current && sttWsRef.current.readyState === WebSocket.OPEN) {
      try { sttWsRef.current.send(JSON.stringify({ type: "stop" })); } catch {}
    }
    sttWsRef.current?.close();
    sttProcessorRef.current = null;
    sttStreamRef.current = null;
    sttAudioCtxRef.current = null;
    sttWsRef.current = null;
    sttPartialRef.current = "";
    setIsRecording(false);
    setSttStatus("idle");
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setSttStatus("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sttStreamRef.current = stream;
      sttBaseTextRef.current = valueRef.current;
      sttPartialRef.current = "";

      // Build WS URL: in dev (Next.js on 3001) → backend on 8000; else same origin
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      let wsUrl: string;
      if (window.location.port === "3001") {
        wsUrl = `${protocol}//${window.location.hostname}:8000/v1/stt`;
      } else {
        wsUrl = `${protocol}//${window.location.host}/v1/stt`;
      }
      console.log("[STT] Connecting to:", wsUrl);
      const ws = new WebSocket(wsUrl);
      sttWsRef.current = ws;

      ws.onopen = () => {
        // WebSocket connected — wait for "ready" from backend
        console.log("[STT] WebSocket connected, waiting for ready...");
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "ready") {
            // Backend has connected to OpenAI — start sending audio
            console.log("[STT] Backend ready, starting audio capture");
            const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({ sampleRate: 24000 });
            sttAudioCtxRef.current = ctx;
            const src = ctx.createMediaStreamSource(stream);
            const proc = ctx.createScriptProcessor(4096, 1, 1);
            sttProcessorRef.current = proc;

            proc.onaudioprocess = (e) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              const f32 = e.inputBuffer.getChannelData(0);
              const i16 = new Int16Array(f32.length);
              for (let i = 0; i < f32.length; i++) {
                i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
              }
              ws.send(i16.buffer);
            };

            src.connect(proc);
            proc.connect(ctx.destination);
            setIsRecording(true);
            setSttStatus("listening");
          } else if (msg.type === "delta") {
            sttPartialRef.current += msg.text;
            const base = sttBaseTextRef.current;
            setValue(base + (base ? " " : "") + sttPartialRef.current);
          } else if (msg.type === "transcript") {
            const base = sttBaseTextRef.current;
            sttBaseTextRef.current = base + (base ? " " : "") + msg.text;
            sttPartialRef.current = "";
            setValue(sttBaseTextRef.current);
          } else if (msg.type === "error") {
            console.error("[STT] Error:", msg.message);
            setSttStatus("error");
            stopRecording();
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        console.log("[STT] WebSocket closed");
        setIsRecording(false);
        setSttStatus("idle");
      };
      ws.onerror = (err) => {
        console.error("[STT] WebSocket error:", err);
        setSttStatus("error");
        stopRecording();
      };
    } catch (err) {
      console.error("[STT] Mic access error:", err);
      setSttStatus("error");
      setTimeout(() => setSttStatus("idle"), 2000);
    }
  }, [stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sttWsRef.current) {
        sttProcessorRef.current?.disconnect();
        sttStreamRef.current?.getTracks().forEach((t) => t.stop());
        sttAudioCtxRef.current?.close().catch(() => {});
        sttWsRef.current?.close();
      }
    };
  }, []);

  const toggleRecording = () => {
    if (isRecording || sttStatus === "connecting") stopRecording();
    else startRecording();
  };

  const hasContent = value.trim() || images.length > 0;

  /* ── Compact (in-chat) variant ── */
  if (compact) {
    return (
      <div className="w-full max-w-2xl px-0 sm:px-4">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] focus-within:border-[var(--ring)] p-2 transition-[border-color,box-shadow] focus-within:shadow-sm"
        >
          {images.length > 0 && (
            <div className="flex gap-2 px-1 pb-2 flex-wrap">
              {images.map((att) => (
                <div key={att.id} className="relative group">
                  {att.type === "image" ? (
                    <img src={att.preview} alt="Attached" className="h-14 w-14 object-cover rounded-lg border border-[var(--border)]" />
                  ) : (
                    <div className="h-14 px-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] text-xs text-[var(--muted-foreground)] max-w-[180px]">
                      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      <span className="truncate">{att.fileName || "document"}</span>
                    </div>
                  )}
                  <button type="button" onClick={() => removeImage(att.id)}
                    className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-neutral-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileInputRef} type="file" accept={ACCEPTED_FILES} multiple className="hidden" onChange={handleFileSelect} />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="flex shrink-0 items-center justify-center rounded-lg h-8 w-8 transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]" aria-label="Attach image">
              <Plus className="h-4 w-4" />
            </button>
            <textarea ref={textareaRef} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Ask a follow-up..." autoFocus rows={MIN_ROWS} disabled={isStreaming}
              className="min-h-[32px] w-full min-w-0 max-h-[144px] resize-none overflow-y-auto border-0 bg-transparent text-sm leading-6 outline-none disabled:opacity-60 py-1 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
              style={{ height: LINE_HEIGHT * MIN_ROWS }} aria-label="Prompt" />
            {onModeChange && (
              <div className="flex shrink-0 items-center rounded-lg p-0.5 gap-0.5 bg-[var(--muted)]">
                <button type="button" onClick={toggleAgentnet}
                  className={cn("flex items-center gap-1 px-2 py-1 rounded-md text-[0.7rem] font-medium transition-colors",
                    agentnetOn ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}>
                  <Zap className="h-3 w-3" /> AgentNet
                </button>
                <button type="button" onClick={toggleWeb}
                  className={cn("flex items-center gap-1 px-2 py-1 rounded-md text-[0.7rem] font-medium transition-colors",
                    webOn ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}>
                  <Globe className="h-3 w-3" /> Web
                </button>
              </div>
            )}
            <button type="button" onClick={toggleRecording} disabled={isStreaming || sttStatus === "connecting"}
              className={cn("flex shrink-0 items-center justify-center rounded-lg h-8 w-8 transition-all",
                isRecording || sttStatus === "connecting"
                  ? "bg-red-500 text-white hover:bg-red-600 shadow-[0_0_12px_rgba(239,68,68,0.4)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}
              aria-label={isRecording ? "Stop recording" : "Voice input"}>
              {isRecording || sttStatus === "connecting" ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            </button>
            <button type={isStreaming ? "button" : "submit"} disabled={!isStreaming && !hasContent}
              className={cn("flex shrink-0 items-center justify-center rounded-lg h-8 w-8 transition-colors",
                isStreaming ? "bg-red-500 text-white hover:bg-red-600" : hasContent ? "bg-[var(--foreground)] text-[var(--card)] hover:opacity-90" : "text-[var(--muted-foreground)]/40")}
              aria-label={isStreaming ? "Stop" : "Send"}>
              {isStreaming ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
          <RecordingIndicator isRecording={isRecording} onStop={stopRecording} status={sttStatus} />
        </form>
      </div>
    );
  }

  /* ── Landing (light) variant ── */
  return (
    <div className="w-full max-w-3xl px-1 sm:px-4">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] transition-[border-color,box-shadow] focus-within:border-[var(--ring)] focus-within:shadow-sm"
      >
        {/* Attachment previews */}
        {images.length > 0 && (
          <div className="flex gap-2 px-4 pt-4 flex-wrap">
            {images.map((att) => (
              <div key={att.id} className="relative group">
                {att.type === "image" ? (
                  <img src={att.preview} alt="Attached" className="h-14 w-14 object-cover rounded-lg border border-[var(--border)]" />
                ) : (
                  <div className="h-14 px-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] text-xs text-[var(--muted-foreground)] max-w-[200px]">
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <span className="truncate">{att.fileName || "document"}</span>
                  </div>
                )}
                <button type="button" onClick={() => removeImage(att.id)}
                  className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-[var(--foreground)] text-[var(--background)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea */}
        <textarea ref={textareaRef} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDER_EXAMPLES[placeholderIdx]} autoFocus rows={3} disabled={isStreaming}
          className="w-full resize-none border-0 bg-transparent text-base leading-6 outline-none disabled:opacity-60 px-5 pt-5 pb-3 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] max-h-[240px] overflow-y-auto transition-all"
          style={{ minHeight: "100px" }} aria-label="Prompt" />

        {/* Bottom row */}
        <div className="flex items-center justify-between px-4 pb-4 pt-1 gap-2">
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept={ACCEPTED_FILES} multiple className="hidden" onChange={handleFileSelect} />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--ring)] transition-colors" aria-label="Attach file or document">
              <Plus className="h-4 w-4" />
            </button>
            {onModeChange && (
              <div className="flex items-center rounded-full border border-[var(--border)] p-0.5 gap-0.5">
                <button type="button" onClick={toggleAgentnet}
                  className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[0.72rem] font-medium transition-colors",
                    agentnetOn ? "bg-[var(--foreground)] text-[var(--background)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}>
                  <Zap className="h-3 w-3" /> AgentNet
                </button>
                <button type="button" onClick={toggleWeb}
                  className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[0.72rem] font-medium transition-colors",
                    webOn ? "bg-[var(--foreground)] text-[var(--background)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}>
                  <Globe className="h-3 w-3" /> Web
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={toggleRecording} disabled={isStreaming || sttStatus === "connecting"}
              className={cn("flex items-center justify-center h-9 w-9 rounded-full transition-all",
                isRecording || sttStatus === "connecting"
                  ? "bg-red-500 text-white hover:bg-red-600 shadow-[0_0_16px_rgba(239,68,68,0.4)]"
                  : "border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--ring)]")}
              aria-label={isRecording ? "Stop recording" : "Voice input"}>
              {isRecording || sttStatus === "connecting" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button type={isStreaming ? "button" : "submit"} disabled={!isStreaming && !hasContent}
              className={cn("flex items-center justify-center h-9 w-9 rounded-full transition-colors",
                isStreaming ? "bg-red-500 text-white hover:bg-red-600" : hasContent ? "bg-[var(--foreground)] text-[var(--background)] hover:opacity-90" : "bg-[var(--muted)] text-[var(--muted-foreground)]")}
              aria-label={isStreaming ? "Stop" : "Send"}>
              {isStreaming ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {/* Recording indicator inside form */}
        {(isRecording || sttStatus === "connecting") && (
          <div className="px-4 pb-3">
            <RecordingIndicator isRecording={isRecording} onStop={stopRecording} status={sttStatus} />
          </div>
        )}
      </form>

      {/* Category chips */}
      <div className="flex flex-wrap gap-2 mt-5 justify-center">
        {PROMPT_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              disabled={isStreaming}
              onClick={() => setActiveCategory(isActive ? null : cat.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-medium transition-colors disabled:opacity-40 shadow-sm",
                isActive
                  ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--ring)]"
              )}
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0" />
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Expanded prompts for active category */}
      {activeCategory && (() => {
        const cat = PROMPT_CATEGORIES.find((c) => c.id === activeCategory);
        if (!cat) return null;
        return (
          <div className="flex flex-wrap gap-2 mt-3 justify-center">
            {cat.prompts.map((prompt, i) => (
              <button
                key={i}
                type="button"
                disabled={isStreaming}
                onClick={() => handlePromptSelect(prompt)}
                className="rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--ring)] transition-colors disabled:opacity-40 shadow-sm"
              >
                {prompt}
              </button>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
