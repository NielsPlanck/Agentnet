"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { LogOut, ChevronDown, Settings, Clock } from "lucide-react";
import { useRouter } from "next/navigation";

interface UserMenuProps {
  onOpenHistory?: () => void;
}

export function UserMenu({ onOpenHistory }: UserMenuProps) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (!user) return null;

  const initials = user.display_name
    ? user.display_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email[0].toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-full hover:bg-[var(--muted)] transition-colors px-1.5 py-1"
      >
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt={user.display_name || user.email}
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <div className="h-7 w-7 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-semibold">
            {initials}
          </div>
        )}
        <ChevronDown className="h-3 w-3 text-[var(--muted-foreground)]" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg py-1 z-50">
          <div className="px-3 py-2 border-b border-[var(--border)]">
            <p className="text-sm font-medium text-[var(--foreground)] truncate">
              {user.display_name || "User"}
            </p>
            <p className="text-xs text-[var(--muted-foreground)] truncate">
              {user.email}
            </p>
          </div>
          {onOpenHistory && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenHistory();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Clock className="h-3.5 w-3.5" />
              History
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push("/settings");
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>
          <button
            type="button"
            onClick={async () => {
              setOpen(false);
              await logout();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
