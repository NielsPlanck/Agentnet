"use client";

import { useState } from "react";
import type { SearchResultItem } from "@/lib/api";

function getFaviconUrl(baseUrl: string): string {
  try {
    const domain = new URL(baseUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return "";
  }
}

interface SourceCardProps {
  result: SearchResultItem;
  selected?: boolean;
  onSelect?: (result: SearchResultItem) => void;
}

export function SourceCard({ result, selected, onSelect }: SourceCardProps) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const faviconUrl = getFaviconUrl(result.base_url);
  const name = result.display_name || result.tool_name;
  const pct = Math.round((result.similarity ?? 0) * 100);
  const showFavicon = faviconUrl && !faviconFailed;

  return (
    <div
      onClick={() => onSelect?.(result)}
      className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
        selected ? "bg-[var(--muted)]" : "hover:bg-[var(--muted)]/50"
      }`}
    >
      {/* Favicon or name initial fallback */}
      <div className="flex-shrink-0 mt-0.5 h-6 w-6 rounded-md overflow-hidden flex items-center justify-center bg-[var(--muted)]">
        {showFavicon ? (
          <img
            src={faviconUrl}
            alt=""
            className="h-4 w-4"
            onError={() => setFaviconFailed(true)}
          />
        ) : (
          <span className="text-[0.6rem] font-semibold text-[var(--muted-foreground)] uppercase leading-none">
            {name.slice(0, 2)}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--foreground)] truncate">
            {name}
          </span>
          {pct > 0 && (
            <span className="flex-shrink-0 text-[0.65rem] font-semibold tabular-nums text-[var(--muted-foreground)] bg-[var(--muted)] rounded px-1.5 py-0.5">
              {pct}%
            </span>
          )}
        </div>
        {result.description && (
          <p className="text-[0.7rem] text-[var(--muted-foreground)] mt-0.5 line-clamp-2 leading-relaxed">
            {result.description}
          </p>
        )}
      </div>
    </div>
  );
}
