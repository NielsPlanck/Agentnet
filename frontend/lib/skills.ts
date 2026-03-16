import { API_BASE } from "@/lib/config";

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
/** OAuth provider mapping: integration ID → provider key + OAuth start path (null = coming soon) */
export const INTEGRATION_OAUTH: Record<string, { provider: string; startPath: string | null }> = {
  "google-workspace": { provider: "google", startPath: "/v1/oauth/google/start?tool_id=google-workspace" },
  "github": { provider: "github", startPath: null },
  "notion": { provider: "notion", startPath: null },
  "slack": { provider: "slack", startPath: null },
  "microsoft-365": { provider: "microsoft", startPath: null },
  "salesforce": { provider: "salesforce", startPath: null },
  "hubspot": { provider: "hubspot", startPath: null },
  "jira": { provider: "jira", startPath: null },
  "linear": { provider: "linear", startPath: null },
  "figma": { provider: "figma", startPath: null },
  "stripe": { provider: "stripe", startPath: null },
  "shopify": { provider: "shopify", startPath: null },
  "airtable": { provider: "airtable", startPath: null },
  "discord": { provider: "discord", startPath: null },
  "trello": { provider: "trello", startPath: null },
  "zapier": { provider: "zapier", startPath: null },
  "twilio": { provider: "twilio", startPath: null },
  "x-twitter": { provider: "twitter", startPath: null },
  "linkedin": { provider: "linkedin", startPath: null },
  "calendly": { provider: "calendly", startPath: null },
};

export const INTEGRATION_SKILLS: Skill[] = [
  {
    id: "google-workspace",
    name: "Google Workspace",
    description: "Access Gmail, Drive, Calendar, and Sheets through your connected account",
    icon: "Cloud",
    category: "integration",
    enabled: false,
    author: "Google",
    instructions: "The user has connected their Google account. You have REAL access to their Google Calendar events, Gmail inbox, Google Drive files, Google Sheets, and Contacts. When calendar events, emails, or files appear in Live Context, that data is REAL — use it directly. You can create calendar events, draft emails, and reference their files. Never simulate or fake Google data when real data is available.",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Manage repos, issues, PRs, and code reviews",
    icon: "Github",
    category: "integration",
    enabled: false,
    author: "GitHub",
    instructions: "The user wants GitHub integration. Help them manage repositories, create/review pull requests, track issues, and navigate code. Use GitHub MCP tools from the AgentNet index when available. Suggest relevant GitHub actions and workflows.",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Read and update Notion pages, databases, and wikis",
    icon: "BookOpen",
    category: "integration",
    enabled: false,
    author: "Notion",
    instructions: "The user wants Notion integration. Help them manage Notion pages, databases, and wikis. Use Notion MCP tools from the AgentNet index when available. Help organize information, create templates, and manage project documentation.",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send messages, search channels, and manage notifications",
    icon: "MessageCircle",
    category: "integration",
    enabled: false,
    author: "Slack",
    instructions: "The user wants Slack integration. Help them send messages, search channels, manage notifications, and automate Slack workflows. Use Slack MCP tools from the AgentNet index when available.",
  },
  {
    id: "microsoft-365",
    name: "Microsoft 365",
    description: "Access Outlook email, OneDrive files, Teams chat, and Office docs",
    icon: "Mail",
    category: "integration",
    enabled: false,
    author: "Microsoft",
    instructions: "The user wants Microsoft 365 integration. Help with Outlook email, OneDrive files, Teams conversations, and Office documents. Use Microsoft MCP tools from the AgentNet index when available.",
  },
  {
    id: "salesforce",
    name: "Salesforce",
    description: "Manage CRM contacts, leads, opportunities, and sales pipelines",
    icon: "TrendingUp",
    category: "integration",
    enabled: false,
    author: "Salesforce",
    instructions: "The user wants Salesforce CRM integration. Help manage contacts, leads, opportunities, accounts, and sales pipelines. Use Salesforce MCP tools from the AgentNet index when available. Provide sales insights and pipeline analytics.",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "CRM, marketing automation, contact management, and deal tracking",
    icon: "Users",
    category: "integration",
    enabled: false,
    author: "HubSpot",
    instructions: "The user wants HubSpot integration. Help with CRM contacts, deals, marketing campaigns, email sequences, and analytics. Use HubSpot MCP tools from the AgentNet index when available.",
  },
  {
    id: "jira",
    name: "Jira",
    description: "Track issues, manage sprints, and monitor project progress",
    icon: "GitBranch",
    category: "integration",
    enabled: false,
    author: "Atlassian",
    instructions: "The user wants Jira integration. Help track issues, manage sprints, monitor project progress, and create/update tickets. Use Jira/Atlassian MCP tools from the AgentNet index when available.",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issue tracking, project management, and engineering workflows",
    icon: "Zap",
    category: "integration",
    enabled: false,
    author: "Linear",
    instructions: "The user wants Linear integration. Help with issue tracking, project cycles, engineering workflows, and team productivity. Use Linear MCP tools from the AgentNet index when available.",
  },
  {
    id: "figma",
    name: "Figma",
    description: "Access design files, components, comments, and project updates",
    icon: "Palette",
    category: "integration",
    enabled: false,
    author: "Figma",
    instructions: "The user wants Figma integration. Help access design files, review components, manage comments, and track design project updates. Use Figma MCP tools from the AgentNet index when available.",
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "View payments, invoices, subscriptions, and financial analytics",
    icon: "CreditCard",
    category: "integration",
    enabled: false,
    author: "Stripe",
    instructions: "The user wants Stripe integration. Help view payments, manage invoices, track subscriptions, handle refunds, and analyze financial data. Use Stripe MCP tools from the AgentNet index when available.",
  },
  {
    id: "shopify",
    name: "Shopify",
    description: "Manage products, orders, inventory, and storefront analytics",
    icon: "ShoppingBag",
    category: "integration",
    enabled: false,
    author: "Shopify",
    instructions: "The user wants Shopify integration. Help manage products, track orders, update inventory, and analyze storefront performance. Use Shopify MCP tools from the AgentNet index when available.",
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Access bases, tables, records, and automate data workflows",
    icon: "Database",
    category: "integration",
    enabled: false,
    author: "Airtable",
    instructions: "The user wants Airtable integration. Help access bases, manage tables and records, create views, and automate data workflows. Use Airtable MCP tools from the AgentNet index when available.",
  },
  {
    id: "discord",
    name: "Discord",
    description: "Send messages, manage servers, and monitor community channels",
    icon: "Headphones",
    category: "integration",
    enabled: false,
    author: "Discord",
    instructions: "The user wants Discord integration. Help send messages, manage servers, monitor channels, and set up bots. Use Discord MCP tools from the AgentNet index when available.",
  },
  {
    id: "trello",
    name: "Trello",
    description: "Manage boards, lists, and cards for task organization",
    icon: "Layout",
    category: "integration",
    enabled: false,
    author: "Atlassian",
    instructions: "The user wants Trello integration. Help manage boards, lists, and cards for task organization and project tracking. Use Trello MCP tools from the AgentNet index when available.",
  },
  {
    id: "zapier",
    name: "Zapier",
    description: "Connect 6,000+ apps with automated workflows and triggers",
    icon: "Globe",
    category: "integration",
    enabled: false,
    author: "Zapier",
    instructions: "The user wants Zapier integration. Help create automated workflows (Zaps), connect apps, set up triggers and actions, and manage existing automations. Use Zapier MCP tools from the AgentNet index when available.",
  },
  {
    id: "twilio",
    name: "Twilio",
    description: "Send SMS, WhatsApp messages, and manage voice communications",
    icon: "Phone",
    category: "integration",
    enabled: false,
    author: "Twilio",
    instructions: "The user wants Twilio integration. Help send SMS and WhatsApp messages, manage voice calls, and set up communication workflows. Use Twilio MCP tools from the AgentNet index when available.",
  },
  {
    id: "x-twitter",
    name: "X (Twitter)",
    description: "Post tweets, monitor mentions, and analyze engagement metrics",
    icon: "Send",
    category: "integration",
    enabled: false,
    author: "X Corp",
    instructions: "The user wants X (Twitter) integration. Help post tweets, monitor mentions and trends, analyze engagement metrics, and manage their social presence. Use X/Twitter MCP tools from the AgentNet index when available.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    description: "Manage profile, post updates, search connections, and InMail",
    icon: "Briefcase",
    category: "integration",
    enabled: false,
    author: "LinkedIn",
    instructions: "The user wants LinkedIn integration. Help manage their profile, post updates, search for connections, send InMail, and track professional networking. Use LinkedIn MCP tools from the AgentNet index when available.",
  },
  {
    id: "calendly",
    name: "Calendly",
    description: "Schedule meetings, manage availability, and sync booking links",
    icon: "CalendarCheck",
    category: "integration",
    enabled: false,
    author: "Calendly",
    instructions: "The user wants Calendly integration. Help schedule meetings, manage availability windows, share booking links, and coordinate appointments. Use Calendly MCP tools from the AgentNet index when available.",
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
  const res = await fetch(`${API_BASE}/v1/skills/`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch custom skills");
  const data = await res.json();
  return data.skills || [];
}

export async function createCustomSkill(payload: CreateSkillPayload): Promise<CustomSkillData> {
  const res = await fetch(`${API_BASE}/v1/skills/`, {
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
  const res = await fetch(`${API_BASE}/v1/skills/${id}`, {
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
  const res = await fetch(`${API_BASE}/v1/skills/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete skill");
}

export async function shareSkill(id: string): Promise<SkillExportData> {
  const res = await fetch(`${API_BASE}/v1/skills/${id}/share`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to share skill");
  return res.json();
}

export async function importSkillByCode(shareCode: string): Promise<CustomSkillData> {
  const res = await fetch(`${API_BASE}/v1/skills/import`, {
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
  const res = await fetch(`${API_BASE}/v1/skills/import`, {
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
