"use client";

import { useState, useEffect, useRef } from "react";
import {
  Bot,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Monitor,
  Briefcase,
  MapPin,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────

interface BrowserScreenshot {
  image: string; // base64 JPEG
  url: string;
  action: string;
}

interface AgentStatusData {
  phase: string;
  message: string;
  step?: number;
  action?: string;
  jobs_found?: number;
}

interface FoundJob {
  title: string;
  company: string;
  url: string;
  description?: string;
}

interface AgentQuestion {
  question: string;
  reason: string;
}

export interface JobAgentViewProps {
  screenshots: BrowserScreenshot[];
  status: AgentStatusData | null;
  foundJobs: FoundJob[];
  question: AgentQuestion | null;
  isActive: boolean;
}

// ── Component ────────────────────────────────────────────────────────

export function JobAgentView({
  screenshots,
  status,
  foundJobs,
  question,
  isActive,
}: JobAgentViewProps) {
  const [expanded, setExpanded] = useState(true);
  const [showScreenshot, setShowScreenshot] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  const latestScreenshot = screenshots.length > 0 ? screenshots[screenshots.length - 1] : null;
  const phase = status?.phase || "starting";
  const isDone = phase === "done" || phase === "error";

  // Auto-scroll action log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [screenshots.length]);

  return (
    <div className="w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-lg overflow-hidden my-3">
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border)] cursor-pointer hover:bg-[var(--muted)] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="relative">
          <Bot className="h-5 w-5 text-indigo-500" />
          {isActive && !isDone && (
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
          )}
        </div>
        <span className="text-sm font-semibold text-[var(--foreground)] flex-1">
          Job Application Agent
        </span>
        <span className={`text-[0.65rem] font-medium px-2 py-0.5 rounded-full ${
          isDone
            ? phase === "error"
              ? "bg-red-500/10 text-red-500"
              : "bg-green-500/10 text-green-500"
            : "bg-indigo-500/10 text-indigo-500"
        }`}>
          {isDone ? (phase === "error" ? "Error" : "Complete") : "Active"}
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 text-[var(--muted-foreground)]" /> : <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />}
      </div>

      {expanded && (
        <div className="flex flex-col">
          {/* Browser screenshot */}
          {latestScreenshot && (
            <div className="border-b border-[var(--border)]">
              <button
                type="button"
                onClick={() => setShowScreenshot(!showScreenshot)}
                className="flex items-center gap-2 px-4 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors w-full text-left"
              >
                <Monitor className="h-3 w-3" />
                <span className="flex-1 truncate">
                  {latestScreenshot.url}
                </span>
                {showScreenshot ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showScreenshot && (
                <div className="px-3 pb-3">
                  <div className="rounded-lg overflow-hidden border border-[var(--border)] bg-black">
                    <img
                      src={`data:image/jpeg;base64,${latestScreenshot.image}`}
                      alt="Browser view"
                      className="w-full h-auto"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Status message */}
          {status && (
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
              {isActive && !isDone ? (
                <Loader2 className="h-3.5 w-3.5 text-indigo-500 animate-spin shrink-0" />
              ) : isDone && phase !== "error" ? (
                <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
              ) : phase === "error" ? (
                <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
              ) : null}
              <span className="text-xs text-[var(--foreground)]">
                {status.message}
              </span>
              {status.step && (
                <span className="text-[0.6rem] text-[var(--muted-foreground)] ml-auto">
                  Step {status.step}
                </span>
              )}
            </div>
          )}

          {/* Action log */}
          {screenshots.length > 1 && (
            <div className="max-h-32 overflow-y-auto border-b border-[var(--border)]">
              <div className="px-4 py-2">
                <span className="text-[0.6rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  Action Log
                </span>
              </div>
              <div className="px-4 pb-2 space-y-1">
                {screenshots.slice(-10).map((s, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle className="h-3 w-3 text-green-500/50 mt-0.5 shrink-0" />
                    <span className="text-[0.65rem] text-[var(--muted-foreground)] leading-tight">
                      {s.action}
                    </span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {/* Found jobs */}
          {foundJobs.length > 0 && (
            <div className="border-b border-[var(--border)]">
              <div className="px-4 py-2">
                <span className="text-[0.6rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  Found Jobs ({foundJobs.length})
                </span>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {foundJobs.map((job, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <Briefcase className="h-4 w-4 text-indigo-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--foreground)] truncate">
                        {job.title}
                      </div>
                      <div className="text-xs text-[var(--muted-foreground)] truncate">
                        {job.company}
                        {job.description && ` — ${job.description}`}
                      </div>
                    </div>
                    {job.url && (
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-500 hover:text-indigo-400 transition-colors shrink-0"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agent question */}
          {question && (
            <div className="px-4 py-3 bg-amber-500/5 border-b border-amber-500/20">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-[var(--foreground)]">{question.question}</p>
                  {question.reason && (
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">{question.reason}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Done summary */}
          {isDone && phase !== "error" && (
            <div className="px-4 py-3 bg-green-500/5">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle className="h-4 w-4" />
                <span>
                  {status?.jobs_found
                    ? `Found ${status.jobs_found} job${status.jobs_found > 1 ? "s" : ""}`
                    : "Agent complete"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
