/** API client for settings endpoints */

export interface Preferences {
  color_mode: string;
  chat_font: string;
  voice: string;
}

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string;
  auth_provider: string;
}

export interface OAuthConnectionInfo {
  id: string;
  provider: string;
  tool_id: string;
  scopes: string;
  expires_at: string | null;
  created_at: string | null;
}

export async function fetchPreferences(): Promise<Preferences> {
  const res = await fetch("/v1/settings/preferences", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch preferences");
  return res.json();
}

export async function updatePreferences(prefs: Partial<Preferences>): Promise<Preferences> {
  const res = await fetch("/v1/settings/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error("Failed to update preferences");
  return res.json();
}

export async function updateProfile(data: { display_name?: string }): Promise<Profile> {
  const res = await fetch("/v1/settings/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update profile");
  return res.json();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch("/v1/settings/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to change password");
  }
}

export async function fetchConnections(): Promise<OAuthConnectionInfo[]> {
  const res = await fetch("/v1/settings/connections", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch connections");
  return res.json();
}

export async function clearHistory(): Promise<void> {
  const res = await fetch("/v1/settings/history", {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to clear history");
}

export async function exportData(): Promise<void> {
  const res = await fetch("/v1/settings/export", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to export data");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "agentnet_export.json";
  a.click();
  URL.revokeObjectURL(url);
}
