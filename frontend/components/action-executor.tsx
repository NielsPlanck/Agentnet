"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WorkflowStep } from "@/lib/api";
import { executeAction, type ExecuteResult } from "@/lib/connections";
import { Play, Loader2, CheckCircle, XCircle, Mail, Tag } from "lucide-react";

interface ActionExecutorProps {
  step: WorkflowStep;
  connected: boolean;
}

export function ActionExecutor({ step, connected }: ActionExecutorProps) {
  const [expanded, setExpanded] = useState(false);
  const [params, setParams] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  const schema = step.input_schema;
  const fields = schema?.properties ? Object.entries(schema.properties) : [];
  const requiredFields = schema?.required || [];

  const canRun = connected && requiredFields.every((f) => params[f]?.trim());

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    const res = await executeAction(step.action_id, params);
    setResult(res);
    setRunning(false);
  };

  if (!connected) return null;

  return (
    <div className="mt-1.5">
      {/* Run button / toggle */}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-[0.7rem] text-[var(--primary)] hover:bg-[var(--primary)]/10 gap-1"
        onClick={() => {
          if (fields.length > 0) {
            setExpanded(!expanded);
          } else {
            handleRun();
          }
        }}
        disabled={running}
      >
        {running ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Play className="h-3 w-3" />
        )}
        {fields.length > 0 ? (expanded ? "Close" : "Run") : "Run"}
      </Button>

      {/* Input form */}
      {expanded && fields.length > 0 && (
        <div className="mt-2 space-y-2 pl-1">
          {fields.map(([name, prop]) => (
            <div key={name}>
              <label className="text-[0.65rem] text-[var(--muted-foreground)] uppercase tracking-wide">
                {prop.description || name}
                {requiredFields.includes(name) && (
                  <span className="text-destructive ml-0.5">*</span>
                )}
              </label>
              <Input
                className="h-8 text-sm bg-[var(--card)] border-[var(--border)] text-[var(--foreground)] mt-0.5"
                placeholder={name}
                value={params[name] || ""}
                onChange={(e) =>
                  setParams((p) => ({ ...p, [name]: e.target.value }))
                }
              />
            </div>
          ))}
          <Button
            size="sm"
            className="h-7 px-3 text-xs bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 gap-1"
            onClick={handleRun}
            disabled={!canRun || running}
          >
            {running ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            Execute
          </Button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--card)] p-3">
          {result.success ? (
            <div>
              <div className="flex items-center gap-1 text-[var(--primary)] text-xs font-medium mb-2">
                <CheckCircle className="h-3.5 w-3.5" />
                Success
              </div>
              <ResultView data={result.data} actionName={step.action_name} />
            </div>
          ) : (
            <div className="flex items-center gap-1 text-destructive text-xs">
              <XCircle className="h-3.5 w-3.5" />
              {result.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultView({
  data,
  actionName,
}: {
  data: ExecuteResult["data"];
  actionName: string;
}) {
  if (!data) return <span className="text-[var(--muted-foreground)] text-xs">No data</span>;

  // Email results
  if (actionName === "search_emails" && Array.isArray(data)) {
    return (
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {(data as Record<string, unknown>[]).map((email) => (
          <div
            key={email.id as string}
            className="border border-[var(--border)] rounded-md p-2"
          >
            <div className="flex items-center gap-1 text-xs text-[var(--foreground)] font-medium">
              <Mail className="h-3 w-3 text-[var(--primary)]" />
              {email.subject as string}
            </div>
            <div className="text-[0.7rem] text-[var(--muted-foreground)] mt-0.5">
              {email.from as string} — {email.date as string}
            </div>
            <div className="text-xs text-[var(--muted-foreground)] mt-1">
              {email.snippet as string}
            </div>
          </div>
        ))}
        {data.length === 0 && (
          <span className="text-[var(--muted-foreground)] text-xs">No emails found</span>
        )}
      </div>
    );
  }

  // Label results
  if (actionName === "list_labels" && Array.isArray(data)) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {(data as Record<string, unknown>[]).map((label) => (
          <span
            key={label.id as string}
            className="inline-flex items-center gap-1 text-xs bg-[var(--muted)] text-[var(--foreground)] rounded-md px-2 py-0.5"
          >
            <Tag className="h-3 w-3 text-[var(--primary)]" />
            {label.name as string}
          </span>
        ))}
      </div>
    );
  }

  // Send email result
  if (actionName === "send_email") {
    const d = data as Record<string, unknown>;
    return (
      <div className="text-xs text-[var(--primary)]">
        Email sent! ID: {d.id as string}
      </div>
    );
  }

  // Generic JSON
  return (
    <pre className="text-xs text-[var(--muted-foreground)] overflow-x-auto max-h-40">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
