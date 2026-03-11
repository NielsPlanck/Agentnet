# AgentNet OpenAI App

This folder contains an OpenAI Apps SDK compatible MCP server for AgentNet.

It wraps the existing AgentNet backend endpoints:

- `POST /v1/search`
- `POST /v1/ask`

and exposes them to ChatGPT as an app with:

- `search_agents`
- `ask_agentnet`
- a resource-backed widget at `ui://widget/agentnet.html`

## Run

1. Install dependencies:

```bash
npm install
```

2. Start the main AgentNet backend on `http://localhost:8000`.

3. Start the app server:

```bash
npm run dev
```

By default the app server listens on `http://localhost:8787/mcp`.

## Environment

- `PORT`: app server port, default `8787`
- `AGENTNET_URL`: backend base URL, default `http://localhost:8000`

## Add to ChatGPT

In ChatGPT developer mode, create a connector with:

```text
https://<your-public-host>/mcp
```

If you are tunneling locally, expose port `8787` and use the public HTTPS URL with the `/mcp` suffix.
