import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import { WebMCPProvider } from "@/components/webmcp-provider";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-geist-sans",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${outfit.variable} ${jetbrainsMono.variable} font-sans antialiased min-h-screen bg-[var(--background)] text-[var(--foreground)]`}
      >
        <WebMCPProvider />
        {children}
      </body>
    </html>
  );
}
