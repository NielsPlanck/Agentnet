// Cloudflare Pages Function — proxies /mcp to the AgentNet backend
export async function onRequest(context: {
  request: Request;
  env: { BACKEND_URL: string };
}) {
  const backendUrl = context.env.BACKEND_URL || "https://backend.codiris.app";
  const url = new URL(context.request.url);
  const target = `${backendUrl}/mcp/${url.search}`;

  // Build clean headers — strip Host so fetch uses the correct target host
  const headers = new Headers(context.request.headers);
  headers.set("Origin", "https://agentnet.codiris.app");
  headers.delete("Host");

  return fetch(new Request(target, {
    method: context.request.method,
    headers,
    body: ["GET", "HEAD"].includes(context.request.method) ? undefined : context.request.body,
    // @ts-ignore
    duplex: "half",
  }));
}
