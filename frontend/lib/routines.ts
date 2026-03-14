import { API_BASE } from "@/lib/config";

/**
 * Routines API client — proactive assistant, Apple integration, notifications.
 */

// ── Routine CRUD ────────────────────────────────────────────────────

export interface RoutineData {
  name: string;
  prompt: string;
  schedule_type: "cron" | "interval" | "one_shot";
  schedule_value: string;
}

export interface RoutineItem {
  id: string;
  name: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string | null;
}

export async function createRoutine(data: RoutineData): Promise<{ id: string; status: string }> {
  const res = await fetch(`${API_BASE}/v1/routines/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create routine");
  return res.json();
}

export async function listRoutines(): Promise<{ routines: RoutineItem[] }> {
  const res = await fetch(`${API_BASE}/v1/routines/`);
  if (!res.ok) throw new Error("Failed to list routines");
  return res.json();
}

export async function updateRoutine(id: string, data: Partial<RoutineData & { enabled: boolean }>): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/routines/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update routine");
}

export async function deleteRoutine(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/routines/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete routine");
}

export async function triggerRoutine(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/routines/${id}/run`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to trigger routine");
}

// ── Apple Calendar ──────────────────────────────────────────────────

export interface CalendarEventData {
  title: string;
  start: string;
  end?: string;
  calendar_name?: string;
  notes?: string;
  location?: string;
}

export async function createCalendarEvent(data: CalendarEventData): Promise<{ title: string; status: string }> {
  const res = await fetch(`${API_BASE}/v1/routines/apple/calendar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create calendar event");
  return res.json();
}

export async function getCalendarEvents(days: number = 7): Promise<{ events: Record<string, string>[] }> {
  const res = await fetch(`${API_BASE}/v1/routines/apple/calendar?days=${days}`);
  if (!res.ok) throw new Error("Failed to get calendar events");
  return res.json();
}

// ── Apple Reminders ─────────────────────────────────────────────────

export interface ReminderData {
  name: string;
  due_date?: string;
  notes?: string;
  list_name?: string;
}

export async function createReminder(data: ReminderData): Promise<{ name: string; status: string }> {
  const res = await fetch(`${API_BASE}/v1/routines/apple/reminders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create reminder");
  return res.json();
}

export async function getReminders(listName?: string): Promise<{ reminders: Record<string, string>[] }> {
  const url = listName ? `${API_BASE}/v1/routines/apple/reminders?list_name=${encodeURIComponent(listName)}` : `${API_BASE}/v1/routines/apple/reminders`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to get reminders");
  return res.json();
}

// ── Apple Notes ─────────────────────────────────────────────────────

export interface NoteData {
  title: string;
  body: string;
  folder?: string;
}

export async function createNote(data: NoteData): Promise<{ title: string; status: string }> {
  const res = await fetch(`${API_BASE}/v1/routines/apple/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create note");
  return res.json();
}

export async function getNotes(folder: string = "Notes", limit: number = 20): Promise<{ notes: Record<string, string>[] }> {
  const res = await fetch(`${API_BASE}/v1/routines/apple/notes?folder=${encodeURIComponent(folder)}&limit=${limit}`);
  if (!res.ok) throw new Error("Failed to get notes");
  return res.json();
}

// ── iMessages ───────────────────────────────────────────────────────

export async function getMessages(hours: number = 24, limit: number = 50): Promise<{ messages: Record<string, string>[] }> {
  const res = await fetch(`${API_BASE}/v1/routines/apple/messages?hours=${hours}&limit=${limit}`);
  if (!res.ok) throw new Error("Failed to get messages");
  return res.json();
}

// ── Notifications ───────────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  routine_id: string;
  result_preview: string;
  conversation_id: string | null;
  completed_at: string | null;
}

export async function getNotifications(): Promise<{ unread_count: number; notifications: NotificationItem[] }> {
  const res = await fetch(`${API_BASE}/v1/routines/notifications`);
  if (!res.ok) throw new Error("Failed to get notifications");
  return res.json();
}

export async function markNotificationsRead(): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/routines/notifications/read`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to mark notifications read");
}
