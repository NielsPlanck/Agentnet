"use client";

import { useState } from "react";
import { X, Sparkles } from "lucide-react";

interface SignupPromptProps {
  onClose: () => void;
  onGoToSignup: () => void;
}

export function SignupPrompt({ onClose, onGoToSignup }: SignupPromptProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative w-full max-w-sm mx-4 bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl p-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center text-center gap-4">
          <div className="h-12 w-12 rounded-full bg-indigo-500/10 flex items-center justify-center">
            <Sparkles className="h-6 w-6 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--foreground)] mb-1">
              Save your conversations
            </h3>
            <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
              Create a free account to save your chat history, track follow-ups,
              and keep your data private and secure.
            </p>
          </div>
          <div className="flex flex-col w-full gap-2 mt-2">
            <button
              type="button"
              onClick={onGoToSignup}
              className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path fill="white" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="white" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="white" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="white" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Sign in with Google
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-sm transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
