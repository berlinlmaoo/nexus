import { apiFetch } from "@/lib/nexus-api";

/**
 * The Outlet Sales Dashboard API (owner, 10 Oct 2026, for the outlet team; Project.type "OUTLET_SALES"):
 * GET /api/projects/:id/outlet-sales?month=YYYY-MM, POST …/outlet-sales/events,
 * GET/PATCH/DELETE …/outlet-sales/events/:eventId, GET/PUT …/outlet-sales/targets.
 * Server: src/lib/outlet-sales.ts (rules) and src/lib/outlet-sales-server.ts. Spec for the apps:
 * the OUTLET-SALES handoff spec.
 */

export type OutletPerson = { id: string; name: string | null; avatar: string | null };
export type OutletStatus = "UPCOMING" | "WAITING_REPORT" | "REPORTED";

export type OutletEvent = {
  id: string;
  projectId: string;
  /** "YYYY-MM-DD", the day of the event (WIB). */
  date: string;
  name: string;
  salesTarget: number | null;
  paxTarget: number | null;
  sales: number | null;
  pax: number | null;
  rsvpWalkIn: number | null;
  rsvpTeam: number | null;
  rsvpPr: number | null;
  rsvpEo: number | null;
  hostingTeam: number | null;
  hostingPr: number | null;
  hostingEo: number | null;
  successWhat: string;
  successWhy: string;
  successRepeat: string;
  failWhat: string;
  failWhy: string;
  failPrevent: string;
  /** Every breakdown figure by item id (the seven original items included). Absent = not filled. */
  values?: Record<string, number>;
  rsvpTotal: number | null;
  hostingTotal: number | null;
  /** All communities together, and per community id (14 Oct 2026). */
  communityTotal?: number | null;
  communityTotals?: Record<string, number | null>;
  salesPct: number | null;
  paxPct: number | null;
  status: OutletStatus;
  missing: ("sales" | "pax")[];
  reportedAt: string | null;
  reportedBy: OutletPerson | null;
  createdAt: string;
  createdBy: OutletPerson | null;
  updatedAt: string;
  updatedBy: OutletPerson | null;
};

/** The keys of an event a client may send (POST / PATCH). */
export type OutletEventPatch = Partial<Pick<OutletEvent,
  "date" | "name" | "salesTarget" | "paxTarget" | "sales" | "pax" | "rsvpWalkIn" | "rsvpTeam" | "rsvpPr" | "rsvpEo"
  | "hostingTeam" | "hostingPr" | "hostingEo" | "successWhat" | "successWhy" | "successRepeat" | "failWhat" | "failWhy" | "failPrevent">>;
export type OutletFieldKey = keyof OutletEventPatch;
/** POST / PATCH body: the form's keys plus the breakdown figures by item id (null clears one). */
export type OutletEventWrite = OutletEventPatch & { values?: Record<string, number | null> };

// ── The outlet's own report breakdown (owner, 14 Oct 2026) ──
export type OutletItem = { id: string; label: string; archived?: boolean };
export type OutletCommunityMode = "total" | "breakdown";
export type OutletCommunity = { id: string; name: string; mode: OutletCommunityMode; items: OutletItem[]; archived?: boolean };
export type OutletReportConfig = { version: 1; rsvp: OutletItem[]; hosting: OutletItem[]; communities: OutletCommunity[] };
export type OutletConfigResponse = { config: OutletReportConfig; usage: Record<string, number>; canManage: boolean };

export type OutletGuestLine = { id: string; label: string; archived: boolean; total: number };
export type OutletGuests = {
  reportCount: number;
  rsvp: { total: number; items: OutletGuestLine[] };
  hosting: { total: number; items: OutletGuestLine[] };
  communities: {
    total: number;
    items: { id: string; name: string; mode: OutletCommunityMode; archived: boolean; total: number; items: OutletGuestLine[] }[];
  };
};

export type OutletTargetSource = "day" | "month" | null;
export type OutletDay = {
  date: string;
  sales: number | null;
  pax: number | null;
  salesTarget: number | null;
  paxTarget: number | null;
  salesTargetSource: OutletTargetSource;
  paxTargetSource: OutletTargetSource;
  salesPct: number | null;
  paxPct: number | null;
};
export type OutletDayTarget = { date: string; salesTarget: number | null; paxTarget: number | null; updatedAt?: string; updatedBy?: OutletPerson | null };

export type Bilingual = { en: string; id: string };
export type OutletFormField = {
  key: OutletFieldKey;
  type: "text" | "date" | "money" | "count" | "longtext";
  label: Bilingual;
  hint?: Bilingual;
  required?: boolean;
  max: number;
};
export type OutletFormSection = { key: string; title: Bilingual; total?: "rsvpTotal" | "hostingTotal"; fields: OutletFormField[] };
export type OutletForm = { version: number; sections: OutletFormSection[] };

export type OutletTarget = { month: string; salesTarget: number | null; paxTarget: number | null; updatedAt: string; updatedBy: OutletPerson | null };

export type OutletSummary = {
  month: string;
  sales: number;
  pax: number;
  salesTarget: number | null;
  paxTarget: number | null;
  salesPct: number | null;
  paxPct: number | null;
  eventCount: number;
  reportedCount: number;
  waitingCount: number;
  upcomingCount: number;
  rsvpTotal: number;
  hostingTotal: number;
};

export type OutletMonthResponse = {
  project: { id: string; name: string; type: string; workspaceId: string };
  canManageTargets: boolean;
  month: string;
  today: string;
  target: OutletTarget | null;
  summary: OutletSummary;
  events: OutletEvent[];
  /** Nights before this month that are over and still miss sales or pax, newest first (at most 50). */
  waitingEarlier: OutletEvent[];
  form: OutletForm;
  canManageSettings?: boolean;
  config: OutletReportConfig;
  guests: OutletGuests;
  /** Every day of the month with the target in force and its actuals. */
  days: OutletDay[];
  /** The dates of the month that set their own target. */
  dayTargets: OutletDayTarget[];
};

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/outlet-sales`;

/** Every query of one outlet starts with this, so a realtime ping refetches them all. */
export const outletKey = (projectId: string) => ["nexus", "outlet-sales", projectId] as const;
export const outletMonthKey = (projectId: string, month: string) => [...outletKey(projectId), "month", month] as const;
export const outletEventKey = (projectId: string, eventId: string) => [...outletKey(projectId), "event", eventId] as const;

export const outletApi = {
  month: (projectId: string, month: string) => apiFetch<OutletMonthResponse>(`${base(projectId)}?month=${encodeURIComponent(month)}`),
  event: (projectId: string, eventId: string) =>
    apiFetch<{ event: OutletEvent; form: OutletForm }>(`${base(projectId)}/events/${encodeURIComponent(eventId)}`),
  create: (projectId: string, payload: OutletEventWrite & { clientRequestId?: string }) =>
    apiFetch<OutletEvent>(`${base(projectId)}/events`, { method: "POST", body: JSON.stringify(payload) }),
  update: (projectId: string, eventId: string, payload: OutletEventWrite) =>
    apiFetch<OutletEvent>(`${base(projectId)}/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  remove: (projectId: string, eventId: string) =>
    apiFetch<{ success: boolean }>(`${base(projectId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" }),
  putTarget: (projectId: string, payload: { month: string; salesTarget?: number | null; paxTarget?: number | null }) =>
    apiFetch<OutletTarget>(`${base(projectId)}/targets`, { method: "PUT", body: JSON.stringify(payload) }),
  /** A date's own target: a key left out keeps its value, null clears that part (back to the month's share). */
  putDayTarget: (projectId: string, payload: { date: string; salesTarget?: number | null; paxTarget?: number | null }) =>
    apiFetch<OutletDayTarget>(`${base(projectId)}/day-targets`, { method: "PUT", body: JSON.stringify(payload) }),
  config: (projectId: string) => apiFetch<OutletConfigResponse>(`${base(projectId)}/config`),
  putConfig: (projectId: string, config: OutletReportConfig) =>
    apiFetch<OutletConfigResponse>(`${base(projectId)}/config`, { method: "PUT", body: JSON.stringify({ config }) }),
};

export const outletConfigKey = (projectId: string) => [...outletKey(projectId), "config"] as const;

/** The shareable link to the report form (members only: it opens NEXUS, which asks for a login). */
export function outletFormLink(projectId: string, eventId?: string | null): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const q = new URLSearchParams({ view: "form" });
  if (eventId) q.set("event", eventId);
  return `${origin}/projects/${encodeURIComponent(projectId)}?${q.toString()}`;
}
