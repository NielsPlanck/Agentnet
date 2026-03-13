/**
 * Skills — reusable capabilities that extend AgentNet.
 *
 * Like Claude's Skills: each skill is a set of instructions / integrations
 * that the AI loads when relevant. Users can enable/disable them.
 */

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;          // lucide icon name
  category: "built-in" | "integration" | "custom";
  enabled: boolean;
  author?: string;       // "AgentNet" for built-in, provider name for integrations
  instructions?: string; // Markdown instructions (for custom skills)
  mcpServerUrl?: string; // optional MCP server URL
}

// ── Custom Skill Types ──────────────────────────────────────────────────

export interface CustomSkillData {
  id: string;
  name: string;
  description: string;
  icon: string;
  instructions: string;
  mcp_server_url: string | null;
  enabled: boolean;
  is_public: boolean;
  share_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillExportData {
  name: string;
  description: string;
  icon: string;
  instructions: string;
  mcp_server_url: string | null;
  share_code: string;
}

export interface CreateSkillPayload {
  name: string;
  description?: string;
  icon?: string;
  instructions?: string;
  mcp_server_url?: string;
}

export interface UpdateSkillPayload {
  name?: string;
  description?: string;
  icon?: string;
  instructions?: string;
  mcp_server_url?: string | null;
  enabled?: boolean;
}

// ── Built-in Skills ──────────────────────────────────────────────────────
export const BUILT_IN_SKILLS: Skill[] = [
  {
    id: "web-search",
    name: "Web Search",
    description: "Search the web for real-time information, news, and research",
    icon: "Globe",
    category: "built-in",
    enabled: true,
    author: "AgentNet",
  },
  {
    id: "agent-discovery",
    name: "Agent Discovery",
    description: "Find and recommend the best AI agents, tools, and MCP servers for any task",
    icon: "Search",
    category: "built-in",
    enabled: true,
    author: "AgentNet",
  },
  {
    id: "code-analysis",
    name: "Code Analysis",
    description: "Review, debug, and analyze code across multiple languages",
    icon: "Code2",
    category: "built-in",
    enabled: true,
    author: "AgentNet",
  },
  {
    id: "data-analysis",
    name: "Data Analysis",
    description: "Analyze CSV, JSON, and structured data with charts and insights",
    icon: "TrendingUp",
    category: "built-in",
    enabled: false,
    author: "AgentNet",
  },
  {
    id: "document-creation",
    name: "Document Creation",
    description: "Generate polished reports, presentations, and documents",
    icon: "FileText",
    category: "built-in",
    enabled: false,
    author: "AgentNet",
  },
  {
    id: "email-outreach",
    name: "Email & Outreach",
    description: "Draft personalized emails, cold outreach, and follow-up sequences",
    icon: "Mail",
    category: "built-in",
    enabled: true,
    author: "AgentNet",
  },
  {
    id: "job-application",
    name: "Job Application Agent",
    description: "Browse job boards and apply for jobs using browser automation and AI vision",
    icon: "Briefcase",
    category: "built-in",
    enabled: false,
    author: "AgentNet",
  },
  {
    id: "proactive-assistant",
    name: "Proactive Assistant",
    description: "Morning briefings, routines, Apple Calendar/Reminders/Notes integration",
    icon: "Bell",
    category: "built-in",
    enabled: false,
    author: "AgentNet",
  },
  {
    id: "smart-inbox",
    name: "Smart Inbox",
    description: "AI-powered email triage: categorize by priority, draft replies, and scan your inbox",
    icon: "Inbox",
    category: "built-in",
    enabled: false,
    author: "AgentNet",
  },
  {
    id: "meeting-intel",
    name: "Meeting Intelligence",
    description: "Auto-debrief after meetings: action items, follow-up emails, and meeting notes",
    icon: "CalendarCheck",
    category: "built-in",
    enabled: false,
    author: "AgentNet",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Read, summarize, and reply to WhatsApp conversations via browser automation",
    icon: "MessageSquare",
    category: "built-in",
    enabled: false,
    author: "AgentNet",
  },
  {
    id: "workflow-builder",
    name: "Workflow Builder",
    description: "Create automated workflows that chain email, calendar, WhatsApp, and AI actions",
    icon: "GitBranch",
    category: "built-in",
    enabled: false,
    author: "AgentNet",
  },
];

// ── Integration Skills (partner / MCP) ───────────────────────────────────
export const INTEGRATION_SKILLS: Skill[] = [
  {
    id: "google-workspace",
    name: "Google Workspace",
    description: "Access Gmail, Drive, Calendar, and Sheets through your connected account",
    icon: "Cloud",
    category: "integration",
    enabled: false,
    author: "Google",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Manage repos, issues, PRs, and code reviews",
    icon: "Github",
    category: "integration",
    enabled: false,
    author: "GitHub",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Read and update Notion pages, databases, and wikis",
    icon: "BookOpen",
    category: "integration",
    enabled: false,
    author: "Notion",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send messages, search channels, and manage notifications",
    icon: "MessageCircle",
    category: "integration",
    enabled: false,
    author: "Slack",
  },
];

/** LocalStorage key for skill enabled state overrides */
const SKILLS_STORAGE_KEY = "agentnet_skills_enabled";

/** LocalStorage key for anonymous user's custom skills */
const LOCAL_CUSTOM_SKILLS_KEY = "agentnet_custom_skills";

/** Load user's skill toggles from localStorage */
export function loadSkillToggles(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SKILLS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Save a skill toggle to localStorage */
export function saveSkillToggle(skillId: string, enabled: boolean) {
  const toggles = loadSkillToggles();
  toggles[skillId] = enabled;
  try {
    localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(toggles));
  } catch {}
}

/** Get all built-in + integration skills with user overrides applied */
export function getAllSkills(): Skill[] {
  const toggles = loadSkillToggles();
  return [...BUILT_IN_SKILLS, ...INTEGRATION_SKILLS].map((skill) => ({
    ...skill,
    enabled: toggles[skill.id] ?? skill.enabled,
  }));
}

/** Get only enabled skills */
export function getEnabledSkills(): Skill[] {
  return getAllSkills().filter((s) => s.enabled);
}

// ── Custom Skills API (server-backed for logged-in users) ─────────────────

export async function fetchCustomSkills(): Promise<CustomSkillData[]> {
  const res = await fetch("/v1/skills/", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch custom skills");
  const data = await res.json();
  return data.skills || [];
}

export async function createCustomSkill(payload: CreateSkillPayload): Promise<CustomSkillData> {
  const res = await fetch("/v1/skills/", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create skill");
  }
  return res.json();
}

export async function updateCustomSkill(id: string, payload: UpdateSkillPayload): Promise<CustomSkillData> {
  const res = await fetch(`/v1/skills/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update skill");
  }
  return res.json();
}

export async function deleteCustomSkill(id: string): Promise<void> {
  const res = await fetch(`/v1/skills/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete skill");
}

export async function shareSkill(id: string): Promise<SkillExportData> {
  const res = await fetch(`/v1/skills/${id}/share`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to share skill");
  return res.json();
}

export async function importSkillByCode(shareCode: string): Promise<CustomSkillData> {
  const res = await fetch("/v1/skills/import", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ share_code: shareCode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to import skill");
  }
  return res.json();
}

export async function importSkillFromJSON(skillData: SkillExportData): Promise<CustomSkillData> {
  const res = await fetch("/v1/skills/import", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skill_data: skillData }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to import skill");
  }
  return res.json();
}

// ── Local (anonymous) custom skills ─────────────────────────────────────

export function loadLocalCustomSkills(): CustomSkillData[] {
  try {
    const raw = localStorage.getItem(LOCAL_CUSTOM_SKILLS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalCustomSkills(skills: CustomSkillData[]) {
  try {
    localStorage.setItem(LOCAL_CUSTOM_SKILLS_KEY, JSON.stringify(skills));
  } catch {}
}

export function addLocalCustomSkill(payload: CreateSkillPayload): CustomSkillData {
  const skills = loadLocalCustomSkills();
  const now = new Date().toISOString();
  const skill: CustomSkillData = {
    id: crypto.randomUUID(),
    name: payload.name,
    description: payload.description || "",
    icon: payload.icon || "Zap",
    instructions: payload.instructions || "",
    mcp_server_url: payload.mcp_server_url || null,
    enabled: true,
    is_public: false,
    share_code: null,
    created_at: now,
    updated_at: now,
  };
  skills.push(skill);
  saveLocalCustomSkills(skills);
  return skill;
}

export function updateLocalCustomSkill(id: string, payload: UpdateSkillPayload): CustomSkillData | null {
  const skills = loadLocalCustomSkills();
  const idx = skills.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const updated = { ...skills[idx], ...payload, updated_at: new Date().toISOString() };
  skills[idx] = updated;
  saveLocalCustomSkills(skills);
  return updated;
}

export function deleteLocalCustomSkill(id: string) {
  const skills = loadLocalCustomSkills();
  saveLocalCustomSkills(skills.filter((s) => s.id !== id));
}

/** Convert CustomSkillData to Skill interface for display */
export function customToSkill(cs: CustomSkillData): Skill {
  return {
    id: cs.id,
    name: cs.name,
    description: cs.description,
    icon: cs.icon || "Zap",
    category: "custom",
    enabled: cs.enabled,
    instructions: cs.instructions,
    mcpServerUrl: cs.mcp_server_url || undefined,
  };
}

/** Get all skills (built-in + integration + custom) asynchronously */
export async function getAllSkillsAsync(isLoggedIn: boolean): Promise<Skill[]> {
  const builtInAndIntegration = getAllSkills();
  let customs: CustomSkillData[] = [];
  if (isLoggedIn) {
    try {
      customs = await fetchCustomSkills();
    } catch {
      customs = loadLocalCustomSkills();
    }
  } else {
    customs = loadLocalCustomSkills();
  }
  return [...builtInAndIntegration, ...customs.map(customToSkill)];
}
