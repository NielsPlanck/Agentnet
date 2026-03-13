"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth";

export type ColorMode = "light" | "auto" | "dark";
export type ChatFont = "default" | "sans" | "system" | "dyslexic";
export type FrontStyle = "claude" | "chatgpt";

interface ThemeContextValue {
  colorMode: ColorMode;
  chatFont: ChatFont;
  frontStyle: FrontStyle;
  setColorMode: (mode: ColorMode) => void;
  setChatFont: (font: ChatFont) => void;
  setFrontStyle: (style: FrontStyle) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemDark(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyDarkClass(colorMode: ColorMode) {
  if (typeof document === "undefined") return;
  const isDark = colorMode === "dark" || (colorMode === "auto" && getSystemDark());
  document.documentElement.classList.toggle("dark", isDark);
}

function applyChatFont(font: ChatFont) {
  if (typeof document === "undefined") return;
  document.body.setAttribute("data-chat-font", font);
}

function applyFrontStyle(style: FrontStyle) {
  if (typeof document === "undefined") return;
  document.body.setAttribute("data-front-style", style);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [colorMode, setColorModeState] = useState<ColorMode>("dark");
  const [chatFont, setChatFontState] = useState<ChatFont>("default");
  const [frontStyle, setFrontStyleState] = useState<FrontStyle>("claude");
  const [initialized, setInitialized] = useState(false);

  // Initialize from localStorage
  useEffect(() => {
    const savedMode = localStorage.getItem("agentnet_color_mode") as ColorMode | null;
    const savedFont = localStorage.getItem("agentnet_chat_font") as ChatFont | null;
    const savedStyle = localStorage.getItem("agentnet_front_style") as FrontStyle | null;
    if (savedMode) setColorModeState(savedMode);
    if (savedFont) setChatFontState(savedFont);
    if (savedStyle) setFrontStyleState(savedStyle);
    setInitialized(true);
  }, []);

  // Apply theme changes to DOM
  useEffect(() => {
    if (!initialized) return;
    applyDarkClass(colorMode);
    applyChatFont(chatFont);
    applyFrontStyle(frontStyle);
  }, [colorMode, chatFont, frontStyle, initialized]);

  // Listen for system theme changes when in auto mode
  useEffect(() => {
    if (colorMode !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyDarkClass("auto");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [colorMode]);

  // Sync from backend when user logs in
  useEffect(() => {
    if (!user) return;
    fetch("/v1/settings/preferences", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((prefs) => {
        if (!prefs) return;
        if (prefs.color_mode) {
          setColorModeState(prefs.color_mode as ColorMode);
          localStorage.setItem("agentnet_color_mode", prefs.color_mode);
        }
        if (prefs.chat_font) {
          setChatFontState(prefs.chat_font as ChatFont);
          localStorage.setItem("agentnet_chat_font", prefs.chat_font);
        }
        if (prefs.front_style) {
          setFrontStyleState(prefs.front_style as FrontStyle);
          localStorage.setItem("agentnet_front_style", prefs.front_style);
        }
      })
      .catch(() => {});
  }, [user]);

  const setColorMode = useCallback(
    (mode: ColorMode) => {
      setColorModeState(mode);
      localStorage.setItem("agentnet_color_mode", mode);
      // Sync to backend if logged in
      if (user) {
        fetch("/v1/settings/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ color_mode: mode }),
        }).catch(() => {});
      }
    },
    [user]
  );

  const setChatFont = useCallback(
    (font: ChatFont) => {
      setChatFontState(font);
      localStorage.setItem("agentnet_chat_font", font);
      if (user) {
        fetch("/v1/settings/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ chat_font: font }),
        }).catch(() => {});
      }
    },
    [user]
  );

  const setFrontStyle = useCallback(
    (style: FrontStyle) => {
      setFrontStyleState(style);
      localStorage.setItem("agentnet_front_style", style);
      if (user) {
        fetch("/v1/settings/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ front_style: style }),
        }).catch(() => {});
      }
    },
    [user]
  );

  return (
    <ThemeContext value={{ colorMode, chatFont, frontStyle, setColorMode, setChatFont, setFrontStyle }}>
      {children}
    </ThemeContext>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
