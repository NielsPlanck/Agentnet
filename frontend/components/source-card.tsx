"use client";

import { useState } from "react";
import type { SearchResultItem } from "@/lib/api";

function getFaviconUrl(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    // Use the site's own favicon directly — avoids Google's generic globe fallback
    return `${u.origin}/favicon.ico`;
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
  // Show tool_name as subtitle only if different from display_name, otherwise show description
  const nameLower = name.toLowerCase().replace(/[\s\-_.\/]/g, "");
  const toolLower = result.tool_name.toLowerCase().replace(/[\s\-_.\/]/g, "");
  const subtitle = nameLower !== toolLower ? result.tool_name : (result.description || "");

  return (
    <div
      onClick={() => onSelect?.(result)}
      className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
        selected ? "bg-[var(--muted)]" : "hover:bg-[var(--muted)]/50"
      }`}
    >
      {/* Favicon from site — hidden entirely if unavailable */}
      {showFavicon && (
        <div className="flex-shrink-0 mt-0.5 h-6 w-6 rounded-md overflow-hidden flex items-center justify-center">
          <img
            src={faviconUrl}
            alt=""
            className="h-5 w-5 rounded-sm"
            onError={() => setFaviconFailed(true)}
          />
        </div>
      )}

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
        {subtitle && (
          <p className="text-[0.7rem] text-[var(--muted-foreground)] mt-0.5 line-clamp-1 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
