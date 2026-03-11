import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";
const AGENTNET_URL = process.env.AGENTNET_URL ?? "http://localhost:8000";
const widgetHtml = readFileSync(new URL("./public/agentnet-widget.html", import.meta.url), "utf8");

const searchInputSchema = {
  query: z.string().min(1),
  limit: z.number().int().min(1).max(12).optional(),
};

const askInputSchema = {
  query: z.string().min(1),
};

function widgetMeta() {
  return {
    _meta: {
      ui: {
        resourceUri: "ui://widget/agentnet.html",
      },
    },
  };
}

function mapSearchResult(item) {
  return {
    name: item.display_name || item.tool_name || "Unknown tool",
    description: item.description || "",
    transport: item.transport || "",
    url: item.base_url || item.page_url || "",
    score: Math.round((item.similarity || 0) * 100),
    status: item.status || "",
  };
}

async function searchAgentNet(query, limit = 6) {
  const response = await fetch(`${AGENTNET_URL}/v1/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent: query, limit }),
  });

  if (!response.ok) {
    throw new Error(`AgentNet search failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.results) ? data.results : [];
}

async function askAgentNet(query) {
  const response = await fetch(`${AGENTNET_URL}/v1/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, history: [] }),
  });

  if (!response.ok) {
    throw new Error(`AgentNet ask failed with HTTP ${response.status}`);
  }

  return response.json();
}

function createAppServer() {
  const server = new McpServer({
    name: "agentnet-app",
    version: "0.1.0",
  });

  registerAppResource(
    server,
    "agentnet-widget",
    "ui://widget/agentnet.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://widget/agentnet.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
        },
      ],
    })
  );

  registerAppTool(
    server,
    "search_agents",
    {
      title: "Search AgentNet",
      description: "Search AgentNet for AI agents, MCP servers, APIs, and connectors that can perform a task.",
      inputSchema: searchInputSchema,
      ...widgetMeta(),
    },
    async (args) => {
      const query = args?.query?.trim?.() ?? "";
      const limit = args?.limit ?? 6;

      if (!query) {
        return {
          content: [{ type: "text", text: "Missing query." }],
          structuredContent: {
            view: "search",
            query,
            results: [],
          },
          ...widgetMeta(),
        };
      }

      const results = (await searchAgentNet(query, limit)).map(mapSearchResult);
      const summary =
        results.length === 0
          ? `No AgentNet matches found for "${query}".`
          : `Found ${results.length} AgentNet matches for "${query}".`;

      return {
        content: [{ type: "text", text: summary }],
        structuredContent: {
          view: "search",
          query,
          results,
        },
        ...widgetMeta(),
      };
    }
  );

  registerAppTool(
    server,
    "ask_agentnet",
    {
      title: "Ask AgentNet",
      description: "Ask AgentNet for tool recommendations and a concise workflow to complete a task.",
      inputSchema: askInputSchema,
      ...widgetMeta(),
    },
    async (args) => {
      const query = args?.query?.trim?.() ?? "";
      if (!query) {
        return {
          content: [{ type: "text", text: "Missing query." }],
          structuredContent: {
            view: "answer",
            query,
            answer: "",
            sources: [],
          },
          ...widgetMeta(),
        };
      }

      const data = await askAgentNet(query);
      const sources = Array.isArray(data.sources) ? data.sources.map(mapSearchResult) : [];
      const answer = typeof data.answer === "string" ? data.answer : "No answer returned.";

      return {
        content: [{ type: "text", text: answer }],
        structuredContent: {
          view: "answer",
          query,
          answer,
          sources,
        },
        ...widgetMeta(),
      };
    }
  );

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname.startsWith(MCP_PATH)) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("AgentNet Apps SDK server");
    return;
  }

  const mcpMethods = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && mcpMethods.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createAppServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  if (url.pathname.startsWith("/.well-known/")) {
    res.writeHead(404).end("Not Found");
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(PORT, () => {
  console.log(`AgentNet Apps SDK server listening on http://localhost:${PORT}${MCP_PATH}`);
});
