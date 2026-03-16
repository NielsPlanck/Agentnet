"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { JobAgentView } from "@/components/job-agent-view";
import type { SearchResultItem, WebSource, UrlSource, ChatMessage as ChatMsg } from "@/lib/api";
import { sendFeedback, suggestTool, streamAsk } from "@/lib/api";
import { API_BASE } from "@/lib/config";
import { SourceCard } from "@/components/source-card";
import { ChevronRight, ChevronDown, ThumbsUp, ThumbsDown, Plus, X, Check, Calendar, Clock, Minus, Zap, ExternalLink, Globe, Loader2, Maximize2, Minimize2, Sheet, Columns, Bell, StickyNote, ListChecks, CalendarPlus, Timer, Inbox, AlertTriangle, Star, Mail, Send, MessageSquare, Users, FileText, CalendarCheck, Download, Presentation, Search, Filter } from "lucide-react";

/** Strip [TOOL:#N] metadata tag from the start of assistant content */
function stripToolTag(content: string): string {
  return content.replace(/^\[TOOL:#\d+\]\s*/, "");
}

/** Strip markdown bold and emojis from text */
function cleanText(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, "")
    .trim();
}

type InputType = "options" | "date" | "time" | "number";

interface StepDef {
  question: string;
  inputType: InputType;
  options: string[];
}

/** Parse [STEP_FORM]...[/STEP_FORM] blocks */
function parseStepForm(content: string): {
  contentBefore: string;
  steps: StepDef[];
  contentAfter: string;
} | null {
  const match = content.match(/\[STEP_FORM\]([\s\S]*?)\[\/STEP_FORM\]/);
  if (!match) return null;

  const contentBefore = content.slice(0, match.index).trim();
  const contentAfter = content.slice(match.index! + match[0].length).trim();
  const raw = match[1].trim();

  const blocks = raw.split("---").map((b) => b.trim()).filter(Boolean);
  const steps: StepDef[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const qLine = lines.find((l) => l.startsWith("Q:"));
    if (!qLine) continue;
    const question = cleanText(qLine.slice(2).trim());

    // Check for type: directive
    const typeLine = lines.find((l) => l.startsWith("type:"));
    const typeValue = typeLine ? typeLine.slice(5).trim().toLowerCase() : "";

    if (typeValue === "date" || typeValue === "time" || typeValue === "number") {
      const options = lines
        .filter((l) => l.startsWith("- "))
        .map((l) => cleanText(l.slice(2).trim()));
      steps.push({ question, inputType: typeValue, options });
    } else {
      const options = lines
        .filter((l) => l.startsWith("- "))
        .map((l) => cleanText(l.slice(2).trim()));
      if (options.length > 0) {
        steps.push({ question, inputType: "options", options });
      }
    }
  }

  return steps.length > 0 ? { contentBefore, steps, contentAfter } : null;
}

/** Date input with quick-pick options */
function DateInput({ onSelect, suggestions }: { onSelect: (v: string) => void; suggestions: string[] }) {
  const [value, setValue] = useState("");
  const today = new Date();
  const formatDate = (d: Date) => d.toISOString().split("T")[0];
  const displayDate = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const quickDates = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: new Date(today.getTime() + 86400000) },
    { label: "This weekend", date: (() => { const d = new Date(today); d.setDate(d.getDate() + (6 - d.getDay())); return d; })() },
    { label: "Next week", date: new Date(today.getTime() + 7 * 86400000) },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {quickDates.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => onSelect(`${q.label} (${displayDate(q.date)})`)}
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-xs text-[var(--foreground)] hover:border-[var(--foreground)]/20 hover:bg-[var(--muted)]/50 transition-colors"
          >
            {q.label}
            <span className="ml-1.5 text-[var(--muted-foreground)]">{displayDate(q.date)}</span>
          </button>
        ))}
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSelect(s)}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-xs text-[var(--foreground)] hover:border-[var(--foreground)]/20 hover:bg-[var(--muted)]/50 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <input
            type="date"
            value={value}
            min={formatDate(today)}
            onChange={(e) => setValue(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)]/30 transition-colors"
          />
        </div>
        <button
          type="button"
          disabled={!value}
          onClick={() => {
            const d = new Date(value + "T00:00:00");
            onSelect(displayDate(d));
          }}
          className="px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--card)] text-sm font-medium hover:opacity-90 disabled:opacity-30 transition-opacity"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

/** Time input with quick-pick slots */
function TimeInput({ onSelect, suggestions }: { onSelect: (v: string) => void; suggestions: string[] }) {
  const [value, setValue] = useState("");

  const quickTimes = suggestions.length > 0 ? suggestions : [
    "Morning (6-9 AM)",
    "Midday (11 AM-1 PM)",
    "Afternoon (2-5 PM)",
    "Evening (6-9 PM)",
    "Night (9 PM-12 AM)",
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {quickTimes.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onSelect(t)}
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-xs text-[var(--foreground)] hover:border-[var(--foreground)]/20 hover:bg-[var(--muted)]/50 transition-colors"
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <input
            type="time"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)]/30 transition-colors"
          />
        </div>
        <button
          type="button"
          disabled={!value}
          onClick={() => {
            const [h, m] = value.split(":");
            const hr = parseInt(h);
            const ampm = hr >= 12 ? "PM" : "AM";
            const hr12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
            onSelect(`${hr12}:${m} ${ampm}`);
          }}
          className="px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--card)] text-sm font-medium hover:opacity-90 disabled:opacity-30 transition-opacity"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

/** Number input with +/- controls */
function NumberInput({ onSelect, suggestions }: { onSelect: (v: string) => void; suggestions: string[] }) {
  const [value, setValue] = useState(1);

  return (
    <div className="space-y-2">
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSelect(s)}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-xs text-[var(--foreground)] hover:border-[var(--foreground)]/20 hover:bg-[var(--muted)]/50 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <button
            type="button"
            onClick={() => setValue(Math.max(1, value - 1))}
            className="px-3 py-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="px-5 py-2 text-sm font-semibold text-[var(--foreground)] tabular-nums min-w-[3rem] text-center">
            {value}
          </span>
          <button
            type="button"
            onClick={() => setValue(value + 1)}
            className="px-3 py-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onSelect(String(value))}
          className="px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--card)] text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

/** Interactive multi-step form component */
function StepForm({
  steps,
  onComplete,
}: {
  steps: StepDef[];
  onComplete: (answers: string[]) => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");

  const handleSelect = (option: string) => {
    const newAnswers = [...answers, option];
    setCustomInput("");
    if (currentStep < steps.length - 1) {
      setAnswers(newAnswers);
      setCurrentStep(currentStep + 1);
    } else {
      onComplete(newAnswers);
    }
  };

  const handleBack = () => {
    if (currentStep === 0) return;
    setCustomInput("");
    setAnswers(answers.slice(0, -1));
    setCurrentStep(currentStep - 1);
  };

  const step = steps[currentStep];

  return (
    <div className="mt-3">
      {/* Progress */}
      <div className="flex items-center gap-1.5 mb-3">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`h-1 rounded-full flex-1 transition-colors ${
              i < currentStep
                ? "bg-[var(--foreground)]"
                : i === currentStep
                ? "bg-[var(--foreground)]/60"
                : "bg-[var(--border)]"
            }`}
          />
        ))}
      </div>

      {/* Step label + back */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[0.7rem] text-[var(--muted-foreground)]">
          Step {currentStep + 1} of {steps.length}
        </div>
        {currentStep > 0 && (
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1 text-[0.7rem] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ChevronDown className="h-3 w-3 rotate-90" />
            Back
          </button>
        )}
      </div>

      {/* Question */}
      <div className="text-sm font-medium text-[var(--foreground)] mb-3">
        {step.question}
      </div>

      {/* Previous answers */}
      {answers.length > 0 && (
        <div className="mb-3 space-y-1">
          {answers.map((a, i) => (
            <div key={i} className="text-xs text-[var(--muted-foreground)]">
              {steps[i].question}: <span className="text-[var(--foreground)]">{a}</span>
            </div>
          ))}
        </div>
      )}

      {/* Input based on type */}
      {step.inputType === "date" ? (
        <DateInput onSelect={handleSelect} suggestions={step.options} />
      ) : step.inputType === "time" ? (
        <TimeInput onSelect={handleSelect} suggestions={step.options} />
      ) : step.inputType === "number" ? (
        <NumberInput onSelect={handleSelect} suggestions={step.options} />
      ) : (
        <div className="space-y-1.5">
          {step.options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => handleSelect(opt)}
              className="w-full flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:border-[var(--foreground)]/20 hover:bg-[var(--muted)]/50 transition-colors"
            >
              <span>{opt}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
            </button>
          ))}
          {/* Custom answer input */}
          <div className="flex gap-2 pt-1">
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && customInput.trim()) handleSelect(customInput.trim()); }}
              placeholder="Other — type your own answer..."
              className="flex-1 text-sm bg-[var(--muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50 outline-none focus:border-[var(--foreground)]/30 transition-colors"
            />
            <button
              type="button"
              disabled={!customInput.trim()}
              onClick={() => handleSelect(customInput.trim())}
              className="px-3 py-2 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-sm font-medium disabled:opacity-30 transition-opacity hover:opacity-90"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Parse [RESULTS]{...}[/RESULTS] visual card blocks */
interface ResultItem {
  title: string;
  detail?: string;
  price?: string;
  tag?: string;
  id?: string;
  url?: string;
  image?: string;
}
interface ResultsBlock {
  intro?: string;
  items: ResultItem[];
  question?: string;
}
function parseResultsBlock(content: string): {
  contentBefore: string;
  block: ResultsBlock;
  contentAfter: string;
} | null {
  const match = content.match(/\[RESULTS\]([\s\S]*?)\[\/RESULTS\]/);
  if (!match) return null;
  try {
    const block: ResultsBlock = JSON.parse(match[1].trim());
    if (!block.items?.length) return null;
    return {
      contentBefore: content.slice(0, match.index).trim(),
      block,
      contentAfter: content.slice(match.index! + match[0].length).trim(),
    };
  } catch {
    return null;
  }
}

const CARD_GRADIENTS = [
  "from-blue-500/20 to-indigo-500/20",
  "from-purple-500/20 to-pink-500/20",
  "from-emerald-500/20 to-teal-500/20",
  "from-orange-500/20 to-amber-500/20",
  "from-rose-500/20 to-red-500/20",
  "from-cyan-500/20 to-sky-500/20",
];

function ResultCards({ block, onSelect, onLoadMore }: { block: ResultsBlock; onSelect: (item: ResultItem) => void; onLoadMore?: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [imgErrors, setImgErrors] = useState<Set<number>>(new Set());

  const handleSelect = (item: ResultItem) => {
    setSelected(item.id || item.title);
    onSelect(item);
  };

  return (
    <div className="mt-3">
      {block.intro && (
        <p className="text-sm text-[var(--muted-foreground)] mb-3">{block.intro}</p>
      )}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2">
        {block.items.map((item, i) => {
          const isSelected = selected === (item.id || item.title);
          const imgFailed = imgErrors.has(i);
          return (
            <button
              key={item.id || i}
              type="button"
              onClick={() => handleSelect(item)}
              className={`relative text-left rounded-2xl border p-3.5 transition-all active:scale-[0.98] ${
                isSelected
                  ? "border-[var(--foreground)]/40 bg-[var(--muted)] ring-1 ring-[var(--foreground)]/10"
                  : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--foreground)]/20 hover:bg-[var(--muted)]/40"
              }`}
            >
              {/* Image or gradient placeholder */}
              <div className={`h-20 rounded-xl mb-3 overflow-hidden flex items-center justify-center bg-gradient-to-br ${CARD_GRADIENTS[i % CARD_GRADIENTS.length]}`}>
                {item.image && !imgFailed ? (
                  <img
                    src={item.image}
                    alt={item.title}
                    className="w-full h-full object-cover"
                    onError={() => setImgErrors((prev) => new Set([...prev, i]))}
                  />
                ) : item.price ? (
                  <span className="text-base font-bold text-[var(--foreground)]">{item.price}</span>
                ) : (
                  <span className="text-xs font-medium text-[var(--foreground)]/40 px-2 text-center leading-snug">{item.title}</span>
                )}
              </div>

              {/* Tag badge */}
              {item.tag && (
                <span className="absolute top-2.5 right-2.5 text-[0.6rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[var(--foreground)] text-[var(--background)]">
                  {item.tag}
                </span>
              )}

              {/* Selected checkmark */}
              {isSelected && (
                <span className="absolute top-2.5 left-2.5 h-4 w-4 rounded-full bg-[var(--foreground)] flex items-center justify-center">
                  <Check className="h-2.5 w-2.5 text-[var(--background)]" />
                </span>
              )}

              <div className="flex items-start justify-between gap-1 mb-0.5">
                <div className="text-sm font-semibold text-[var(--foreground)] leading-tight line-clamp-2">
                  {item.title}
                </div>
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex-shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mt-0.5"
                    title="Open link"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {item.price && (
                <div className="text-sm font-bold text-[var(--foreground)] mb-0.5">{item.price}</div>
              )}
              {item.detail && (
                <div className="text-[0.7rem] text-[var(--muted-foreground)] leading-snug line-clamp-2">
                  {item.detail}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Question + load more */}
      <div className="flex items-center justify-between gap-3 mt-3">
        {block.question && (
          <p className="text-sm text-[var(--muted-foreground)]">{block.question}</p>
        )}
        {onLoadMore && (
          <button
            type="button"
            onClick={onLoadMore}
            className="shrink-0 text-[0.72rem] font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] transition-colors text-[var(--foreground)]"
          >
            Show more
          </button>
        )}
      </div>
    </div>
  );
}

/** Parse [TABLE]{...}[/TABLE] data table blocks */
interface TableBlock {
  intro?: string;
  columns: string[];
  rows: (string | number | null)[][];
  caption?: string;
}
function parseTableBlock(content: string): {
  contentBefore: string;
  block: TableBlock;
  contentAfter: string;
} | null {
  const match = content.match(/\[TABLE\]([\s\S]*?)\[\/TABLE\]/);
  if (!match) return null;
  try {
    const block: TableBlock = JSON.parse(match[1].trim());
    if (!block.columns?.length || !block.rows?.length) return null;
    return {
      contentBefore: content.slice(0, match.index).trim(),
      block,
      contentAfter: content.slice(match.index! + match[0].length).trim(),
    };
  } catch {
    return null;
  }
}

/** Render a table cell: detect URLs and make them clickable links */
function renderCell(value: string | number | null): React.ReactNode {
  if (value === null || value === undefined) return "—";
  const str = String(value);
  const isUrl = /^https?:\/\//.test(str) || /^linkedin\.com\//.test(str) || /^www\./.test(str);
  if (isUrl) {
    const href = /^https?:\/\//.test(str) ? str : `https://${str}`;
    const display = str.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-blue-500 hover:text-blue-600 hover:underline"
      >
        {display}
      </a>
    );
  }
  return str;
}

/** Color palette for sector/category badges */
const BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  "ai": { bg: "bg-purple-500/20", text: "text-purple-400" },
  "healthcare": { bg: "bg-emerald-500/20", text: "text-emerald-400" },
  "fintech": { bg: "bg-blue-500/20", text: "text-blue-400" },
  "saas": { bg: "bg-indigo-500/20", text: "text-indigo-400" },
  "cybersecurity": { bg: "bg-red-500/20", text: "text-red-400" },
  "biotech": { bg: "bg-green-500/20", text: "text-green-400" },
  "edtech": { bg: "bg-yellow-500/20", text: "text-yellow-400" },
  "energy": { bg: "bg-orange-500/20", text: "text-orange-400" },
  "robotics": { bg: "bg-cyan-500/20", text: "text-cyan-400" },
  "space": { bg: "bg-violet-500/20", text: "text-violet-400" },
  "climate": { bg: "bg-teal-500/20", text: "text-teal-400" },
  "deeptech": { bg: "bg-fuchsia-500/20", text: "text-fuchsia-400" },
  "logistics": { bg: "bg-amber-500/20", text: "text-amber-400" },
  "e-commerce": { bg: "bg-pink-500/20", text: "text-pink-400" },
  "food": { bg: "bg-lime-500/20", text: "text-lime-400" },
  "proptech": { bg: "bg-sky-500/20", text: "text-sky-400" },
  "legaltech": { bg: "bg-slate-500/20", text: "text-slate-400" },
  "insurtech": { bg: "bg-rose-500/20", text: "text-rose-400" },
  "gaming": { bg: "bg-violet-500/20", text: "text-violet-400" },
  "defense": { bg: "bg-zinc-500/20", text: "text-zinc-400" },
  "construction": { bg: "bg-stone-500/20", text: "text-stone-400" },
  "enterprise": { bg: "bg-blue-500/20", text: "text-blue-400" },
  "data": { bg: "bg-indigo-500/20", text: "text-indigo-400" },
  "developer tools": { bg: "bg-gray-500/20", text: "text-gray-400" },
  "infrastructure": { bg: "bg-slate-500/20", text: "text-slate-400" },
};

/** Check if a column likely contains categorical/tag data */
function isBadgeColumn(colName: string): boolean {
  const lower = colName.toLowerCase();
  return ["sector", "industry", "category", "stage", "funding stage", "type", "status", "tag", "vertical"].includes(lower);
}

/** Get badge color for a value */
function getBadgeColor(value: string): { bg: string; text: string } {
  const lower = value.toLowerCase();
  for (const [key, color] of Object.entries(BADGE_COLORS)) {
    if (lower.includes(key)) return color;
  }
  // Fallback: hash-based color
  const hash = lower.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const fallbacks = [
    { bg: "bg-purple-500/20", text: "text-purple-400" },
    { bg: "bg-blue-500/20", text: "text-blue-400" },
    { bg: "bg-emerald-500/20", text: "text-emerald-400" },
    { bg: "bg-amber-500/20", text: "text-amber-400" },
    { bg: "bg-rose-500/20", text: "text-rose-400" },
    { bg: "bg-cyan-500/20", text: "text-cyan-400" },
    { bg: "bg-indigo-500/20", text: "text-indigo-400" },
    { bg: "bg-teal-500/20", text: "text-teal-400" },
  ];
  return fallbacks[hash % fallbacks.length];
}

/** Check if a column contains monetary values */
function isMoneyColumn(colName: string): boolean {
  const lower = colName.toLowerCase();
  return ["raised", "funding", "amount", "revenue", "valuation", "total raised", "last funding", "investment"].some(k => lower.includes(k));
}

/** Compute summary stats for the table */
function computeStats(columns: string[], rows: (string | number | null)[][]): { totalRaised: string | null; topSectors: string[] } {
  let totalRaised: number | null = null;
  const sectorCounts: Record<string, number> = {};

  columns.forEach((col, ci) => {
    const lower = col.toLowerCase();
    // Sum monetary columns
    if (isMoneyColumn(col)) {
      rows.forEach(row => {
        const val = String(row[ci] ?? "");
        const match = val.match(/[\$€£]?([\d,.]+)\s*(M|B|K|million|billion)?/i);
        if (match) {
          let num = parseFloat(match[1].replace(/,/g, ""));
          const unit = (match[2] || "").toUpperCase();
          if (unit === "B" || unit === "BILLION") num *= 1000;
          else if (unit === "K") num /= 1000;
          // Assume M/million if no unit and number is small
          totalRaised = (totalRaised || 0) + num;
        }
      });
    }
    // Count sectors
    if (isBadgeColumn(col)) {
      rows.forEach(row => {
        const val = String(row[ci] ?? "").trim();
        if (val && val !== "—") {
          // Split by comma for multi-sector
          val.split(/[,;]/).forEach(s => {
            const trimmed = s.trim();
            if (trimmed) sectorCounts[trimmed] = (sectorCounts[trimmed] || 0) + 1;
          });
        }
      });
    }
  });

  const topSectors = Object.entries(sectorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  let totalStr: string | null = null;
  if (totalRaised !== null && totalRaised > 0) {
    const tr = totalRaised as number;
    if (tr >= 1000) totalStr = `$${(tr / 1000).toFixed(1)}B+`;
    else totalStr = `$${Math.round(tr)}M+`;
  }

  return { totalRaised: totalStr, topSectors };
}

function DataTable({ block, onAction, fetchMoreContext }: {
  block: TableBlock;
  onAction: (msg: string) => void;
  fetchMoreContext?: { history: ChatMsg[]; mode: string };
}) {
  const [allRows, setAllRows] = useState<(string | number | null)[][]>(block.rows);
  const [allColumns, setAllColumns] = useState<string[]>(block.columns);
  const [selected, setSelected] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showAddCol, setShowAddCol] = useState(false);
  const [addColValue, setAddColValue] = useState("");
  const [loadingLabel, setLoadingLabel] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Record<number, string>>({});
  const [showFilterFor, setShowFilterFor] = useState<number | null>(null);

  // ESC to close fullscreen
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const handleRowClick = (row: (string | number | null)[], ri: number) => {
    setSelected(ri);
    const label = allColumns.map((col, i) => `${col}: ${row[i] ?? "—"}`).join(" · ");
    onAction(`Tell me more about this: ${label}`);
  };

  const handleLoadMore = async () => {
    if (!fetchMoreContext || loadingMore) return;
    setLoadingMore(true);
    setLoadingLabel("Loading more rows…");
    try {
      const prompt = `Add 10 more rows to this list, continuing from where you left off. The list currently has ${allRows.length} items with columns: ${allColumns.join(", ")}. Return ONLY a [TABLE] block with the next 10 rows (no intro text needed).`;
      let fullText = "";
      for await (const m of streamAsk(prompt, fetchMoreContext.history, undefined, "agentnet")) {
        if (m.type === "token") fullText += m.content;
      }
      const match = fullText.match(/\[TABLE\]([\s\S]*?)\[\/TABLE\]/);
      if (match) {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.rows?.length) setAllRows(prev => [...prev, ...parsed.rows]);
      }
    } catch { /* ignore */ } finally {
      setLoadingMore(false);
      setLoadingLabel("");
    }
  };

  // Real enrichment via backend (Tavily search + Gemini extraction / Clay API)
  const realEnrich = async (addCols: string[]) => {
    setLoadingMore(true);
    setLoadingLabel(`Searching for ${addCols.join(", ")}…`);
    try {
      const res = await fetch(`${API_BASE}/v1/enrich-table`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columns: allColumns,
          rows: allRows,
          add_columns: addCols,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.columns?.length && data.rows?.length) {
          setAllColumns(data.columns);
          setAllRows(data.rows);
        }
      }
    } catch { /* ignore */ } finally {
      setLoadingMore(false);
      setLoadingLabel("");
    }
  };

  const handleEnrich = async () => {
    if (loadingMore) return;
    await realEnrich(["Founder / CEO", "LinkedIn", "Email"]);
  };

  const handleAddColumn = async () => {
    if (loadingMore || !addColValue.trim()) return;
    const colName = addColValue.trim();
    setShowAddCol(false);
    setAddColValue("");
    await realEnrich([colName]);
  };

  const exportCsv = () => {
    const header = allColumns.join(",");
    const rows = allRows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([header + "\n" + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "list.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const [sheetsLoading, setSheetsLoading] = useState(false);

  const openInGoogleSheets = async () => {
    if (sheetsLoading) return;
    setSheetsLoading(true);
    try {
      // Build CSV content
      const header = allColumns.join(",");
      const csvRows = allRows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const csvContent = header + "\n" + csvRows;

      // Upload CSV to temp storage on backend
      const res = await fetch(`${API_BASE}/v1/temp-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvContent }),
      });

      if (res.ok) {
        const { url } = await res.json();
        // Open Google Sheets with IMPORTDATA formula pre-loaded via a helper page
        // Google Docs Viewer can display CSV and offers "Open with Google Sheets"
        const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(url)}`;
        window.open(viewerUrl, "_blank");
      } else {
        throw new Error("Failed to store CSV");
      }
    } catch {
      // Fallback: copy CSV to clipboard + open blank Google Sheet
      const header = allColumns.join("\t");
      const tsvRows = allRows.map(r => r.map(c => String(c ?? "")).join("\t")).join("\n");
      const tsvContent = header + "\n" + tsvRows;
      await navigator.clipboard.writeText(tsvContent).catch(() => {});
      window.open("https://sheets.google.com/create", "_blank");
    } finally {
      setSheetsLoading(false);
    }
  };

  // Compute filtered rows
  const filteredRows = (() => {
    let rows = allRows;
    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter(row => row.some(cell => String(cell ?? "").toLowerCase().includes(q)));
    }
    // Apply column filters
    Object.entries(activeFilters).forEach(([colIdx, filterVal]) => {
      if (filterVal) {
        const ci = parseInt(colIdx);
        rows = rows.filter(row => {
          const cellVal = String(row[ci] ?? "").toLowerCase();
          return cellVal.includes(filterVal.toLowerCase());
        });
      }
    });
    return rows;
  })();

  // Detect which columns should show badges
  const badgeColumnIndices = allColumns.map((col, i) => isBadgeColumn(col) ? i : -1).filter(i => i >= 0);
  const moneyColumnIndices = allColumns.map((col, i) => isMoneyColumn(col) ? i : -1).filter(i => i >= 0);

  // Compute stats
  const stats = computeStats(allColumns, allRows);

  // Get unique values for filter dropdowns
  const getUniqueValues = (colIdx: number): string[] => {
    const vals = new Set<string>();
    allRows.forEach(row => {
      const v = String(row[colIdx] ?? "").trim();
      if (v && v !== "—") {
        // Split multi-value cells
        v.split(/[,;]/).forEach(s => { const t = s.trim(); if (t) vals.add(t); });
      }
    });
    return Array.from(vals).sort();
  };

  // Render a cell with badge support
  const renderCellEnhanced = (cell: string | number | null, colIdx: number): React.ReactNode => {
    if (cell === null || cell === undefined) return "—";
    const str = String(cell);

    // Badge columns: render as colored pills
    if (badgeColumnIndices.includes(colIdx) && str && str !== "—") {
      const parts = str.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      return (
        <div className="flex flex-wrap gap-1">
          {parts.map((part, i) => {
            const color = getBadgeColor(part);
            return (
              <span key={i} className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[0.6rem] font-medium ${color.bg} ${color.text}`}>
                {part}
              </span>
            );
          })}
        </div>
      );
    }

    // Money columns: bold green
    if (moneyColumnIndices.includes(colIdx) && str && str !== "—") {
      return <span className="font-semibold text-emerald-400">{str}</span>;
    }

    // URLs
    const isUrl = /^https?:\/\//.test(str) || /^linkedin\.com\//.test(str) || /^www\./.test(str) || /^crunchbase\.com\//.test(str);
    if (isUrl) {
      const href = /^https?:\/\//.test(str) ? str : `https://${str}`;
      const display = str.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
      const short = display.length > 30 ? display.slice(0, 27) + "…" : display;
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-400 hover:text-blue-300 hover:underline">
          {short}
        </a>
      );
    }

    return str;
  };

  // Shared table render used in both inline and fullscreen
  const renderTable = (isFullscreen: boolean) => (
    <div className={`rounded-xl border border-[var(--border)] overflow-hidden ${isFullscreen ? "flex-1" : ""}`}>
      <div className={`overflow-x-auto ${isFullscreen ? "max-h-full overflow-y-auto" : ""}`}>
        <table className={`w-full ${isFullscreen ? "text-sm" : "text-xs"}`}>
          <thead className="sticky top-0 z-10">
            <tr className={`border-b border-[var(--border)] ${isFullscreen ? "bg-[var(--background)]" : "bg-[var(--muted)]/50"}`}>
              <th className={`${isFullscreen ? "px-4 py-3" : "px-3 py-2"} text-left font-medium text-[var(--muted-foreground)] w-8`}>#</th>
              {allColumns.map((col, i) => (
                <th key={i} className={`${isFullscreen ? "px-4 py-3 text-[0.7rem]" : "px-3 py-2 text-[0.6rem]"} text-left font-medium text-[var(--muted-foreground)] uppercase tracking-wide whitespace-nowrap`}>
                  <div className="flex items-center gap-1">
                    {col}
                    {isBadgeColumn(col) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowFilterFor(showFilterFor === i ? null : i); }}
                        className={`p-0.5 rounded hover:bg-[var(--muted)] ${activeFilters[i] ? "text-blue-400" : "text-[var(--muted-foreground)]"}`}
                      >
                        <Filter className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                  {showFilterFor === i && (
                    <div className="absolute mt-1 z-20 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl p-1.5 min-w-[120px] max-h-[200px] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setActiveFilters(f => { const n = {...f}; delete n[i]; return n; }); setShowFilterFor(null); }} className="block w-full text-left px-2 py-1 text-[0.65rem] rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)]">
                        All
                      </button>
                      {getUniqueValues(i).map(val => (
                        <button key={val} onClick={() => { setActiveFilters(f => ({...f, [i]: val})); setShowFilterFor(null); }} className={`block w-full text-left px-2 py-1 text-[0.65rem] rounded hover:bg-[var(--muted)] ${activeFilters[i] === val ? "text-blue-400 font-medium" : "text-[var(--foreground)]"}`}>
                          {val}
                        </button>
                      ))}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, ri) => (
              <tr
                key={ri}
                onClick={() => handleRowClick(row, ri)}
                className={`border-b border-[var(--border)] last:border-0 cursor-pointer transition-colors ${
                  selected === ri ? "bg-[var(--muted)]" : "hover:bg-[var(--muted)]/40"
                }`}
              >
                <td className={`${isFullscreen ? "px-4 py-3" : "px-3 py-2.5"} text-[var(--muted-foreground)] tabular-nums select-text`}>{ri + 1}</td>
                {row.map((cell, ci) => (
                  <td key={ci} className={`${isFullscreen ? "px-4 py-3" : "px-3 py-2.5"} whitespace-nowrap select-text ${ci === 0 ? "font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
                    {renderCellEnhanced(cell, ci)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  // Shared action bar
  const renderActions = (isFullscreen: boolean) => (
    <div className={`flex items-center gap-2 ${isFullscreen ? "mt-4" : "mt-2.5"} flex-wrap`}>
      {/* Add Column */}
      {showAddCol ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={addColValue}
            onChange={(e) => setAddColValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddColumn(); if (e.key === "Escape") { setShowAddCol(false); setAddColValue(""); } }}
            placeholder="Column name (e.g. Email, Revenue)"
            autoFocus
            className="text-[0.72rem] px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--foreground)]/30 w-48"
          />
          <button
            onClick={handleAddColumn}
            disabled={!addColValue.trim() || loadingMore}
            className="flex items-center gap-1 text-[0.72rem] font-medium px-2.5 py-1.5 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
          <button
            onClick={() => { setShowAddCol(false); setAddColValue(""); }}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] p-1"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddCol(true)}
          disabled={loadingMore}
          className="flex items-center gap-1.5 text-[0.72rem] font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] transition-colors text-[var(--foreground)] disabled:opacity-50"
        >
          <Columns className="h-3 w-3" />
          Add column
        </button>
      )}

      <button
        onClick={handleLoadMore}
        disabled={loadingMore}
        className="flex items-center gap-1.5 text-[0.72rem] font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] transition-colors text-[var(--foreground)] disabled:opacity-50"
      >
        + Load more
      </button>
      <button
        onClick={handleEnrich}
        disabled={loadingMore}
        className="flex items-center gap-1.5 text-[0.72rem] font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] transition-colors text-[var(--foreground)] disabled:opacity-50"
      >
        Enrich data
      </button>
      <button
        onClick={exportCsv}
        className="flex items-center gap-1.5 text-[0.72rem] font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] transition-colors text-[var(--foreground)]"
      >
        Export CSV
      </button>
      <button
        onClick={openInGoogleSheets}
        disabled={sheetsLoading}
        className="flex items-center gap-1.5 text-[0.72rem] font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] transition-colors text-[var(--foreground)] disabled:opacity-50"
      >
        {sheetsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sheet className="h-3 w-3" />}
        Google Sheets
      </button>
      {!isFullscreen && (
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 text-[0.72rem] font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] transition-colors text-[var(--foreground)] ml-auto"
        >
          <Maximize2 className="h-3 w-3" />
          Expand
        </button>
      )}
      {selected !== null && (
        <button
          onClick={() => {
            const row = allRows[selected];
            onAction(`Find the founder or key contact at ${row[0]}, including their LinkedIn and email if available.`);
          }}
          className="flex items-center gap-1.5 text-[0.72rem] font-medium px-3 py-1.5 rounded-lg border border-[var(--foreground)]/20 bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-opacity"
        >
          Find contact at {allRows[selected]?.[0]}
        </button>
      )}
    </div>
  );

  // Loading indicator
  const renderLoading = () => loadingMore ? (
    <div className="flex items-center gap-2 mt-2 text-[var(--muted-foreground)]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span className="text-xs">{loadingLabel || "Loading…"}</span>
    </div>
  ) : null;

  // Fullscreen overlay via portal
  const fullscreenOverlay = expanded ? createPortal(
    <div className="fixed inset-0 z-[100] bg-[var(--background)] flex flex-col">
      {/* Fullscreen header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          {block.intro && (
            <h2 className="text-sm font-medium text-[var(--foreground)]">{block.intro}</h2>
          )}
          <span className="text-xs text-[var(--muted-foreground)]">
            {allRows.length} rows · {allColumns.length} columns
          </span>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] transition-colors text-[var(--foreground)]"
        >
          <Minimize2 className="h-3.5 w-3.5" />
          Close
        </button>
      </div>

      {/* Fullscreen table */}
      <div className="flex-1 overflow-hidden px-6 py-4 flex flex-col">
        {renderTable(true)}
        {renderLoading()}
        {renderActions(true)}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="mt-3">
      {/* Search bar */}
      <div className="mb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search company, country, sector…"
            className="w-full text-xs pl-8 pr-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--foreground)]/30"
          />
        </div>
      </div>

      {/* Active filter pills */}
      {Object.keys(activeFilters).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {Object.entries(activeFilters).map(([colIdx, val]) => (
            <span key={colIdx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] bg-blue-500/20 text-blue-400">
              {allColumns[parseInt(colIdx)]}: {val}
              <button onClick={() => setActiveFilters(f => { const n = {...f}; delete n[parseInt(colIdx)]; return n; })} className="hover:text-blue-300">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <button onClick={() => setActiveFilters({})} className="text-[0.65rem] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Clear all</button>
        </div>
      )}

      {/* Stats header */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--foreground)] font-medium">
            Showing {filteredRows.length} {filteredRows.length !== allRows.length ? `of ${allRows.length}` : ""} startups
          </span>
          {stats.totalRaised && (
            <span className="text-xs text-[var(--muted-foreground)]">
              Total raised <span className="font-semibold text-emerald-400">{stats.totalRaised}</span>
            </span>
          )}
        </div>
        <span className="text-[0.65rem] text-[var(--muted-foreground)]">
          {allRows.length} results
        </span>
      </div>

      {/* Table */}
      {renderTable(false)}

      {/* Loading indicator */}
      {renderLoading()}

      {/* Action bar */}
      {renderActions(false)}

      {block.caption && (
        <p className="text-[0.65rem] text-[var(--muted-foreground)] mt-1.5">{block.caption}</p>
      )}

      {/* Fullscreen overlay portal */}
      {fullscreenOverlay}
    </div>
  );
}

/** ── Email types ── */
interface EmailDraft {
  to: string;
  subject: string;
  body: string;
}

interface EmailComposerData {
  to: string;
  options: { label: string; subject: string; body: string }[];
}

/** Parse [EMAIL_COMPOSER]{...}[/EMAIL_COMPOSER] or legacy [EMAIL_DRAFT]{...}[/EMAIL_DRAFT] blocks */
/** Try to repair broken JSON from LLM output (newlines in strings, etc.) */
function repairJson(raw: string): string {
  // Strategy 1: try as-is
  try { JSON.parse(raw); return raw; } catch {}

  // Strategy 2: the LLM often puts real newlines inside "body": "..." strings
  // We need to find string values and escape their internal newlines
  let repaired = raw;

  // Replace real newlines inside JSON string values with \n
  // Match content between quotes that spans multiple lines
  repaired = repaired.replace(/"body"\s*:\s*"([\s\S]*?)(?="[\s]*[,}])/g, (_match, bodyContent) => {
    const escaped = bodyContent
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
    return `"body": "${escaped}`;
  });

  // Also fix subject/label fields that might have issues
  repaired = repaired.replace(/"subject"\s*:\s*"([\s\S]*?)(?="[\s]*[,}])/g, (_match, val) => {
    const escaped = val.replace(/\n/g, "\\n").replace(/\r/g, "");
    return `"subject": "${escaped}`;
  });

  try { JSON.parse(repaired); return repaired; } catch {}

  // Strategy 3: aggressively try to extract and rebuild
  // Find all "body": "..." segments and fix them
  try {
    // Replace ALL newlines inside string values
    let inString = false;
    let escaped = false;
    let result = "";
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (escaped) {
        result += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        result += ch;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        result += ch;
        continue;
      }
      if (inString && ch === "\n") {
        result += "\\n";
        continue;
      }
      if (inString && ch === "\r") {
        continue;
      }
      result += ch;
    }
    JSON.parse(result);
    return result;
  } catch {}

  return raw; // give up, return original
}

// ── Email Inbox Summary parser ──────────────────────────────────
interface InboxEmail {
  id: string;
  from: string;
  subject: string;
  snippet?: string;
  reason?: string;
  suggested_action?: string;
}

interface InboxSummaryData {
  total: number;
  urgent: InboxEmail[];
  important: InboxEmail[];
  normal: InboxEmail[];
  low: InboxEmail[];
  drafts?: { for_email_id: string; to: string; subject: string; body: string }[];
}

function parseInboxSummary(content: string): {
  contentBefore: string;
  data: InboxSummaryData;
  contentAfter: string;
} | null {
  const match = content.match(/\[EMAIL_INBOX_SUMMARY\]([\s\S]*?)(?:\[\/EMAIL_INBOX_SUMMARY\]|$)/);
  if (!match) return null;
  try {
    const repaired = repairJson(match[1].trim());
    const data: InboxSummaryData = JSON.parse(repaired);
    if (!data.urgent && !data.important && !data.normal) return null;
    return {
      contentBefore: content.slice(0, match.index).trim(),
      data,
      contentAfter: content.slice(match.index! + match[0].length).trim(),
    };
  } catch { return null; }
}

// ── Meeting Debrief parser ──────────────────────────────────────
interface MeetingDebriefData {
  event_title: string;
  attendees?: string[];
  action_items: { task: string; assignee?: string; due?: string }[];
  follow_ups?: { to: string; subject: string; body: string }[];
  notes?: string;
}

function parseMeetingDebrief(content: string): {
  contentBefore: string;
  data: MeetingDebriefData;
  contentAfter: string;
} | null {
  const match = content.match(/\[MEETING_DEBRIEF\]([\s\S]*?)(?:\[\/MEETING_DEBRIEF\]|$)/);
  if (!match) return null;
  try {
    const repaired = repairJson(match[1].trim());
    const data: MeetingDebriefData = JSON.parse(repaired);
    if (!data.event_title) return null;
    return {
      contentBefore: content.slice(0, match.index).trim(),
      data,
      contentAfter: content.slice(match.index! + match[0].length).trim(),
    };
  } catch { return null; }
}

// ── WhatsApp Summary parser ──────────────────────────────────────
interface WhatsAppSummaryData {
  chat_name: string;
  message_count?: number;
  participants?: string[];
  summary: string;
  key_messages?: { from: string; text: string; time: string }[];
  suggested_reply?: string;
}

function parseWhatsAppSummary(content: string): {
  contentBefore: string;
  data: WhatsAppSummaryData;
  contentAfter: string;
} | null {
  const match = content.match(/\[WHATSAPP_SUMMARY\]([\s\S]*?)(?:\[\/WHATSAPP_SUMMARY\]|$)/);
  if (!match) return null;
  try {
    const repaired = repairJson(match[1].trim());
    const data: WhatsAppSummaryData = JSON.parse(repaired);
    if (!data.chat_name) return null;
    return {
      contentBefore: content.slice(0, match.index).trim(),
      data,
      contentAfter: content.slice(match.index! + match[0].length).trim(),
    };
  } catch { return null; }
}

// ── Inbox Summary Card ──────────────────────────────────────────
function InboxSummaryCard({ data, onAction }: { data: InboxSummaryData; onAction?: (msg: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const priorityConfig: Record<string, { color: string; bg: string; border: string; icon: React.ReactNode; label: string }> = {
    urgent: { color: "text-red-600", bg: "bg-red-50", border: "border-red-200", icon: <AlertTriangle className="h-3.5 w-3.5 text-red-500" />, label: "Urgent" },
    important: { color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200", icon: <Star className="h-3.5 w-3.5 text-orange-500" />, label: "Important" },
    normal: { color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", icon: <Mail className="h-3.5 w-3.5 text-blue-500" />, label: "Normal" },
    low: { color: "text-gray-500", bg: "bg-gray-50", border: "border-gray-200", icon: <Minus className="h-3.5 w-3.5 text-gray-400" />, label: "Low Priority" },
  };

  const renderEmailGroup = (emails: InboxEmail[], priority: string) => {
    if (!emails || emails.length === 0) return null;
    const config = priorityConfig[priority];
    return (
      <div key={priority} className="mb-3">
        <div className={`flex items-center gap-1.5 mb-1.5 text-xs font-medium ${config.color}`}>
          {config.icon}
          <span>{config.label} ({emails.length})</span>
        </div>
        <div className="space-y-1.5">
          {emails.map((email, i) => {
            const key = `${priority}-${i}`;
            const isOpen = expanded === key;
            return (
              <div key={key} className={`rounded-lg border ${config.border} ${config.bg} overflow-hidden`}>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-left"
                  onClick={() => setExpanded(isOpen ? null : key)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[var(--foreground)] truncate">{email.subject || "(no subject)"}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)] truncate">{email.from}</div>
                  </div>
                  <ChevronDown className={`h-3 w-3 text-[var(--muted-foreground)] transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="px-3 pb-2 space-y-1.5">
                    {email.snippet && <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">{email.snippet}</p>}
                    {email.reason && <p className="text-[10px] text-[var(--muted-foreground)] italic">{email.reason}</p>}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => onAction?.(`Draft a reply to the email from ${email.from} about "${email.subject}"`)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-opacity"
                      >
                        <Send className="h-2.5 w-2.5" />
                        Draft Reply
                      </button>
                      {email.suggested_action && email.suggested_action !== "reply" && (
                        <button
                          onClick={() => onAction?.(`${email.suggested_action} the email from ${email.from}: "${email.subject}"`)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
                        >
                          {email.suggested_action}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--muted)]/30">
        <Inbox className="h-4 w-4 text-[var(--primary)]" />
        <span className="text-sm font-medium text-[var(--foreground)]">Inbox Summary</span>
        <span className="text-xs text-[var(--muted-foreground)]">({data.total} emails)</span>
        {data.urgent?.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
            <AlertTriangle className="h-2.5 w-2.5" />
            {data.urgent.length} urgent
          </span>
        )}
      </div>
      <div className="p-3">
        {renderEmailGroup(data.urgent, "urgent")}
        {renderEmailGroup(data.important, "important")}
        {renderEmailGroup(data.normal, "normal")}
        {renderEmailGroup(data.low, "low")}
        {data.drafts && data.drafts.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--border)]">
            <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-[var(--foreground)]">
              <FileText className="h-3.5 w-3.5" />
              Suggested Drafts ({data.drafts.length})
            </div>
            {data.drafts.map((draft, i) => (
              <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-2.5 mb-1.5">
                <div className="text-xs font-medium text-[var(--foreground)]">{draft.subject}</div>
                <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">To: {draft.to}</div>
                <p className="text-[11px] text-[var(--muted-foreground)] mt-1 line-clamp-2">{draft.body}</p>
                <button
                  onClick={() => onAction?.(`Send the draft reply to ${draft.to}: "${draft.subject}"`)}
                  className="flex items-center gap-1 mt-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
                >
                  <Send className="h-2.5 w-2.5" />
                  Review & Send
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Meeting Debrief Card ──────────────────────────────────────────
function MeetingDebriefCard({ data, onAction }: { data: MeetingDebriefData; onAction?: (msg: string) => void }) {
  const [doneItems, setDoneItems] = useState<Set<number>>(new Set());

  const toggleDone = (idx: number) => {
    setDoneItems((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--muted)]/30">
        <CalendarCheck className="h-4 w-4 text-[var(--primary)]" />
        <span className="text-sm font-medium text-[var(--foreground)]">{data.event_title}</span>
      </div>
      <div className="p-3 space-y-3">
        {/* Attendees */}
        {data.attendees && data.attendees.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">
              <Users className="h-3 w-3" />
              Attendees
            </div>
            <div className="flex flex-wrap gap-1">
              {data.attendees.map((a, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--muted)] text-[var(--foreground)]">{a}</span>
              ))}
            </div>
          </div>
        )}

        {/* Action Items */}
        {data.action_items && data.action_items.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-[var(--foreground)]">
              <ListChecks className="h-3.5 w-3.5 text-[var(--primary)]" />
              Action Items ({data.action_items.length})
            </div>
            <div className="space-y-1">
              {data.action_items.map((item, i) => {
                const isDone = doneItems.has(i);
                return (
                  <button
                    key={i}
                    className={`w-full flex items-start gap-2 rounded-lg px-3 py-2 text-left border transition-colors ${
                      isDone ? "border-green-200 bg-green-50/50" : "border-[var(--border)] hover:bg-[var(--muted)]/30"
                    }`}
                    onClick={() => toggleDone(i)}
                  >
                    <div className={`flex-shrink-0 mt-0.5 h-4 w-4 rounded border flex items-center justify-center transition-colors ${
                      isDone ? "bg-green-500 border-green-500" : "border-[var(--border)]"
                    }`}>
                      {isDone && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs ${isDone ? "text-[var(--muted-foreground)] line-through" : "text-[var(--foreground)]"}`}>{item.task}</span>
                      <div className="flex gap-2 mt-0.5">
                        {item.assignee && <span className="text-[10px] text-[var(--muted-foreground)]">{item.assignee}</span>}
                        {item.due && <span className="text-[10px] text-orange-500">{item.due}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => onAction?.(`Create Apple Reminders for all action items from "${data.event_title}"`)}
              className="flex items-center gap-1 mt-2 px-3 py-1.5 rounded-lg text-[10px] font-medium border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <CalendarPlus className="h-3 w-3" />
              Save as Reminders
            </button>
          </div>
        )}

        {/* Follow-up Emails */}
        {data.follow_ups && data.follow_ups.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-[var(--foreground)]">
              <Send className="h-3.5 w-3.5 text-blue-500" />
              Follow-up Emails ({data.follow_ups.length})
            </div>
            {data.follow_ups.map((fu, i) => (
              <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-2.5 mb-1.5">
                <div className="text-xs font-medium text-[var(--foreground)]">{fu.subject}</div>
                <div className="text-[10px] text-[var(--muted-foreground)]">To: {fu.to}</div>
                <p className="text-[11px] text-[var(--muted-foreground)] mt-1 line-clamp-2">{fu.body}</p>
                <button
                  onClick={() => onAction?.(`Send follow-up email to ${fu.to}: "${fu.subject}"`)}
                  className="flex items-center gap-1 mt-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                >
                  <Send className="h-2.5 w-2.5" />
                  Review & Send
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Meeting Notes */}
        {data.notes && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-[var(--foreground)]">
              <StickyNote className="h-3.5 w-3.5 text-yellow-500" />
              Meeting Notes
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-2.5">
              <p className="text-[11px] text-[var(--muted-foreground)] whitespace-pre-line leading-relaxed">{data.notes}</p>
            </div>
            <button
              onClick={() => onAction?.(`Save meeting notes for "${data.event_title}" to Apple Notes`)}
              className="flex items-center gap-1 mt-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <StickyNote className="h-3 w-3" />
              Save to Notes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── WhatsApp Summary Card ──────────────────────────────────────────
function WhatsAppSummaryCard({ data, onAction }: { data: WhatsAppSummaryData; onAction?: (msg: string) => void }) {
  const [replyText, setReplyText] = useState(data.suggested_reply || "");

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-gradient-to-r from-green-50 to-green-100/50">
        <MessageSquare className="h-4 w-4 text-green-600" />
        <span className="text-sm font-medium text-[var(--foreground)]">{data.chat_name}</span>
        {data.message_count && (
          <span className="text-xs text-[var(--muted-foreground)]">({data.message_count} messages)</span>
        )}
        {data.participants && data.participants.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            <Users className="h-3 w-3 text-[var(--muted-foreground)]" />
            <span className="text-[10px] text-[var(--muted-foreground)]">{data.participants.length}</span>
          </div>
        )}
      </div>
      <div className="p-3 space-y-3">
        {/* Summary */}
        <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{data.summary}</p>

        {/* Key Messages */}
        {data.key_messages && data.key_messages.length > 0 && (
          <div className="space-y-1">
            {data.key_messages.map((msg, i) => (
              <div key={i} className="flex gap-2 items-start">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
                  <span className="text-[8px] font-bold text-green-700">{msg.from.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0 rounded-lg bg-[var(--muted)]/40 px-3 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-[var(--foreground)]">{msg.from}</span>
                    <span className="text-[9px] text-[var(--muted-foreground)]">{msg.time}</span>
                  </div>
                  <p className="text-[11px] text-[var(--foreground)] mt-0.5">{msg.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Reply */}
        <div className="flex gap-2">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type a reply..."
            className="flex-1 text-xs bg-[var(--muted)] border-0 rounded-lg px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
          />
          <button
            onClick={() => {
              if (replyText.trim()) {
                onAction?.(`Send WhatsApp message to "${data.chat_name}": ${replyText}`);
              }
            }}
            disabled={!replyText.trim()}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-[10px] font-medium bg-green-500 text-white hover:bg-green-600 disabled:opacity-40 transition-all"
          >
            <Send className="h-3 w-3" />
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function parseEmailDrafts(content: string): {
  contentBefore: string;
  contentAfter: string;
  composer?: EmailComposerData;
  legacyDrafts?: EmailDraft[];
} | null {
  // Try new [EMAIL_COMPOSER] format first — with or without closing tag
  const composerMatch = content.match(/\[EMAIL_COMPOSER\]([\s\S]*?)(?:\[\/EMAIL_COMPOSER\]|$)/);
  if (composerMatch) {
    try {
      const repaired = repairJson(composerMatch[1].trim());
      const data = JSON.parse(repaired);
      if (data.options?.length) {
        const endIdx = composerMatch.index! + composerMatch[0].length;
        return {
          contentBefore: content.slice(0, composerMatch.index).trim(),
          contentAfter: content.slice(endIdx).trim(),
          composer: data as EmailComposerData,
        };
      }
    } catch { /* fall through */ }
  }

  // Legacy [EMAIL_DRAFT] blocks
  const regex = /\[EMAIL_DRAFT\]([\s\S]*?)\[\/EMAIL_DRAFT\]/g;
  const drafts: { draft: EmailDraft; start: number; end: number }[] = [];
  let m;
  while ((m = regex.exec(content)) !== null) {
    try {
      const d: EmailDraft = JSON.parse(m[1].trim());
      if (d.subject && d.body) {
        drafts.push({ draft: d, start: m.index, end: m.index + m[0].length });
      }
    } catch { /* skip malformed */ }
  }
  if (drafts.length === 0) return null;

  // Convert legacy drafts → composer format if multiple
  if (drafts.length >= 2) {
    const to = drafts[0].draft.to;
    return {
      contentBefore: content.slice(0, drafts[0].start).trim(),
      contentAfter: content.slice(drafts[drafts.length - 1].end).trim(),
      composer: {
        to,
        options: drafts.map((d, i) => ({
          label: `Option ${String.fromCharCode(65 + i)}`,
          subject: d.draft.subject,
          body: d.draft.body,
        })),
      },
    };
  }

  // Single legacy draft
  return {
    contentBefore: content.slice(0, drafts[0].start).trim(),
    contentAfter: content.slice(drafts[0].end).trim(),
    legacyDrafts: [drafts[0].draft],
  };
}

/** Clean up email body: normalize escaped newlines and trim */
function cleanEmailBody(raw: string): string {
  return raw.replace(/\\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Build Gmail compose URL */
function gmailComposeUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({ view: "cm", to, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/** Build Outlook compose URL */
function outlookComposeUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({ to, subject, body });
  return `https://outlook.live.com/mail/0/deeplink/compose?${params.toString()}`;
}

/** ── Interactive Email Composer component ── */
function EmailComposer({ data }: { data: EmailComposerData }) {
  const [activeTab, setActiveTab] = useState(0);
  const [to, setTo] = useState(data.to || "");
  const [subjects, setSubjects] = useState(data.options.map((o) => o.subject));
  const [bodies, setBodies] = useState(data.options.map((o) => cleanEmailBody(o.body)));
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [needsConnect, setNeedsConnect] = useState(false);

  // Auto-resize textarea
  const bodyRef = useCallback((node: HTMLTextAreaElement | null) => {
    if (node) {
      node.style.height = "auto";
      node.style.height = Math.max(140, node.scrollHeight) + "px";
    }
  }, [activeTab, bodies]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentSubject = subjects[activeTab] || "";
  const currentBody = bodies[activeTab] || "";

  const updateSubject = (val: string) => {
    setSubjects((prev) => { const n = [...prev]; n[activeTab] = val; return n; });
  };
  const updateBody = (val: string) => {
    setBodies((prev) => { const n = [...prev]; n[activeTab] = val; return n; });
  };

  // Formatting helpers
  const insertAtCursor = (textarea: HTMLTextAreaElement | null, before: string, after: string) => {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = currentBody.slice(start, end);
    const newText = currentBody.slice(0, start) + before + selected + after + currentBody.slice(end);
    updateBody(newText);
    setTimeout(() => { textarea.focus(); textarea.setSelectionRange(start + before.length, end + before.length); }, 0);
  };
  const handleBold = () => insertAtCursor(document.getElementById("email-body-ta") as HTMLTextAreaElement, "**", "**");
  const handleItalic = () => insertAtCursor(document.getElementById("email-body-ta") as HTMLTextAreaElement, "_", "_");
  const handleLink = () => {
    const url = prompt("Enter URL:");
    if (!url) return;
    const ta = document.getElementById("email-body-ta") as HTMLTextAreaElement;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = currentBody.slice(start, end) || "link text";
    updateBody(currentBody.slice(0, start) + `[${selected}](${url})` + currentBody.slice(end));
  };

  const handleSaveAsDraft = async () => {
    setSaving(true); setError(""); setNeedsConnect(false);
    try {
      const res = await fetch(`${API_BASE}/v1/gmail/drafts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject: currentSubject, body: currentBody }),
      });
      if (res.ok) { setSaved(true); window.open("https://mail.google.com/mail/u/0/#drafts", "_blank"); }
      else if (res.status === 401) { setNeedsConnect(true); }
      else { const d = await res.json().catch(() => ({})); setError(d.detail || "Failed to save draft."); }
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  };

  const connectGmail = () => {
    window.open("/v1/oauth/google/start?tool_id=gmail", "_blank");
    // After connecting, user can try Save as Draft again
    setNeedsConnect(false);
    setError("After connecting, click Save as Draft again.");
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(`To: ${to}\nSubject: ${currentSubject}\n\n${currentBody}`).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  const openGmail = () => window.open(gmailComposeUrl(to, currentSubject, currentBody), "_blank");
  const openOutlook = () => window.open(outlookComposeUrl(to, currentSubject, currentBody), "_blank");

  return (
    <div className="my-3 rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-sm">
      {/* Header with tabs */}
      <div className="bg-[var(--muted)]/50 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 px-4 pt-2.5 pb-0">
          <svg className="h-4 w-4 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Email Composer</span>
        </div>
        {data.options.length > 1 && (
          <div className="flex gap-0 px-4 mt-2">
            {data.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => { setActiveTab(i); setSaved(false); setError(""); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-lg border border-b-0 transition-colors ${
                  i === activeTab
                    ? "bg-[var(--card)] text-[var(--foreground)] border-[var(--border)]"
                    : "bg-transparent text-[var(--muted-foreground)] border-transparent hover:text-[var(--foreground)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Editable fields */}
      <div className="px-4 py-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--muted-foreground)] shrink-0 w-14">To:</span>
          <input type="email" value={to} onChange={(e) => setTo(e.target.value)}
            className="flex-1 text-sm bg-transparent border-0 border-b border-dashed border-[var(--border)] focus:border-blue-400 outline-none py-1 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
            placeholder="recipient@example.com" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--muted-foreground)] shrink-0 w-14">Subject:</span>
          <input type="text" value={currentSubject} onChange={(e) => updateSubject(e.target.value)}
            className="flex-1 text-sm font-medium bg-transparent border-0 border-b border-dashed border-[var(--border)] focus:border-blue-400 outline-none py-1 text-[var(--foreground)]" />
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 pt-2 mt-1 border-t border-[var(--border)]">
          <button onClick={handleBold} className="h-7 w-7 flex items-center justify-center rounded hover:bg-[var(--muted)] transition-colors" title="Bold">
            <span className="text-xs font-bold text-[var(--muted-foreground)]">B</span>
          </button>
          <button onClick={handleItalic} className="h-7 w-7 flex items-center justify-center rounded hover:bg-[var(--muted)] transition-colors" title="Italic">
            <span className="text-xs italic text-[var(--muted-foreground)]">I</span>
          </button>
          <button onClick={handleLink} className="h-7 w-7 flex items-center justify-center rounded hover:bg-[var(--muted)] transition-colors" title="Insert link">
            <svg className="h-3.5 w-3.5 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
          </button>
        </div>

        {/* Body */}
        <textarea
          id="email-body-ta"
          ref={bodyRef}
          value={currentBody}
          onChange={(e) => {
            updateBody(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.max(140, e.target.scrollHeight) + "px";
          }}
          className="w-full text-sm text-[var(--foreground)] bg-transparent border-0 outline-none resize-none leading-relaxed min-h-[140px] py-2"
        />
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-[var(--muted)]/30 border-t border-[var(--border)]">
        {/* Open in Gmail */}
        <button onClick={openGmail}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#4285F4] text-white hover:bg-[#3367D6] transition-colors">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z"/></svg>
          Open in Gmail
        </button>
        {/* Open in Outlook */}
        <button onClick={openOutlook}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#0078D4] text-white hover:bg-[#106EBE] transition-colors">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18l7 3.5v7.64l-7 3.5-7-3.5V7.68l7-3.5zM12 8a4 4 0 100 8 4 4 0 000-8z"/></svg>
          Open in Outlook
        </button>
        <div className="h-4 w-px bg-[var(--border)]" />
        {/* Save as Draft */}
        <button onClick={handleSaveAsDraft} disabled={saving || saved}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--muted)] text-[var(--foreground)] hover:bg-[var(--border)] disabled:opacity-50 transition-colors">
          {saving ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</>
          ) : saved ? (
            <><Check className="h-3 w-3" /> Saved</>
          ) : (
            "Save as Draft"
          )}
        </button>
        {/* Copy */}
        <button onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--muted)] text-[var(--foreground)] hover:bg-[var(--border)] transition-colors">
          {copied ? "Copied!" : "Copy"}
        </button>
        {needsConnect && (
          <button onClick={connectGmail}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#EA4335] text-white hover:bg-[#D33426] transition-colors">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Connect Google Account
          </button>
        )}
        {error && <span className="text-xs text-red-500 ml-1">{error}</span>}
      </div>
    </div>
  );
}

/** Legacy single EmailDraftCard (for backward compat with single [EMAIL_DRAFT]) */
function EmailDraftCard({ draft }: { draft: EmailDraft; index: number }) {
  return (
    <EmailComposer
      data={{ to: draft.to, options: [{ label: "Draft", subject: draft.subject, body: draft.body }] }}
    />
  );
}

/** ── Outreach Table types and parser ── */
interface OutreachContact {
  name: string;
  first_name: string;
  email: string;
  title: string;
  company: string;
  industry?: string;
  linkedin?: string;
  [key: string]: string | undefined;
}

interface OutreachTableData {
  email_template: { subject: string; body: string };
  linkedin_template?: string;
  contacts: OutreachContact[];
}

function parseOutreachTable(content: string): {
  contentBefore: string;
  data: OutreachTableData;
  contentAfter: string;
} | null {
  const match = content.match(/\[OUTREACH_TABLE\]([\s\S]*?)\[\/OUTREACH_TABLE\]/);
  if (!match) return null;
  try {
    const repaired = repairJson(match[1].trim());
    const data: OutreachTableData = JSON.parse(repaired);
    if (!data.contacts?.length || !data.email_template) return null;
    return {
      contentBefore: content.slice(0, match.index).trim(),
      data,
      contentAfter: content.slice(match.index! + match[0].length).trim(),
    };
  } catch { return null; }
}

/** Replace {placeholders} in a template with contact data */
function fillTemplate(template: string, contact: OutreachContact): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => contact[key] || key);
}

/** Outreach Table component — bulk email/LinkedIn */
function OutreachTable({ data }: { data: OutreachTableData }) {
  const [view, setView] = useState<"table" | "cards">("table");
  const [emailSubject, setEmailSubject] = useState(data.email_template.subject);
  const [emailBody, setEmailBody] = useState(cleanEmailBody(data.email_template.body));
  const [linkedinMsg, setLinkedinMsg] = useState(data.linkedin_template ? cleanEmailBody(data.linkedin_template) : "");
  const [showTemplates, setShowTemplates] = useState(true);
  const [sent, setSent] = useState<Set<number>>(new Set());

  const contacts = data.contacts;
  const hasLinkedin = contacts.some((c) => c.linkedin);

  const getGmailUrl = (contact: OutreachContact) => {
    const subject = fillTemplate(emailSubject, contact);
    const body = fillTemplate(emailBody, contact);
    return gmailComposeUrl(contact.email, subject, body);
  };

  const getLinkedinUrl = (contact: OutreachContact) => {
    if (!contact.linkedin) return "";
    const url = contact.linkedin.startsWith("http") ? contact.linkedin : `https://${contact.linkedin}`;
    return url;
  };

  const openGmail = (idx: number) => {
    window.open(getGmailUrl(contacts[idx]), "_blank");
    setSent((prev) => new Set(prev).add(idx));
  };

  const openAllGmail = () => {
    contacts.forEach((c, i) => {
      setTimeout(() => {
        window.open(getGmailUrl(c), "_blank");
        setSent((prev) => new Set(prev).add(i));
      }, i * 300); // stagger to avoid popup blocker
    });
  };

  return (
    <div className="my-3 rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--muted)]/50 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Outreach — {contacts.length} contacts</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* View toggle */}
          <button onClick={() => setView("table")}
            className={`p-1.5 rounded transition-colors ${view === "table" ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M3 6h18M3 18h18" /></svg>
          </button>
          <button onClick={() => setView("cards")}
            className={`p-1.5 rounded transition-colors ${view === "cards" ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
          </button>
          <div className="h-4 w-px bg-[var(--border)] mx-0.5" />
          <button onClick={() => setShowTemplates(!showTemplates)}
            className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors px-1.5">
            {showTemplates ? "Hide" : "Edit"} templates
          </button>
        </div>
      </div>

      {/* Editable templates */}
      {showTemplates && (
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--muted)]/20 space-y-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <svg className="h-3 w-3 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Email template</span>
              <span className="text-[10px] text-[var(--muted-foreground)]">— use {"{first_name}"}, {"{company}"}, {"{title}"}, {"{industry}"}</span>
            </div>
            <input type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)}
              className="w-full text-xs bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--foreground)] outline-none focus:border-blue-400 mb-1.5"
              placeholder="Subject line..." />
            <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)}
              className="w-full text-xs bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] outline-none focus:border-blue-400 resize-none leading-relaxed min-h-[100px]"
              rows={5} />
          </div>
          {(hasLinkedin || linkedinMsg) && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <svg className="h-3 w-3 text-[#0A66C2]" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">LinkedIn message</span>
              </div>
              <textarea value={linkedinMsg} onChange={(e) => setLinkedinMsg(e.target.value)}
                className="w-full text-xs bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] outline-none focus:border-blue-400 resize-none leading-relaxed"
                rows={2} placeholder="LinkedIn connection message..." />
            </div>
          )}
        </div>
      )}

      {/* Contact list — table view */}
      {view === "table" && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                <th className="text-left font-medium text-[var(--muted-foreground)] px-3 py-2 w-8">#</th>
                <th className="text-left font-medium text-[var(--muted-foreground)] px-3 py-2">Name</th>
                <th className="text-left font-medium text-[var(--muted-foreground)] px-3 py-2">Title</th>
                <th className="text-left font-medium text-[var(--muted-foreground)] px-3 py-2">Company</th>
                <th className="text-left font-medium text-[var(--muted-foreground)] px-3 py-2">Email</th>
                <th className="text-right font-medium text-[var(--muted-foreground)] px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c, i) => (
                <tr key={i} className={`border-b border-[var(--border)] last:border-0 transition-colors ${sent.has(i) ? "bg-green-50/50" : "hover:bg-[var(--muted)]/30"}`}>
                  <td className="px-3 py-2 text-[var(--muted-foreground)]">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-[var(--foreground)]">{c.name}</td>
                  <td className="px-3 py-2 text-[var(--muted-foreground)]">{c.title}</td>
                  <td className="px-3 py-2 text-[var(--foreground)]">{c.company}</td>
                  <td className="px-3 py-2 text-blue-500">{c.email}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openGmail(i)}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${sent.has(i) ? "bg-green-100 text-green-700" : "bg-[#4285F4]/10 text-[#4285F4] hover:bg-[#4285F4]/20"}`}>
                        {sent.has(i) ? <><Check className="h-2.5 w-2.5" /> Opened</> : "Gmail"}
                      </button>
                      {c.linkedin && (
                        <a href={getLinkedinUrl(c)} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[#0A66C2]/10 text-[#0A66C2] hover:bg-[#0A66C2]/20 transition-colors">
                          LinkedIn
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Contact list — cards view */}
      {view === "cards" && (
        <div className="p-3 grid gap-2 sm:grid-cols-2">
          {contacts.map((c, i) => (
            <div key={i} className={`rounded-lg border p-3 transition-colors ${sent.has(i) ? "border-green-300 bg-green-50/30" : "border-[var(--border)] bg-[var(--card)]"}`}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div>
                  <div className="text-sm font-medium text-[var(--foreground)]">{c.name}</div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">{c.title} at {c.company}</div>
                </div>
                <span className="text-[10px] text-[var(--muted-foreground)] bg-[var(--muted)] px-1.5 py-0.5 rounded">#{i + 1}</span>
              </div>
              <div className="text-[11px] text-blue-500 mb-2">{c.email}</div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => openGmail(i)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${sent.has(i) ? "bg-green-100 text-green-700" : "bg-[#4285F4] text-white hover:bg-[#3367D6]"}`}>
                  {sent.has(i) ? <><Check className="h-2.5 w-2.5" /> Opened</> : <><svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z"/></svg> Gmail</>}
                </button>
                {c.linkedin && (
                  <a href={getLinkedinUrl(c)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[#0A66C2] text-white hover:bg-[#094d92] transition-colors">
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bottom action bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-[var(--muted)]/30 border-t border-[var(--border)]">
        <button onClick={openAllGmail}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#4285F4] text-white hover:bg-[#3367D6] transition-colors">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z"/></svg>
          Open All in Gmail ({contacts.length})
        </button>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {sent.size}/{contacts.length} opened
        </span>
      </div>
    </div>
  );
}

/** Parse A) B) C) D) E) options from assistant content */
function parseChoiceOptions(content: string): {
  contentBefore: string;
  options: { letter: string; text: string; fullLine: string }[];
  contentAfter: string;
} | null {
  const optionRegex = /^([A-E])\)\s*(.+)$/gm;
  const options: { letter: string; text: string; fullLine: string; start: number; end: number }[] = [];
  let m;
  while ((m = optionRegex.exec(content)) !== null) {
    options.push({
      letter: m[1],
      text: cleanText(m[2]),
      fullLine: m[0].trimEnd(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  if (options.length < 3 || options.length > 5) return null;
  const letters = options.map((o) => o.letter).join("");
  const expected = "ABCDE".slice(0, options.length);
  if (letters !== expected) return null;

  const contentBefore = content.slice(0, options[0].start).trim();
  const contentAfter = content.slice(options[options.length - 1].end).trim();
  return {
    contentBefore,
    options: options.map((o) => ({ letter: o.letter, text: o.text, fullLine: o.fullLine })),
    contentAfter,
  };
}

/** ── Person Intelligence types, parser, and component ── */
interface PersonActivity {
  date?: string;
  type?: string;
  text: string;
  url?: string;
}

interface PersonIntelData {
  name: string;
  company?: string;
  title?: string;
  summary: string;
  activities: PersonActivity[];
  interests?: string[];
  talking_points?: string[];
  social?: { linkedin?: string; twitter?: string };
}

function parsePersonIntel(content: string): {
  contentBefore: string;
  data: PersonIntelData;
  contentAfter: string;
} | null {
  const match = content.match(/\[PERSON_INTEL\]([\s\S]*?)(?:\[\/PERSON_INTEL\]|$)/);
  if (!match) return null;
  try {
    const repaired = repairJson(match[1].trim());
    const data: PersonIntelData = JSON.parse(repaired);
    if (!data.name || !data.activities) return null;
    return {
      contentBefore: content.slice(0, match.index).trim(),
      data,
      contentAfter: content.slice(match.index! + match[0].length).trim(),
    };
  } catch { return null; }
}

const activityTypeColors: Record<string, string> = {
  news: "bg-blue-100 text-blue-700",
  social: "bg-purple-100 text-purple-700",
  funding: "bg-green-100 text-green-700",
  speaking: "bg-amber-100 text-amber-700",
  interview: "bg-cyan-100 text-cyan-700",
  partnership: "bg-indigo-100 text-indigo-700",
  publication: "bg-rose-100 text-rose-700",
};

function PersonIntelCard({ data, onAction }: { data: PersonIntelData; onAction?: (msg: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const visibleActivities = showAll ? data.activities : data.activities.slice(0, 4);

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--muted)]/30">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">{data.name}</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              {data.title}{data.title && data.company ? " at " : ""}{data.company}
            </p>
          </div>
          <div className="flex gap-1.5">
            {data.social?.linkedin && (
              <a href={data.social.linkedin} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-[#0A66C2] text-white hover:bg-[#094d92] transition-colors">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                LinkedIn
              </a>
            )}
            {data.social?.twitter && (
              <a href={data.social.twitter} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-black text-white hover:bg-neutral-800 transition-colors">
                X
              </a>
            )}
          </div>
        </div>
        {data.summary && (
          <p className="text-xs text-[var(--muted-foreground)] mt-2 leading-relaxed">{data.summary}</p>
        )}
      </div>

      {/* Activities timeline */}
      <div className="px-4 py-3">
        <h4 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-2">Recent Activity</h4>
        <div className="space-y-2">
          {visibleActivities.map((a, i) => (
            <div key={i} className="flex gap-2 items-start">
              <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium mt-0.5 ${activityTypeColors[a.type || "news"] || "bg-neutral-100 text-neutral-600"}`}>
                {a.type || "news"}
              </span>
              <div className="flex-1 min-w-0">
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--foreground)] hover:text-[var(--primary)] transition-colors leading-relaxed">
                    {a.text}
                  </a>
                ) : (
                  <p className="text-xs text-[var(--foreground)] leading-relaxed">{a.text}</p>
                )}
                {a.date && <span className="text-[10px] text-[var(--muted-foreground)]">{a.date}</span>}
              </div>
            </div>
          ))}
        </div>
        {data.activities.length > 4 && (
          <button onClick={() => setShowAll(!showAll)} className="text-[10px] text-[var(--primary)] mt-2 hover:underline">
            {showAll ? "Show less" : `Show all ${data.activities.length} activities`}
          </button>
        )}
      </div>

      {/* Talking Points */}
      {data.talking_points && data.talking_points.length > 0 && (
        <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--muted)]/20">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-2">Talking Points for Outreach</h4>
          <div className="space-y-1.5">
            {data.talking_points.map((tp, i) => (
              <div key={i} className="flex gap-2 items-start text-xs">
                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center text-[9px] font-bold mt-0.5">{i + 1}</span>
                <span className="text-[var(--foreground)] leading-relaxed">{tp}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interests */}
      {data.interests && data.interests.length > 0 && (
        <div className="px-4 py-2.5 border-t border-[var(--border)]">
          <div className="flex flex-wrap gap-1.5">
            {data.interests.map((interest, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full bg-[var(--muted)] text-[10px] text-[var(--muted-foreground)]">{interest}</span>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 px-4 py-2.5 bg-[var(--muted)]/30 border-t border-[var(--border)]">
        <button onClick={() => onAction?.(`Write a personalized email to ${data.name} at ${data.company || "their company"} using the insights above`)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-opacity">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z"/></svg>
          Write Email
        </button>
        <button onClick={() => onAction?.(`Set up a follow-up sequence for ${data.name} at ${data.company || "their company"}`)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors">
          <Calendar className="h-3 w-3" />
          Set Up Follow-ups
        </button>
      </div>
    </div>
  );
}


/** ── Follow-Up Sequence types, parser, and component ── */
interface FollowUpStepData {
  order: number;
  type: string; // email, linkedin, reminder, call
  delay_days: number;
  subject: string;
  body: string;
}

interface FollowUpData {
  person: {
    name: string;
    email?: string;
    company?: string;
    linkedin?: string;
  };
  steps: FollowUpStepData[];
}

function parseFollowUp(content: string): {
  contentBefore: string;
  data: FollowUpData;
  contentAfter: string;
} | null {
  const match = content.match(/\[FOLLOW_UP\]([\s\S]*?)(?:\[\/FOLLOW_UP\]|$)/);
  if (!match) return null;
  try {
    const repaired = repairJson(match[1].trim());
    const data: FollowUpData = JSON.parse(repaired);
    if (!data.person?.name || !data.steps?.length) return null;
    return {
      contentBefore: content.slice(0, match.index).trim(),
      data,
      contentAfter: content.slice(match.index! + match[0].length).trim(),
    };
  } catch { return null; }
}

const stepTypeConfig: Record<string, { icon: string; label: string; color: string }> = {
  email: { icon: "M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z", label: "Email", color: "bg-blue-500" },
  linkedin: { icon: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452z", label: "LinkedIn", color: "bg-[#0A66C2]" },
  reminder: { icon: "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z", label: "Reminder", color: "bg-amber-500" },
  call: { icon: "M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z", label: "Call", color: "bg-green-500" },
};

function FollowUpSequence({ data }: { data: FollowUpData }) {
  const [stepStatuses, setStepStatuses] = useState<Record<number, string>>(
    Object.fromEntries(data.steps.map((s) => [s.order, "pending"]))
  );
  const [expandedStep, setExpandedStep] = useState<number | null>(1);

  const markDone = (order: number) => {
    setStepStatuses((prev) => ({ ...prev, [order]: "done" }));
  };

  // Calculate cumulative day
  let cumulativeDay = 0;

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--muted)]/30">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Follow-up Sequence</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              {data.person.name}{data.person.company ? ` at ${data.person.company}` : ""}
              {data.person.email ? ` — ${data.person.email}` : ""}
            </p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
            {data.steps.length} steps
          </span>
        </div>
      </div>

      {/* Steps timeline */}
      <div className="px-4 py-3">
        {data.steps.map((step, i) => {
          cumulativeDay += step.delay_days;
          const config = stepTypeConfig[step.type] || stepTypeConfig.email;
          const isDone = stepStatuses[step.order] === "done";
          const isExpanded = expandedStep === step.order;

          return (
            <div key={step.order} className="relative">
              {/* Timeline connector */}
              {i < data.steps.length - 1 && (
                <div className="absolute left-[11px] top-[28px] bottom-0 w-0.5 bg-[var(--border)]" />
              )}

              {/* Step header */}
              <button
                onClick={() => setExpandedStep(isExpanded ? null : step.order)}
                className="flex items-center gap-3 w-full text-left py-2 group"
              >
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${isDone ? "bg-green-500" : config.color}`}>
                  {isDone ? (
                    <Check className="h-3 w-3 text-white" />
                  ) : (
                    <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="currentColor"><path d={config.icon} /></svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${isDone ? "text-green-600 line-through" : "text-[var(--foreground)]"}`}>
                      Day {cumulativeDay}: {config.label}
                    </span>
                    {step.subject && (
                      <span className="text-[10px] text-[var(--muted-foreground)] truncate">{step.subject}</span>
                    )}
                  </div>
                </div>
                <ChevronDown className={`h-3 w-3 text-[var(--muted-foreground)] transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="ml-9 mb-3 p-3 rounded-lg bg-[var(--muted)]/30 border border-[var(--border)]">
                  {step.subject && (
                    <p className="text-xs font-medium text-[var(--foreground)] mb-1">{step.subject}</p>
                  )}
                  <p className="text-xs text-[var(--muted-foreground)] whitespace-pre-line leading-relaxed">
                    {cleanEmailBody(step.body)}
                  </p>
                  <div className="flex gap-2 mt-2">
                    {step.type === "email" && data.person.email && (
                      <a href={gmailComposeUrl(data.person.email, step.subject, cleanEmailBody(step.body))} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[#4285F4] text-white hover:bg-[#3367D6] transition-colors">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z"/></svg>
                        Open in Gmail
                      </a>
                    )}
                    {step.type === "linkedin" && data.person.linkedin && (
                      <a href={data.person.linkedin} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[#0A66C2] text-white hover:bg-[#094d92] transition-colors">
                        Open LinkedIn
                      </a>
                    )}
                    {!isDone && (
                      <button onClick={() => markDone(step.order)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                        <Check className="h-2.5 w-2.5" /> Mark Done
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


interface MessageImage {
  base64: string;
  mimeType: string;
  preview: string;
}

interface MessageDocument {
  fileName: string;
  mimeType: string;
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  sources?: SearchResultItem[];
  usedTool?: SearchResultItem;
  images?: MessageImage[];
  documents?: MessageDocument[];
  webSources?: WebSource[];
  urlSources?: UrlSource[];
  mode?: "agentnet" | "web" | "both";
  isStreaming?: boolean;
  onSendChoice?: (choiceText: string) => void;
  fetchMoreContext?: { history: ChatMsg[]; mode: string };
  // Job agent
  browserScreenshots?: { image: string; url: string; action: string }[];
  agentStatus?: { phase: string; message: string; step?: number; action?: string; jobs_found?: number } | null;
  foundJobs?: { title: string; company: string; url: string; description?: string }[];
  agentQuestion?: { question: string; reason: string } | null;
  jobAgentActive?: boolean;
  // Proactive assistant
  appleActions?: { type: "calendar" | "reminder" | "note"; data: Record<string, string>; status: "created" | "pending" | "error" }[];
  routineSetup?: { name: string; schedule: string; status: "activated" | "pending" | "error" } | null;
  // Generated artifacts (documents, slides, sheets)
  artifact?: { artifact_id: string; artifact_type: string; title: string; files: { name: string; size: number; type: string }[]; slides_count?: number } | null;
  // Activity indicators
  activities?: { action: string; status: string; detail: string }[];
}

const MD_STYLES = [
  "text-[0.92rem] text-[var(--foreground)]",
  "prose max-w-none",
  "[&>*]:leading-[1.7]",
  "prose-p:text-[0.92rem] prose-p:leading-[1.7] prose-p:mb-2.5 prose-p:mt-0",
  "prose-strong:text-[var(--foreground)] prose-strong:font-semibold",
  "prose-code:bg-[var(--muted)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-sm prose-code:font-mono",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-headings:text-[var(--foreground)]",
  "prose-h3:text-base prose-h3:font-semibold prose-h3:mt-5 prose-h3:mb-1.5",
  "prose-li:text-[0.92rem] prose-li:leading-[1.7] prose-li:ml-0 prose-ul:my-2 prose-ol:my-2",
  "prose-table:text-sm prose-th:text-left prose-th:font-semibold prose-th:pb-2",
  "prose-td:py-1.5 prose-td:pr-4",
  "prose-a:text-[var(--primary)] prose-a:no-underline hover:prose-a:underline",
].join(" ");

/** Inline suggest-tool form */
function SuggestToolForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = () => {
    if (!name.trim()) return;
    suggestTool(name.trim(), url.trim(), reason.trim());
    setSent(true);
    setTimeout(onClose, 1500);
  };

  if (sent) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] py-2">
        <Check className="h-3.5 w-3.5" />
        Thanks! We'll review your suggestion.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--foreground)]">Suggest a tool</span>
        <button onClick={onClose} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        type="text"
        placeholder="Tool name (e.g. Clay, Notion, Zapier)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full text-sm bg-[var(--muted)] border-0 rounded-lg px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
      />
      <input
        type="text"
        placeholder="URL (optional)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="w-full text-sm bg-[var(--muted)] border-0 rounded-lg px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
      />
      <input
        type="text"
        placeholder="Why is it useful here? (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full text-sm bg-[var(--muted)] border-0 rounded-lg px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
      />
      <button
        onClick={handleSubmit}
        disabled={!name.trim()}
        className="text-xs font-medium px-4 py-1.5 rounded-lg bg-[var(--foreground)] text-[var(--card)] hover:opacity-90 disabled:opacity-40 transition-opacity"
      >
        Submit
      </button>
    </div>
  );
}

export function ChatMessage({ role, content, sources, usedTool, images, documents, webSources, urlSources, mode, isStreaming, onSendChoice, fetchMoreContext, browserScreenshots, agentStatus, foundJobs, agentQuestion, jobAgentActive, appleActions, routineSetup, artifact, activities }: ChatMessageProps) {
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const [showSuggest, setShowSuggest] = useState(false);
  const [toolsCollapsed, setToolsCollapsed] = useState(true);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);

  const handleToolSelect = (tool: SearchResultItem) => {
    setSelectedToolId(tool.tool_id);
    const actions = tool.workflow.map((s) => s.action_name).join(", ");
    onSendChoice?.(`I want to use ${tool.tool_name}. Help me connect to it and guide me step by step through using it. Available actions: ${actions}`);
  };

  const handleVote = (v: "up" | "down") => {
    if (vote) return; // already voted
    setVote(v);
    sendFeedback(cleanContent, v);
  };

  if (role === "user") {
    return (
      <div className="flex justify-end mb-6">
        <div className="max-w-[90%] sm:max-w-[80%] rounded-2xl rounded-br-sm bg-[var(--primary)] text-[var(--primary-foreground)] px-3 sm:px-4 py-2 sm:py-2.5 text-[0.88rem] sm:text-[0.95rem] leading-relaxed">
          {images && images.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {images.map((img, i) => (
                <img
                  key={i}
                  src={img.preview}
                  alt="Attached"
                  className="max-h-48 max-w-full rounded-lg object-contain"
                />
              ))}
            </div>
          )}
          {documents && documents.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {documents.map((doc, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs">
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  <span className="truncate max-w-[150px]">{doc.fileName}</span>
                </div>
              ))}
            </div>
          )}
          {content}
        </div>
      </div>
    );
  }

  const isWeb = mode === "web";
  const isBoth = mode === "both";
  // Strip [TOOL:#N] metadata tag before any parsing or rendering
  // Also strip [JOB_AGENT_START]...[/JOB_AGENT_START] tags from displayed content
  const cleanContent = stripToolTag(content)
    .replace(/\[JOB_AGENT_START\][\s\S]*?\[\/JOB_AGENT_START\]/g, "")
    .replace(/\[JOB_PROFILE\][\s\S]*?\[\/JOB_PROFILE\]/g, "")
    .replace(/\[APPLE_CALENDAR\][\s\S]*?\[\/APPLE_CALENDAR\]/g, "")
    .replace(/\[APPLE_REMINDER\][\s\S]*?\[\/APPLE_REMINDER\]/g, "")
    .replace(/\[APPLE_NOTE\][\s\S]*?\[\/APPLE_NOTE\]/g, "")
    .replace(/\[ROUTINE_SETUP\][\s\S]*?\[\/ROUTINE_SETUP\]/g, "")
    .replace(/\[EMAIL_INBOX_SUMMARY\][\s\S]*?\[\/EMAIL_INBOX_SUMMARY\]/g, "")
    .replace(/\[MEETING_DEBRIEF\][\s\S]*?\[\/MEETING_DEBRIEF\]/g, "")
    .replace(/\[WHATSAPP_SUMMARY\][\s\S]*?\[\/WHATSAPP_SUMMARY\]/g, "")
    .replace(/\[WHATSAPP_SEND\][\s\S]*?\[\/WHATSAPP_SEND\]/g, "")
    .replace(/\[WORKFLOW_CREATE\][\s\S]*?\[\/WORKFLOW_CREATE\]/g, "")
    .trim();

  const hasJobAgent = !!(browserScreenshots?.length || agentStatus || foundJobs?.length || agentQuestion);
  const stepForm = !isStreaming && !isWeb && cleanContent ? parseStepForm(cleanContent) : null;
  const tableBlock = !isStreaming && !isWeb && !stepForm && cleanContent ? parseTableBlock(cleanContent) : null;
  const resultsBlock = !isStreaming && !isWeb && !stepForm && !tableBlock && cleanContent ? parseResultsBlock(cleanContent) : null;
  const choiceBlock = !isStreaming && !isWeb && !stepForm && !tableBlock && !resultsBlock && cleanContent ? parseChoiceOptions(cleanContent) : null;
  const inboxSummary = !isStreaming && content ? parseInboxSummary(content) : null;
  const meetingDebrief = !isStreaming && content ? parseMeetingDebrief(content) : null;
  const whatsAppSummary = !isStreaming && content ? parseWhatsAppSummary(content) : null;
  const personIntel = !isStreaming && cleanContent ? parsePersonIntel(cleanContent) : null;
  const followUp = !isStreaming && cleanContent ? parseFollowUp(cleanContent) : null;
  const emailDrafts = !isStreaming && cleanContent ? parseEmailDrafts(cleanContent) : null;
  const outreachTable = !isStreaming && cleanContent ? parseOutreachTable(cleanContent) : null;
  const showActions = !isStreaming && cleanContent.length > 0 && !isWeb;

  const handleStepFormComplete = (answers: string[]) => {
    if (!stepForm) return;
    const summary = stepForm.steps
      .map((s, i) => `${s.question}: ${answers[i]}`)
      .join("\n");
    onSendChoice?.(summary);
  };

  // Streaming cursor — shown inline at the end of any streaming response
  const StreamCursor = () => isStreaming ? (
    <span className="inline-block w-0.5 h-4 bg-[var(--foreground)]/70 animate-pulse align-text-bottom ml-0.5 rounded-full" />
  ) : null;

  return (
    <div className="mb-6">
      <div className="flex items-start gap-2 sm:gap-3">
        {/* Iris avatar */}
        <div className="flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white border border-neutral-200 flex items-center justify-center mt-0.5 overflow-hidden">
          <img src="/iris-logo.png" alt="Iris" className="w-4 h-4 sm:w-5 sm:h-5 object-contain" />
        </div>

        <div className="flex-1 min-w-0 pt-0.5">
          {/* URL fetch badges */}
          {urlSources && urlSources.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {urlSources.map((s, i) => {
                let hostname = s.url;
                try { hostname = new URL(s.url).hostname.replace("www.", ""); } catch {}
                return (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      s.status === "ok"
                        ? "border-emerald-500/30 text-emerald-600 bg-emerald-50 hover:bg-emerald-100"
                        : "border-red-500/30 text-red-500 bg-red-50 hover:bg-red-100"
                    }`}
                  >
                    <Globe className="h-2.5 w-2.5" />
                    {hostname}
                    {s.status === "error" && " (failed)"}
                  </a>
                );
              })}
            </div>
          )}

          {/* Activity indicators (searching, thinking, etc.) */}
          {activities && activities.length > 0 && (() => {
            // When not streaming, only show completed activities (hide running spinners)
            const visible = isStreaming
              ? activities
              : activities.filter((a) => a.status === "done");
            if (visible.length === 0) return null;
            return (
              <div className="flex flex-col gap-1 mb-2.5">
                {visible.map((act, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[0.72rem] text-[var(--muted-foreground)]">
                    {act.status === "running" ? (
                      <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
                    ) : act.action === "web_search" ? (
                      <Globe className="h-3 w-3 text-emerald-500" />
                    ) : act.action === "tool_search" ? (
                      <Zap className="h-3 w-3 text-amber-500" />
                    ) : (
                      <Check className="h-3 w-3 text-emerald-500" />
                    )}
                    <span>{act.detail}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          {isWeb ? (
            <>
              <div className={MD_STYLES}>
                <ReactMarkdown>{cleanContent}</ReactMarkdown>
                <StreamCursor />
              </div>
              {webSources && webSources.length > 0 && !isStreaming && (
                <div className="mt-3">
                  <div className="flex items-center gap-1.5 mb-2 text-[0.72rem] text-[var(--muted-foreground)]">
                    <Globe className="h-3 w-3" />
                    <span>{webSources.length} web sources</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {webSources.map((s, i) => (
                      <a
                        key={i}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--card)] text-[0.7rem] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/20 transition-colors max-w-[200px] truncate"
                        title={s.title}
                      >
                        <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                        <span className="truncate">{s.title}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : stepForm ? (
            <>
              {stepForm.contentBefore && (
                <div className={MD_STYLES}>
                  <ReactMarkdown>{stepForm.contentBefore}</ReactMarkdown>
                </div>
              )}
              <StepForm steps={stepForm.steps} onComplete={handleStepFormComplete} />
              {stepForm.contentAfter && (
                <div className={`mt-3 ${MD_STYLES}`}>
                  <ReactMarkdown>{stepForm.contentAfter}</ReactMarkdown>
                </div>
              )}
            </>
          ) : tableBlock ? (
            <>
              {tableBlock.contentBefore && (
                <div className={MD_STYLES}>
                  <ReactMarkdown>{tableBlock.contentBefore}</ReactMarkdown>
                </div>
              )}
              <DataTable block={tableBlock.block} onAction={(msg) => onSendChoice?.(msg)} fetchMoreContext={fetchMoreContext} />
              {tableBlock.contentAfter && (
                <div className={`mt-3 ${MD_STYLES}`}>
                  <ReactMarkdown>{tableBlock.contentAfter}</ReactMarkdown>
                </div>
              )}
            </>
          ) : resultsBlock ? (
            <>
              {resultsBlock.contentBefore && (
                <div className={MD_STYLES}>
                  <ReactMarkdown>{resultsBlock.contentBefore}</ReactMarkdown>
                </div>
              )}
              <ResultCards
                block={resultsBlock.block}
                onSelect={(item) => onSendChoice?.(`I want ${item.title}${item.detail ? ` (${item.detail})` : ""}${item.price ? ` at ${item.price}` : ""}`)}
                onLoadMore={() => onSendChoice?.("Show me more results, different options from other platforms or listings.")}
              />
              {resultsBlock.contentAfter && (
                <div className={`mt-3 ${MD_STYLES}`}>
                  <ReactMarkdown>{resultsBlock.contentAfter}</ReactMarkdown>
                </div>
              )}
            </>
          ) : choiceBlock ? (
            <>
              {choiceBlock.contentBefore && (
                <div className={MD_STYLES}>
                  <ReactMarkdown>{choiceBlock.contentBefore}</ReactMarkdown>
                </div>
              )}
              <div className="mt-3 space-y-1.5">
                {choiceBlock.options.map((opt) => {
                  const isChosen = selectedChoice === opt.letter;
                  const isDimmed = selectedChoice !== null && !isChosen;
                  return (
                    <button
                      key={opt.letter}
                      type="button"
                      disabled={selectedChoice !== null}
                      onClick={() => {
                        setSelectedChoice(opt.letter);
                        onSendChoice?.(opt.fullLine);
                      }}
                      className={`w-full flex items-center justify-between gap-2 sm:gap-3 rounded-xl border px-3 sm:px-4 py-2 sm:py-2.5 text-left text-[0.82rem] sm:text-sm transition-all ${
                        isChosen
                          ? "border-[var(--foreground)]/30 bg-[var(--muted)] font-medium"
                          : isDimmed
                          ? "border-[var(--border)] bg-[var(--card)] opacity-40 cursor-default"
                          : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--foreground)]/20 hover:bg-[var(--muted)]/50 active:scale-[0.99]"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {isChosen ? (
                          <span className="flex-shrink-0 h-4 w-4 rounded-full bg-[var(--foreground)] flex items-center justify-center">
                            <Check className="h-2.5 w-2.5 text-[var(--background)]" />
                          </span>
                        ) : (
                          <span className="text-[var(--muted-foreground)] font-medium">{opt.letter})</span>
                        )}
                        <span className={isChosen ? "text-[var(--foreground)]" : "text-[var(--foreground)]"}>{opt.text}</span>
                      </span>
                      {!selectedChoice && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />}
                    </button>
                  );
                })}
              </div>
              {choiceBlock.contentAfter && (
                <div className={`mt-3 ${MD_STYLES}`}>
                  <ReactMarkdown>{choiceBlock.contentAfter}</ReactMarkdown>
                </div>
              )}
            </>
          ) : inboxSummary ? (
            <>
              {inboxSummary.contentBefore && (
                <div className={MD_STYLES}>
                  <ReactMarkdown>{inboxSummary.contentBefore}</ReactMarkdown>
                </div>
              )}
              <InboxSummaryCard data={inboxSummary.data} onAction={(msg) => onSendChoice?.(msg)} />
              {inboxSummary.contentAfter && (
                <div className={`mt-3 ${MD_STYLES}`}>
                  <ReactMarkdown>{inboxSummary.contentAfter}</ReactMarkdown>
                </div>
              )}
            </>
          ) : meetingDebrief ? (
            <>
              {meetingDebrief.contentBefore && (
                <div className={MD_STYLES}>
                  <ReactMarkdown>{meetingDebrief.contentBefore}</ReactMarkdown>
                </div>
              )}
              <MeetingDebriefCard data={meetingDebrief.data} onAction={(msg) => onSendChoice?.(msg)} />
              {meetingDebrief.contentAfter && (
                <div className={`mt-3 ${MD_STYLES}`}>
                  <ReactMarkdown>{meetingDebrief.contentAfter}</ReactMarkdown>
                </div>
              )}
            </>
          ) : whatsAppSummary ? (
            <>
              {whatsAppSummary.contentBefore && (
                <div className={MD_STYLES}>
                  <ReactMarkdown>{whatsAppSummary.contentBefore}</ReactMarkdown>
                </div>
              )}
              <WhatsAppSummaryCard data={whatsAppSummary.data} onAction={(msg) => onSendChoice?.(msg)} />
              {whatsAppSummary.contentAfter && (
                <div className={`mt-3 ${MD_STYLES}`}>
                  <ReactMarkdown>{whatsAppSummary.contentAfter}</ReactMarkdown>
                </div>
              )}
            </>
          ) : personIntel ? (
            <>
              {personIntel.contentBefore && (
                <div className={MD_STYLES}>
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                      ),
                    }}
                  >
                    {personIntel.contentBefore}
                  </ReactMarkdown>
                </div>
              )}
              <PersonIntelCard data={personIntel.data} onAction={(msg) => onSendChoice?.(msg)} />
              {personIntel.contentAfter && (
                <div className={`mt-3 ${MD_STYLES}`}>
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                      ),
                    }}
                  >
                    {personIntel.contentAfter}
                  </ReactMarkdown>
                </div>
              )}
            </>
          ) : followUp ? (
            <>
              {followUp.contentBefore && (
                <div className={MD_STYLES}>
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                      ),
                    }}
                  >
                    {followUp.contentBefore}
                  </ReactMarkdown>
                </div>
              )}
              <FollowUpSequence data={followUp.data} />
              {followUp.contentAfter && (
                <div className={`mt-3 ${MD_STYLES}`}>
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                      ),
                    }}
                  >
                    {followUp.contentAfter}
                  </ReactMarkdown>
                </div>
              )}
            </>
          ) : outreachTable ? (
            <>
              {outreachTable.contentBefore && (
                <div className={MD_STYLES}>
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                      ),
                    }}
                  >
                    {outreachTable.contentBefore}
                  </ReactMarkdown>
                </div>
              )}
              <OutreachTable data={outreachTable.data} />
              {outreachTable.contentAfter && (
                <div className={`mt-3 ${MD_STYLES}`}>
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                      ),
                    }}
                  >
                    {outreachTable.contentAfter}
                  </ReactMarkdown>
                </div>
              )}
            </>
          ) : emailDrafts ? (
            <>
              {emailDrafts.contentBefore && (
                <div className={MD_STYLES}>
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                      ),
                    }}
                  >
                    {emailDrafts.contentBefore}
                  </ReactMarkdown>
                </div>
              )}
              {emailDrafts.composer ? (
                <EmailComposer data={emailDrafts.composer} />
              ) : emailDrafts.legacyDrafts ? (
                emailDrafts.legacyDrafts.map((d, i) => (
                  <EmailDraftCard key={i} draft={d} index={i} />
                ))
              ) : null}
              {emailDrafts.contentAfter && (
                <div className={`mt-3 ${MD_STYLES}`}>
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                      ),
                    }}
                  >
                    {emailDrafts.contentAfter}
                  </ReactMarkdown>
                </div>
              )}
            </>
          ) : (
            <div className={MD_STYLES}>
              <ReactMarkdown
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                  ),
                }}
              >
                {cleanContent}
              </ReactMarkdown>
              <StreamCursor />
            </div>
          )}

          {/* Like / Dislike / Suggest */}
          {showActions && (
            <div className="flex items-center gap-1 mt-2">
              <button
                onClick={() => handleVote("up")}
                className={`p-1.5 rounded-md transition-colors ${
                  vote === "up"
                    ? "text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)]"
                }`}
                title="Good answer"
              >
                <ThumbsUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => handleVote("down")}
                className={`p-1.5 rounded-md transition-colors ${
                  vote === "down"
                    ? "text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)]"
                }`}
                title="Bad answer"
              >
                <ThumbsDown className="h-3.5 w-3.5" />
              </button>
              {sources && sources.length > 0 && (
                <button
                  onClick={() => setShowSuggest(!showSuggest)}
                  className="flex items-center gap-1 ml-2 px-2 py-1 rounded-md text-[0.7rem] text-[var(--muted-foreground)]/60 hover:text-[var(--muted-foreground)] transition-colors"
                  title="Suggest a missing tool"
                >
                  <Plus className="h-3 w-3" />
                  Suggest tool
                </button>
              )}
            </div>
          )}

          {/* Tool suggestion form */}
          {showSuggest && (
            <SuggestToolForm onClose={() => setShowSuggest(false)} />
          )}

          {/* Tool cards — collapsible */}
          {sources && sources.length > 0 && (
            <div className="mt-3">
              {!isStreaming && usedTool && (
                <div className="flex items-center gap-1.5 mb-2 text-[0.72rem] text-[var(--muted-foreground)]">
                  <Zap className="h-3 w-3 text-[var(--primary)]" />
                  <span>Answered using <span className="font-semibold text-[var(--foreground)]">{usedTool.display_name || usedTool.tool_name}</span></span>
                </div>
              )}
              <button
                onClick={() => setToolsCollapsed(!toolsCollapsed)}
                className="flex items-center gap-1.5 text-[0.7rem] font-medium text-[var(--muted-foreground)] uppercase tracking-widest mb-2.5 hover:text-[var(--foreground)] transition-colors"
              >
                {selectedToolId ? "Selected tool" : `${sources.length} tools available`}
                <ChevronDown className={`h-3 w-3 transition-transform ${toolsCollapsed ? "" : "rotate-180"}`} />
              </button>

              {!toolsCollapsed && (
                <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                  <div className="divide-y divide-[var(--border)]">
                    {(selectedToolId ? sources.filter((s) => s.tool_id === selectedToolId) : sources).map((s) => (
                      <SourceCard
                        key={s.tool_id}
                        result={s}
                        selected={selectedToolId === s.tool_id}
                        onSelect={handleToolSelect}
                      />
                    ))}
                  </div>
                  {selectedToolId && (
                    <button
                      className="w-full py-2 text-[0.7rem] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors border-t border-[var(--border)]"
                      onClick={() => setSelectedToolId(null)}
                    >
                      Show all tools
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Web sources — shown in "both" mode after tool cards */}
          {isBoth && webSources && webSources.length > 0 && !isStreaming && (
            <div className="mt-3">
              <div className="flex items-center gap-1.5 mb-2 text-[0.72rem] text-[var(--muted-foreground)]">
                <Globe className="h-3 w-3" />
                <span>{webSources.length} web sources</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {webSources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--card)] text-[0.7rem] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/20 transition-colors max-w-[200px] truncate"
                    title={s.title}
                  >
                    <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                    <span className="truncate">{s.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Job Agent View */}
          {hasJobAgent && (
            <JobAgentView
              screenshots={browserScreenshots || []}
              status={agentStatus || null}
              foundJobs={foundJobs || []}
              question={agentQuestion || null}
              isActive={jobAgentActive || false}
            />
          )}

          {/* Apple Action Cards */}
          {appleActions && appleActions.length > 0 && (
            <div className="mt-3 space-y-2">
              {appleActions.map((action, i) => (
                <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)]">
                  {action.type === "calendar" && <CalendarPlus className="h-4 w-4 text-blue-500 flex-shrink-0" />}
                  {action.type === "reminder" && <ListChecks className="h-4 w-4 text-orange-500 flex-shrink-0" />}
                  {action.type === "note" && <StickyNote className="h-4 w-4 text-yellow-600 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-[var(--foreground)]">
                      {action.type === "calendar" && (action.data.title || "Calendar event")}
                      {action.type === "reminder" && (action.data.name || "Reminder")}
                      {action.type === "note" && (action.data.title || "Note")}
                    </span>
                    {action.type === "calendar" && action.data.start && (
                      <span className="ml-2 text-[0.7rem] text-[var(--muted-foreground)]">{action.data.start}</span>
                    )}
                    {action.type === "reminder" && action.data.due_date && (
                      <span className="ml-2 text-[0.7rem] text-[var(--muted-foreground)]">Due: {action.data.due_date}</span>
                    )}
                  </div>
                  {action.status === "created" && (
                    <span className="flex items-center gap-1 text-[0.65rem] text-emerald-600 font-medium">
                      <Check className="h-3 w-3" /> Created
                    </span>
                  )}
                  {action.status === "pending" && (
                    <Loader2 className="h-3.5 w-3.5 text-[var(--muted-foreground)] animate-spin" />
                  )}
                  {action.status === "error" && (
                    <span className="text-[0.65rem] text-red-500 font-medium">Failed</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Routine Setup Card */}
          {routineSetup && (
            <div className="mt-3 flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)]">
              <Timer className="h-4 w-4 text-violet-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-[var(--foreground)]">{routineSetup.name}</span>
                <span className="ml-2 text-[0.7rem] text-[var(--muted-foreground)]">{routineSetup.schedule}</span>
              </div>
              {routineSetup.status === "activated" && (
                <span className="flex items-center gap-1 text-[0.65rem] text-emerald-600 font-medium">
                  <Check className="h-3 w-3" /> Activated
                </span>
              )}
              {routineSetup.status === "pending" && (
                <Loader2 className="h-3.5 w-3.5 text-[var(--muted-foreground)] animate-spin" />
              )}
              {routineSetup.status === "error" && (
                <span className="text-[0.65rem] text-red-500 font-medium">Failed</span>
              )}
            </div>
          )}

          {/* Artifact Download Card */}
          {artifact && (
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2.5">
                {artifact.artifact_type === "slides" ? (
                  <Presentation className="h-5 w-5 text-violet-500" />
                ) : (
                  <FileText className="h-5 w-5 text-blue-500" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[var(--foreground)] truncate">{artifact.title}</div>
                  <div className="text-[0.7rem] text-[var(--muted-foreground)]">
                    {artifact.artifact_type === "document" ? "Document" : artifact.artifact_type === "slides" ? `Presentation${artifact.slides_count ? ` (${artifact.slides_count} slides)` : ""}` : "Sheet"}
                    {" — "}
                    {artifact.files.length} file{artifact.files.length > 1 ? "s" : ""} generated
                  </div>
                </div>
              </div>
              <div className="px-4 py-2.5 flex flex-wrap gap-2">
                {artifact.files.map((file, i) => {
                  const downloadUrl = `${API_BASE}/v1/artifacts/${artifact.artifact_id}/${file.name}`;
                  const ext = file.name.split(".").pop()?.toUpperCase() || "FILE";
                  const sizeKB = Math.round(file.size / 1024);
                  const isHtml = file.type === "html";
                  return (
                    <a
                      key={i}
                      href={downloadUrl}
                      target={isHtml ? "_blank" : undefined}
                      download={isHtml ? undefined : file.name}
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors text-xs group"
                    >
                      {isHtml ? (
                        <ExternalLink className="h-3.5 w-3.5 text-[var(--muted-foreground)] group-hover:text-[var(--primary)]" />
                      ) : (
                        <Download className="h-3.5 w-3.5 text-[var(--muted-foreground)] group-hover:text-[var(--primary)]" />
                      )}
                      <span className="font-medium text-[var(--foreground)]">{ext}</span>
                      <span className="text-[var(--muted-foreground)]">{sizeKB}KB</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
