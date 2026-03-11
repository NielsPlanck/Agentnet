"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { SearchResultItem, WebSource, ChatMessage as ChatMsg } from "@/lib/api";
import { sendFeedback, suggestTool, streamAsk } from "@/lib/api";
import { SourceCard } from "@/components/source-card";
import { ChevronRight, ChevronDown, ThumbsUp, ThumbsDown, Plus, X, Check, Calendar, Clock, Minus, Zap, ExternalLink, Globe, Loader2 } from "lucide-react";

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

function DataTable({ block, onAction, fetchMoreContext }: {
  block: TableBlock;
  onAction: (msg: string) => void;
  fetchMoreContext?: { history: ChatMsg[]; mode: string };
}) {
  const [allRows, setAllRows] = useState<(string | number | null)[][]>(block.rows);
  const [allColumns, setAllColumns] = useState<string[]>(block.columns);
  const [selected, setSelected] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const handleRowClick = (row: (string | number | null)[], ri: number) => {
    setSelected(ri);
    const label = allColumns.map((col, i) => `${col}: ${row[i] ?? "—"}`).join(" · ");
    onAction(`Tell me more about this: ${label}`);
  };

  const handleLoadMore = async () => {
    if (!fetchMoreContext || loadingMore) return;
    setLoadingMore(true);
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
    }
  };

  const handleEnrich = async () => {
    if (!fetchMoreContext || loadingMore) return;
    setLoadingMore(true);
    try {
      const prompt = `Enrich this list — keep all ${allRows.length} rows but add extra columns (founder name, LinkedIn URL, contact email where possible). Return an updated [TABLE] block with ALL rows and the new columns.`;
      let fullText = "";
      for await (const m of streamAsk(prompt, fetchMoreContext.history, undefined, "agentnet")) {
        if (m.type === "token") fullText += m.content;
      }
      const match = fullText.match(/\[TABLE\]([\s\S]*?)\[\/TABLE\]/);
      if (match) {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.columns?.length && parsed.rows?.length) {
          setAllColumns(parsed.columns);
          setAllRows(parsed.rows);
        }
      }
    } catch { /* ignore */ } finally {
      setLoadingMore(false);
    }
  };

  const exportCsv = () => {
    const header = allColumns.join(",");
    const rows = allRows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([header + "\n" + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "list.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-3">
      {/* Header row: intro + count */}
      <div className="flex items-center justify-between mb-2">
        {block.intro && (
          <p className="text-sm text-[var(--muted-foreground)]">{block.intro}</p>
        )}
        <span className="text-[0.65rem] text-[var(--muted-foreground)] ml-auto">
          {allRows.length} results
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50">
                <th className="px-3 py-2 text-left font-medium text-[var(--muted-foreground)] w-8">#</th>
                {allColumns.map((col, i) => (
                  <th key={i} className="px-3 py-2 text-left font-medium text-[var(--muted-foreground)] uppercase tracking-wide text-[0.6rem] whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allRows.map((row, ri) => (
                <tr
                  key={ri}
                  onClick={() => handleRowClick(row, ri)}
                  className={`border-b border-[var(--border)] last:border-0 cursor-pointer transition-colors ${
                    selected === ri ? "bg-[var(--muted)]" : "hover:bg-[var(--muted)]/40"
                  }`}
                >
                  <td className="px-3 py-2.5 text-[var(--muted-foreground)] tabular-nums select-text">{ri + 1}</td>
                  {row.map((cell, ci) => (
                    <td key={ci} className={`px-3 py-2.5 whitespace-nowrap select-text ${ci === 0 ? "font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
                      {renderCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        <button
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="flex items-center gap-1.5 text-[0.72rem] font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] transition-colors text-[var(--foreground)] disabled:opacity-50"
        >
          {loadingMore ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          + Load more
        </button>
        <button
          onClick={handleEnrich}
          disabled={loadingMore}
          className="flex items-center gap-1.5 text-[0.72rem] font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] transition-colors text-[var(--foreground)] disabled:opacity-50"
        >
          {loadingMore ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Enrich data
        </button>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 text-[0.72rem] font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] transition-colors text-[var(--foreground)]"
        >
          Export CSV
        </button>
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

      {block.caption && (
        <p className="text-[0.65rem] text-[var(--muted-foreground)] mt-1.5">{block.caption}</p>
      )}
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

interface MessageImage {
  base64: string;
  mimeType: string;
  preview: string;
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  sources?: SearchResultItem[];
  usedTool?: SearchResultItem;
  images?: MessageImage[];
  webSources?: WebSource[];
  mode?: "agentnet" | "web" | "both";
  isStreaming?: boolean;
  onSendChoice?: (choiceText: string) => void;
  fetchMoreContext?: { history: ChatMsg[]; mode: string };
}

const MD_STYLES = [
  "text-[0.95rem] leading-relaxed text-[var(--foreground)]",
  "prose prose-sm max-w-none",
  "prose-strong:text-[var(--foreground)] prose-strong:font-semibold",
  "prose-code:bg-[var(--muted)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-sm prose-code:font-mono",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-headings:text-[var(--foreground)]",
  "prose-h3:text-base prose-h3:font-semibold prose-h3:mt-4 prose-h3:mb-1",
  "prose-li:ml-0 prose-ul:my-2 prose-ol:my-2",
  "prose-p:mb-2 prose-p:mt-0",
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

export function ChatMessage({ role, content, sources, usedTool, images, webSources, mode, isStreaming, onSendChoice, fetchMoreContext }: ChatMessageProps) {
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
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[var(--primary)] text-[var(--primary-foreground)] px-4 py-2.5 text-[0.95rem] leading-relaxed">
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
          {content}
        </div>
      </div>
    );
  }

  const isWeb = mode === "web";
  const isBoth = mode === "both";
  // Strip [TOOL:#N] metadata tag before any parsing or rendering
  const cleanContent = stripToolTag(content);
  const stepForm = !isStreaming && !isWeb && cleanContent ? parseStepForm(cleanContent) : null;
  const tableBlock = !isStreaming && !isWeb && !stepForm && cleanContent ? parseTableBlock(cleanContent) : null;
  const resultsBlock = !isStreaming && !isWeb && !stepForm && !tableBlock && cleanContent ? parseResultsBlock(cleanContent) : null;
  const choiceBlock = !isStreaming && !isWeb && !stepForm && !tableBlock && !resultsBlock && cleanContent ? parseChoiceOptions(cleanContent) : null;
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
      <div className="flex items-start gap-3">
        {/* Iris avatar */}
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white border border-neutral-200 flex items-center justify-center mt-0.5 overflow-hidden">
          <img src="/iris-logo.png" alt="Iris" className="w-5 h-5 object-contain" />
        </div>

        <div className="flex-1 min-w-0 pt-0.5">
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
                      className={`w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-left text-sm transition-all ${
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

        </div>
      </div>
    </div>
  );
}
