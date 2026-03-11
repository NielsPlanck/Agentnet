"use client";

import { useState, useRef, useEffect } from "react";
import { ArrowUp, Plus, X, Globe, Zap, Code2, TrendingUp, Bot, Search, FlaskConical, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

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
];

// ── Categorised prompt examples ───────────────────────────────────────────────
const PROMPT_CATEGORIES = [
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
    <div className="mt-3 rounded-2xl border border-neutral-200 bg-white shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-100">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-600">
          <Icon className="h-4 w-4" />
          {category.label}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Prompt list */}
      <div className="divide-y divide-neutral-100">
        {category.prompts.map((prompt, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(prompt)}
            className="w-full text-left px-5 py-3.5 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rotate placeholder
  useEffect(() => {
    if (compact) return;
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length), 3500);
    return () => clearInterval(id);
  }, [compact]);

  // Auto-height textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lines = el.value.split("\n").length;
    el.style.height = `${Math.min(MAX_ROWS, Math.max(MIN_ROWS, lines)) * LINE_HEIGHT}px`;
  }, [value]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = value.trim().replace(/\n+/g, "\n");
    if ((query || images.length > 0) && !isStreaming) {
      onSend(query || "What is this image?", images.length > 0 ? images : undefined);
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
    const newImages: ImageAttachment[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const base64 = await fileToBase64(file);
      newImages.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), base64, mimeType: file.type });
    }
    setImages((prev) => [...prev, ...newImages]);
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

  const hasContent = value.trim() || images.length > 0;

  /* ── Compact (in-chat) variant ── */
  if (compact) {
    return (
      <div className="w-full max-w-2xl px-4">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] focus-within:border-[var(--ring)] p-2 transition-[border-color,box-shadow] focus-within:shadow-sm"
        >
          {images.length > 0 && (
            <div className="flex gap-2 px-1 pb-2 flex-wrap">
              {images.map((img) => (
                <div key={img.id} className="relative group">
                  <img src={img.preview} alt="Attached" className="h-14 w-14 object-cover rounded-lg border border-[var(--border)]" />
                  <button type="button" onClick={() => removeImage(img.id)}
                    className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-neutral-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
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
            <button type="submit" disabled={isStreaming || !hasContent}
              className={cn("flex shrink-0 items-center justify-center rounded-lg h-8 w-8 transition-colors",
                hasContent ? "bg-[var(--foreground)] text-[var(--card)] hover:opacity-90" : "text-[var(--muted-foreground)]/40")}
              aria-label="Send">
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    );
  }

  /* ── Landing (light) variant ── */
  return (
    <div className="w-full max-w-3xl px-4">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col rounded-2xl border border-neutral-200 bg-white transition-[border-color,box-shadow] focus-within:border-neutral-300 focus-within:shadow-sm"
      >
        {/* Image previews */}
        {images.length > 0 && (
          <div className="flex gap-2 px-4 pt-4 flex-wrap">
            {images.map((img) => (
              <div key={img.id} className="relative group">
                <img src={img.preview} alt="Attached" className="h-14 w-14 object-cover rounded-lg border border-neutral-200" />
                <button type="button" onClick={() => removeImage(img.id)}
                  className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-neutral-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea */}
        <textarea ref={textareaRef} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDER_EXAMPLES[placeholderIdx]} autoFocus rows={3} disabled={isStreaming}
          className="w-full resize-none border-0 bg-transparent text-base leading-6 outline-none disabled:opacity-60 px-5 pt-5 pb-3 text-neutral-900 placeholder:text-neutral-400 max-h-[240px] overflow-y-auto transition-all"
          style={{ minHeight: "100px" }} aria-label="Prompt" />

        {/* Bottom row */}
        <div className="flex items-center justify-between px-4 pb-4 pt-1 gap-2">
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center h-9 w-9 rounded-full border border-neutral-200 text-neutral-400 hover:text-neutral-600 hover:border-neutral-300 transition-colors" aria-label="Attach image">
              <Plus className="h-4 w-4" />
            </button>
            {onModeChange && (
              <div className="flex items-center rounded-full border border-neutral-200 p-0.5 gap-0.5">
                <button type="button" onClick={toggleAgentnet}
                  className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[0.72rem] font-medium transition-colors",
                    agentnetOn ? "bg-neutral-900 text-white" : "text-neutral-400 hover:text-neutral-700")}>
                  <Zap className="h-3 w-3" /> AgentNet
                </button>
                <button type="button" onClick={toggleWeb}
                  className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[0.72rem] font-medium transition-colors",
                    webOn ? "bg-neutral-900 text-white" : "text-neutral-400 hover:text-neutral-700")}>
                  <Globe className="h-3 w-3" /> Web
                </button>
              </div>
            )}
          </div>
          <button type="submit" disabled={isStreaming || !hasContent}
            className={cn("flex items-center justify-center h-9 w-9 rounded-full transition-colors",
              hasContent ? "bg-neutral-900 text-white hover:bg-neutral-700" : "bg-neutral-100 text-neutral-300")}
            aria-label="Send">
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
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
                  ? "border-neutral-800 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-500 hover:text-neutral-700 hover:border-neutral-300"
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
                className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-xs text-neutral-600 hover:text-neutral-900 hover:border-neutral-300 transition-colors disabled:opacity-40 shadow-sm"
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
