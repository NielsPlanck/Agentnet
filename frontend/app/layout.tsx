import type { Metadata } from "next";
import { Outfit, Inter, JetBrains_Mono } from "next/font/google";
import { WebMCPProvider } from "@/components/webmcp-provider";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgentNet — Find the best agent for any task",
  description:
    "Agent Capability Search Engine — Google for AI agents. Discover tools, APIs, and MCP servers.",
};

// Inline script to prevent flash of wrong theme on load
const themeScript = `(function(){try{var m=localStorage.getItem("agentnet_color_mode");var isDark=m==="dark"||(!m)||(m==="auto"&&window.matchMedia("(prefers-color-scheme:dark)").matches);if(isDark)document.documentElement.classList.add("dark");else document.documentElement.classList.remove("dark");var f=localStorage.getItem("agentnet_chat_font");if(f)document.body.setAttribute("data-chat-font",f);var s=localStorage.getItem("agentnet_front_style");if(s)document.body.setAttribute("data-front-style",s);}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        suppressHydrationWarning
        className={`${outfit.variable} ${inter.variable} ${jetbrainsMono.variable} font-sans antialiased min-h-screen bg-[var(--background)] text-[var(--foreground)]`}
      >
        <AuthProvider>
          <ThemeProvider>
            <WebMCPProvider />
            {children}
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
