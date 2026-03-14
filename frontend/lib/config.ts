/**
 * Runtime configuration for the frontend.
 *
 * In development: API_BASE is "" (same origin, Next.js rewrites proxy to localhost:8000)
 * In production:  API_BASE is the backend domain (e.g. "https://backagentnet.codiris.app")
 */
export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL || "";

/** Build an absolute API URL — prepends API_BASE when path starts with "/" */
export function apiUrl(path: string): string {
  return path.startsWith("/") ? `${API_BASE}${path}` : path;
}
