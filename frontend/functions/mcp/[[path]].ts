// Cloudflare Pages Function — proxies /mcp/* to the backend on Render
export async function onRequest(context: {
  request: Request;
  env: { BACKEND_URL: string };
  params: { path: string[] };
}) {
  const backendUrl = context.env.BACKEND_URL || "https://agentnet.onrender.com";
  const path = context.params.path?.join("/") ?? "";
  const url = new URL(context.request.url);
  const target = `${backendUrl}/mcp${path ? "/" + path : ""}${url.search}`;

  const req = new Request(target, {
    method: context.request.method,
    headers: context.request.headers,
    body: ["GET", "HEAD"].includes(context.request.method)
      ? undefined
      : context.request.body,
    // @ts-ignore
    duplex: "half",
  });

  return fetch(req);
}
