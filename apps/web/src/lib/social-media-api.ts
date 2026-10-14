import { apiFetch } from "@/lib/nexus-api";

/**
 * The Social Media Report API (owner, 14 Oct 2026; Project.type "SOCIAL_MEDIA_REPORT"):
 * GET /api/projects/:id/social-media?month=YYYY-MM, PUT …/social-media/days/:date,
 * PUT …/social-media/targets, PUT …/social-media/day-targets, GET/PUT …/social-media/config.
 * Server: src/lib/social-media.ts (rules) and src/lib/social-media-server.ts.
 * Engagement = Likes + Comments + Shares; views are not engagement.
 */

export type SocialPerson = { id: string; name: string | null; avatar: string | null };
export type SocialPlatform = { id: string; name: string; archived?: boolean };
export type SocialReportConfig = { version: 1; platforms: SocialPlatform[] };
export type SocialMetric = "views" | "likes" | "comments" | "shares" | "posts";
export const SOCIAL_METRICS: SocialMetric[] = ["views", "likes", "comments", "shares", "posts"];
export type SocialTargetSource = "day" | "month" | null;

export type SocialPlatformDay = Record<SocialMetric, number | null> & {
  engagement: number | null;
  engagementTarget: number | null;
  postsTarget: number | null;
  engagementTargetSource: SocialTargetSource;
  postsTargetSource: SocialTargetSource;
  engagementPct: number | null;
  postsPct: number | null;
};

export type SocialDay = {
  date: string;
  platforms: Record<string, SocialPlatformDay>;
  engagement: number | null;
  views: number | null;
  posts: number | null;
  worked: string;
  didntWork: string;
  recorded: boolean;
  updatedAt: string | null;
  updatedBy: SocialPerson | null;
};

export type SocialMonthTarget = { platformId: string; engagementTarget: number | null; postsTarget: number | null; updatedAt?: string; updatedBy?: SocialPerson | null };
export type SocialDayTarget = { date: string; platformId: string; engagementTarget: number | null; postsTarget: number | null };

export type SocialPlatformOverview = {
  platformId: string;
  name: string;
  archived: boolean;
  engagement: number;
  views: number;
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  engagementTargetToDate: number | null;
  postsTargetToDate: number | null;
  engagementPct: number | null;
  postsPct: number | null;
  engagementTargetMonth: number | null;
  postsTargetMonth: number | null;
  trend: number[];
  recordedDays: number;
};

export type SocialMonthResponse = {
  project: { id: string; name: string; type: string; workspaceId: string };
  canRecord: boolean;
  canManage: boolean;
  month: string;
  today: string;
  config: SocialReportConfig;
  targets: SocialMonthTarget[];
  dayTargets: SocialDayTarget[];
  days: SocialDay[];
  overview: { month: string; cutoff: string | null; recordedDays: number; platforms: SocialPlatformOverview[] };
};

export type SocialConfigResponse = { config: SocialReportConfig; usage: Record<string, number>; canManage: boolean };

/** PUT …/days/:date: only the keys sent change; null clears. */
export type SocialDayWrite = {
  platforms?: Record<string, Partial<Record<SocialMetric, number | null>>>;
  worked?: string;
  didntWork?: string;
};
export type SocialTargetsWrite = Record<string, { engagementTarget?: number | null; postsTarget?: number | null }>;

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/social-media`;

/** Every query of one report starts with this, so a realtime ping refetches them all. */
export const socialKey = (projectId: string) => ["nexus", "social-media", projectId] as const;
export const socialMonthKey = (projectId: string, month: string) => [...socialKey(projectId), "month", month] as const;
export const socialConfigKey = (projectId: string) => [...socialKey(projectId), "config"] as const;

export const socialApi = {
  month: (projectId: string, month: string) => apiFetch<SocialMonthResponse>(`${base(projectId)}?month=${encodeURIComponent(month)}`),
  putDay: (projectId: string, date: string, payload: SocialDayWrite) =>
    apiFetch<{ date: string; changed: string[] }>(`${base(projectId)}/days/${encodeURIComponent(date)}`, { method: "PUT", body: JSON.stringify(payload) }),
  putTargets: (projectId: string, month: string, platforms: SocialTargetsWrite) =>
    apiFetch<{ month: string; changed: string[] }>(`${base(projectId)}/targets`, { method: "PUT", body: JSON.stringify({ month, platforms }) }),
  putDayTargets: (projectId: string, date: string, platforms: SocialTargetsWrite) =>
    apiFetch<{ date: string; changed: string[] }>(`${base(projectId)}/day-targets`, { method: "PUT", body: JSON.stringify({ date, platforms }) }),
  config: (projectId: string) => apiFetch<SocialConfigResponse>(`${base(projectId)}/config`),
  putConfig: (projectId: string, config: SocialReportConfig) =>
    apiFetch<SocialConfigResponse>(`${base(projectId)}/config`, { method: "PUT", body: JSON.stringify({ config }) }),
};

/** Engagement = Likes + Comments + Shares (the server's engagementOf); null when none is filled. */
export function engagementOf(f: { likes?: number | null; comments?: number | null; shares?: number | null }): number | null {
  const parts = [f.likes, f.comments, f.shares].filter((v): v is number => typeof v === "number");
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}
