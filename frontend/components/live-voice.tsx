"use client";

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";

type VoiceState = "connecting" | "listening" | "speaking" | "error";

export interface LiveVoiceHandle {
  sendText: (text: string) => void;
}

interface LiveVoiceProps {
  onTranscript: (text: string) => void;
  onStateChange: (state: VoiceState) => void;
  onClose: () => void;
}

/** Strip AgentNet formatting tags so Gemini can speak plain text. */
function cleanForSpeech(text: string): string {
  return text
    .replace(/\[TOOL:#\d+\]/g, "")
    .replace(/\[RESULTS\][\s\S]*?\[\/RESULTS\]/g, "I found some results for you — check the screen for details.")
    .replace(/\[TABLE\][\s\S]*?\[\/TABLE\]/g, "I put together a table of results on screen for you.")
    .replace(/\[STEP_FORM\][\s\S]*?\[\/STEP_FORM\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/#+\s/g, "")
    .trim();
}

export const LiveVoice = forwardRef<LiveVoiceHandle, LiveVoiceProps>(
  function LiveVoice({ onTranscript, onStateChange, onClose }, ref) {
    const wsRef = useRef<WebSocket | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const playQueueRef = useRef<AudioBuffer[]>([]);
    const isPlayingRef = useRef(false);
    const userTranscriptRef = useRef("");

    const playNext = useCallback((ctx: AudioContext) => {
      if (playQueueRef.current.length === 0) {
        isPlayingRef.current = false;
        onStateChange("listening");
        return;
      }
      isPlayingRef.current = true;
      onStateChange("speaking");
      const buf = playQueueRef.current.shift()!;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => playNext(ctx);
      src.start();
    }, [onStateChange]);

    const enqueueAudio = useCallback((bytes: ArrayBuffer) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const int16 = new Int16Array(bytes);
      const f32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
      const buf = ctx.createBuffer(1, f32.length, 24000);
      buf.copyToChannel(f32, 0);
      playQueueRef.current.push(buf);
      if (!isPlayingRef.current) playNext(ctx);
    }, [playNext]);

    const stop = useCallback(() => {
      processorRef.current?.disconnect();
      processorRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
      playQueueRef.current = [];
      isPlayingRef.current = false;
    }, []);

    // Expose sendText so page.tsx can feed AgentNet responses back to Gemini
    useImperativeHandle(ref, () => ({
      sendText(text: string) {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const clean = cleanForSpeech(text);
        if (!clean) return;
        ws.send(JSON.stringify({ type: "text", content: clean }));
      },
    }), []);

    useEffect(() => {
      let mounted = true;

      async function start() {
        onStateChange("connecting");

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          if (mounted) onClose();
          return;
        }
        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;

        const ws = new WebSocket("ws://localhost:8000/v1/live");
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mounted) return;
          const captureCtx = new AudioContext({ sampleRate: 16000 });
          audioCtxRef.current = captureCtx;

          const src = captureCtx.createMediaStreamSource(stream);
          const proc = captureCtx.createScriptProcessor(4096, 1, 1);
          processorRef.current = proc;

          proc.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const f32 = e.inputBuffer.getChannelData(0);
            const i16 = new Int16Array(f32.length);
            for (let i = 0; i < f32.length; i++) {
              i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
            }
            ws.send(i16.buffer);
          };

          src.connect(proc);
          proc.connect(captureCtx.destination);
          onStateChange("listening");
        };

        ws.onmessage = async (evt) => {
          if (!mounted) return;
          if (evt.data instanceof Blob) {
            const buf = await evt.data.arrayBuffer();
            enqueueAudio(buf);
          } else {
            try {
              const msg = JSON.parse(evt.data as string);
              if (msg.type === "transcript" && msg.role === "user") {
                userTranscriptRef.current += msg.text;
              }
              if (msg.type === "turn_complete") {
                const text = userTranscriptRef.current.trim();
                userTranscriptRef.current = "";
                if (text) onTranscript(text);
              }
            } catch { /* ignore */ }
          }
        };

        ws.onerror = () => { if (mounted) onClose(); };
        ws.onclose = () => { if (mounted) onClose(); };
      }

      start();
      return () => {
        mounted = false;
        stop();
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return null;
  }
);
