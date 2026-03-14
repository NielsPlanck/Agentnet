import { API_BASE } from "@/lib/config";

/**
 * Campaign API client — B2B multichannel prospecting.
 */

// ── Types ────────────────────────────────────────────────────────

export interface OutreachLog {
  id: string;
  step_order: number;
  step_type: string;
  action: string;
  subject: string;
  body: string;
  created_at: string | null;
}

export interface CampaignProspect {
  id: string;
  name: string;
  email: string;
  company: string;
  title: string;
  linkedin: string;
  phone: string;
  website: string;
  tier: number;
  prospect_status: string;
  current_step: number;
  personalization: string;
  notes: string;
  created_at: string | null;
  outreach_logs: OutreachLog[];
}

export interface SequenceStep {
  id: string;
  step_order: number;
  step_type: string;
  delay_days: number;
  subject_template: string;
  body_template: string;
  instructions: string;
}

export interface CampaignStats {
  total: number;
  not_started: number;
  in_progress: number;
  replied: number;
  meeting_booked: number;
  converted: number;
  dropped: number;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: string;
  default_tier: number;
  target_industry: string;
  target_role: string;
  target_company_size: string;
  target_location: string;
  created_at: string | null;
  updated_at: string | null;
  prospect_count: number;
  step_count: number;
  stats?: CampaignStats;
  prospects?: CampaignProspect[];
  sequence_steps?: SequenceStep[];
}

export interface CampaignFullStats {
  campaign_id: string;
  total_prospects: number;
  status_breakdown: Record<string, number>;
  tier_breakdown: Record<string, number>;
  channel_breakdown: Record<string, number>;
  total_outreach_actions: number;
  reply_rate: number;
  conversion_rate: number;
}

// ── API Functions ────────────────────────────────────────────────

const BASE = `${API_BASE}/v1/campaigns`;

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "API error");
  }
  return res.json();
}

// Campaigns
export const listCampaigns = () => api<Campaign[]>("");

export const createCampaign = (data: {
  name: string;
  description?: string;
  default_tier?: number;
  target_industry?: string;
  target_role?: string;
  target_company_size?: string;
  target_location?: string;
}) => api<Campaign>("", { method: "POST", body: JSON.stringify(data) });

export const getCampaign = (id: string) => api<Campaign>(`/${id}`);

export const updateCampaign = (id: string, data: Partial<Campaign>) =>
  api<Campaign>(`/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export const deleteCampaign = (id: string) =>
  api<{ ok: boolean }>(`/${id}`, { method: "DELETE" });

// Prospects
export const addProspect = (campaignId: string, data: Partial<CampaignProspect>) =>
  api<CampaignProspect>(`/${campaignId}/prospects`, { method: "POST", body: JSON.stringify(data) });

export const bulkAddProspects = (campaignId: string, prospects: Partial<CampaignProspect>[]) =>
  api<{ added: number }>(`/${campaignId}/prospects/bulk`, {
    method: "POST",
    body: JSON.stringify({ prospects }),
  });

export const updateProspect = (campaignId: string, prospectId: string, data: Partial<CampaignProspect>) =>
  api<CampaignProspect>(`/${campaignId}/prospects/${prospectId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteProspect = (campaignId: string, prospectId: string) =>
  api<{ ok: boolean }>(`/${campaignId}/prospects/${prospectId}`, { method: "DELETE" });

// Sequence steps
export const addSequenceStep = (campaignId: string, data: Partial<SequenceStep>) =>
  api<SequenceStep>(`/${campaignId}/steps`, { method: "POST", body: JSON.stringify(data) });

export const replaceSequenceSteps = (campaignId: string, steps: Partial<SequenceStep>[]) =>
  api<{ ok: boolean }>(`/${campaignId}/steps`, { method: "PUT", body: JSON.stringify(steps) });

export const deleteSequenceStep = (campaignId: string, stepId: string) =>
  api<{ ok: boolean }>(`/${campaignId}/steps/${stepId}`, { method: "DELETE" });

// Outreach
export const logOutreach = (
  campaignId: string,
  prospectId: string,
  data: { step_order: number; step_type: string; action?: string; subject?: string; body?: string }
) =>
  api<{ ok: boolean; prospect_status: string; current_step: number }>(
    `/${campaignId}/prospects/${prospectId}/log`,
    { method: "POST", body: JSON.stringify(data) }
  );

// AI Copy
export const generateCopy = (
  campaignId: string,
  data: {
    channel: string;
    prospect_id?: string;
    sender_name?: string;
    sender_company?: string;
    value_proposition?: string;
    step_number?: number;
    is_followup?: boolean;
  }
) => api<{ subject: string; body: string }>(`/${campaignId}/generate-copy`, {
  method: "POST",
  body: JSON.stringify(data),
});

export const generateSequence = (
  campaignId: string,
  data: {
    tier?: number;
    value_proposition?: string;
    target_industry?: string;
    target_role?: string;
  }
) => api<{ steps: SequenceStep[]; saved: boolean }>(`/${campaignId}/generate-sequence`, {
  method: "POST",
  body: JSON.stringify(data),
});

// Enrichment
export const enrichProspect = (
  campaignId: string,
  prospectId: string,
  topics?: string[]
) => api<{ prospect_id: string; intel: Record<string, unknown>; personalization: string }>(
  `/${campaignId}/prospects/${prospectId}/enrich`,
  { method: "POST", body: JSON.stringify({ topics }) }
);

// Stats
export const getCampaignStats = (campaignId: string) =>
  api<CampaignFullStats>(`/${campaignId}/stats`);

// ── Helpers ──────────────────────────────────────────────────────

export const STEP_TYPE_LABELS: Record<string, string> = {
  email: "Email",
  linkedin_connect: "LinkedIn Connect",
  linkedin_message: "LinkedIn Message",
  linkedin_voice_note: "LinkedIn Voice Note",
  call: "Phone Call",
  reminder: "Reminder",
};

export const STEP_TYPE_ICONS: Record<string, string> = {
  email: "📧",
  linkedin_connect: "🔗",
  linkedin_message: "💬",
  linkedin_voice_note: "🎤",
  call: "📞",
  reminder: "⏰",
};

export const STATUS_COLORS: Record<string, string> = {
  not_started: "text-gray-400",
  in_progress: "text-blue-400",
  replied: "text-green-400",
  meeting_booked: "text-purple-400",
  converted: "text-emerald-400",
  dropped: "text-red-400",
  bounced: "text-orange-400",
};

export const STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  replied: "Replied",
  meeting_booked: "Meeting Booked",
  converted: "Converted",
  dropped: "Dropped",
  bounced: "Bounced",
};

export const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 — High Touch",
  2: "Tier 2 — Semi-Auto",
  3: "Tier 3 — Automated",
};

export const TIER_DESCRIPTIONS: Record<number, string> = {
  1: "Manual, fully personalized: email + LinkedIn + phone + voice notes",
  2: "Email + LinkedIn, personalized first touch, templated follow-ups",
  3: "Email-only, template-based with minimal customization",
};
