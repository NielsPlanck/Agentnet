"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface VoiceWaveProps {
  active: boolean;
  className?: string;
  barCount?: number;
  color?: string;
}

/**
 * Animated voice waveform — shows oscillating bars when active.
 */
export function VoiceWave({
  active,
  className,
  barCount = 5,
  color = "rgb(239, 68, 68)",
}: VoiceWaveProps) {
  const barsRef = useRef<HTMLDivElement>(null);

  // Randomized CSS animation for each bar
  useEffect(() => {
    if (!barsRef.current) return;
    const bars = barsRef.current.querySelectorAll<HTMLDivElement>("[data-bar]");
    bars.forEach((bar, i) => {
      const delay = (i * 0.12).toFixed(2);
      const duration = (0.4 + Math.random() * 0.3).toFixed(2);
      bar.style.animationDelay = `${delay}s`;
      bar.style.animationDuration = `${duration}s`;
    });
  }, [barCount]);

  return (
    <div
      ref={barsRef}
      className={cn(
        "flex items-center justify-center gap-[3px]",
        className
      )}
    >
      {Array.from({ length: barCount }, (_, i) => (
        <div
          key={i}
          data-bar
          className={cn(
            "rounded-full transition-all",
            active ? "voice-bar-active" : "voice-bar-idle"
          )}
          style={{
            width: "3px",
            backgroundColor: color,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Full recording indicator — shown inside the search bar when recording.
 * Shows pulsing waveform + status text + stop button.
 */
interface RecordingIndicatorProps {
  isRecording: boolean;
  onStop: () => void;
  status?: "connecting" | "listening" | "error" | "idle";
}

export function RecordingIndicator({ isRecording, onStop, status = "listening" }: RecordingIndicatorProps) {
  if (!isRecording && status !== "connecting") return null;

  const isConnecting = status === "connecting";

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 animate-in fade-in slide-in-from-top-2 duration-200">
      {/* Pulsing red dot */}
      <div className="relative flex h-3 w-3 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-50" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
      </div>

      {/* Voice wave */}
      <VoiceWave active={!isConnecting} barCount={7} className="h-6" />

      {/* Label */}
      <span className="text-xs font-medium text-red-500 flex-1">
        {isConnecting ? "Connecting..." : "Listening..."}
      </span>

      {/* Stop button */}
      <button
        type="button"
        onClick={onStop}
        className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
      >
        Stop
      </button>
    </div>
  );
}
