"use client";

import { useEffect } from "react";

/**
 * WebMCP Provider — registers AgentNet's capabilities as browser-accessible tools
 * via the navigator.modelContext API (W3C WebMCP proposal).
 *
 * This allows browser agents (Copilot, Gemini, etc.) to discover and use
 * AgentNet's search and tool discovery capabilities directly.
 */

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (params: Record<string, unknown>, agent: unknown) => unknown;
}

interface ModelContext {
  registerTool: (tool: ModelContextTool) => void;
  unregisterTool: (name: string) => void;
}

declare global {
  interface Navigator {
    modelContext?: ModelContext;
  }
}

export function WebMCPProvider() {
  useEffect(() => {
    const mc = navigator.modelContext;
    if (!mc) return;

    // Tool 1: Search for tools/services
    mc.registerTool({
      name: "search-tools",
      description:
        "Search AgentNet's index of MCP tools, APIs, and web services. " +
        "Returns ranked results with tool names, descriptions, and workflows.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language description of what you want to do",
          },
          transport: {
            type: "string",
            description: "Filter by transport type: mcp, rest, or webmcp",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 10)",
          },
        },
        required: ["query"],
      },
      execute: async (params) => {
        const res = await fetch("/api/v1/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: params.query,
            transport: params.transport || null,
            limit: params.limit || 10,
          }),
        });
        const data = await res.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data.results, null, 2),
            },
          ],
        };
      },
    });

    // Tool 2: Ask AgentNet (chat with tool context)
    mc.registerTool({
      name: "ask-agentnet",
      description:
        "Ask AgentNet a question about tools, services, or how to accomplish a task. " +
        "Returns a conversational response with relevant tool recommendations.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Your question or task description",
          },
        },
        required: ["query"],
      },
      execute: async (params) => {
        const res = await fetch("/api/v1/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: params.query }),
        });
        const data = await res.json();
        return {
          content: [
            {
              type: "text",
              text: data.answer,
            },
          ],
        };
      },
    });

    // Tool 3: Scan a website for WebMCP tools
    mc.registerTool({
      name: "scan-webmcp",
      description:
        "Scan a website URL to detect if it exposes WebMCP tools " +
        "(client-side JavaScript tools for AI agents). " +
        "If found, the tools are indexed in AgentNet.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The website URL to scan for WebMCP tools",
          },
        },
        required: ["url"],
      },
      execute: async (params) => {
        const res = await fetch("/api/v1/webmcp/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: params.url }),
        });
        const data = await res.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      },
    });

    // Tool 4: List WebMCP tools in the index
    mc.registerTool({
      name: "list-webmcp-tools",
      description:
        "List all WebMCP-enabled websites indexed by AgentNet. " +
        "Shows websites that expose client-side tools for AI agents.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        const res = await fetch("/api/v1/webmcp/tools");
        const data = await res.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      },
    });

    return () => {
      mc.unregisterTool("search-tools");
      mc.unregisterTool("ask-agentnet");
      mc.unregisterTool("scan-webmcp");
      mc.unregisterTool("list-webmcp-tools");
    };
  }, []);

  return null;
}
