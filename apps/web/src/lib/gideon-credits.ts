// GIDEON credits (owner, 18 Oct 2026): the person's own balance for the composer meter, their usage history,
// and the Control Room panel's data. The server is the authority (src/lib/gideon-credits.ts); these types
// are copies of what its routes return and must not drift.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtime } from "@/lib/realtime";

export type CreditRole = "ONE_ABOVE_ALL" | "BOD" | "MANAGER" | "STAFF";

export type CreditSummary = {
  unlimited: boolean;
  role: CreditRole | null;
  dayKey: string;
  periodKey: string;
  period: { startKey: string; endKey: string; resetsAt: string };
  dayResetsAt: string;
  today: { used: number; limit: number; remaining: number; answers: number };
  pool: { used: number; limit: number; bonus: number; remaining: number };
  period_used: number;
  over: number;
  fallbackToday: number;
  fallbackPerDay: number;
  enforced: boolean;
  next: "ok" | "fallback" | "blocked";
};

export type CreditNotice = { kind: "fallback" | "blocked"; en: string; id: string };

export type CreditHistoryItem = {
  id: string;
  trigger: string;
  tier: string;
  requestedTier: string | null;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  credits: number;
  dailyCredits: number;
  poolCredits: number;
  overCredits: number;
  billable: boolean;
  unlimited: boolean;
  fallback: boolean;
  dayKey: string;
  periodKey: string;
  createdAt: string;
  title: string | null;
};

export type CreditHistory = {
  summary: CreditSummary;
  items: CreditHistoryItem[];
  nextBefore: string | null;
  days: { dayKey: string; credits: number; answers: number }[];
};

export type RoleLimit = { unlimited: boolean; daily: number; monthly: number };
export type CreditPolicy = { roles: Record<CreditRole, RoleLimit>; fallbackPerDay: number };

export type CreditAdminPerson = {
  id: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  role: CreditRole | null;
  limits: { role: CreditRole | null; unlimited: boolean; daily: number; monthly: number; bonus: number; overridden: boolean };
  override: { dailyLimit: number | null; monthlyLimit: number | null; unlimited: boolean | null; note: string | null; updatedAt: string } | null;
  today: { used: number; daily: number; answers: number } | null;
  period: { used: number; pool: number; over: number; answers: number; costMicroUsd: number };
  tiers: Record<string, { credits: number; answers: number }>;
};

export type CreditAdmin = {
  policy: CreditPolicy;
  enforced: boolean;
  periodKey: string;
  currentPeriodKey: string;
  dayKey: string;
  period: { startKey: string; endKey: string; resetsAt: string };
  isCurrent: boolean;
  people: CreditAdminPerson[];
  byRole: Record<CreditRole, { people: number; used: number; answers: number }>;
  totals: { used: number; answers: number; costMicroUsd: number };
};

export type CreditBonus = { id: string; userId: string; periodKey: string; credits: number; reason: string | null; grantedById: string; grantedByName: string | null; createdAt: string };

async function cjson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { Accept: "application/json", "Content-Type": "application/json", "X-Nexus-Client": "web/1", ...(init?.headers || {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export const CREDITS_KEY = ["gideon-credits"] as const;

export const fetchCredits = () => cjson<{ summary: CreditSummary }>("/api/gideon/credits").then((r) => r.summary);
export const fetchCreditHistory = (before?: string | null) =>
  cjson<CreditHistory>(`/api/gideon/credits?history=1&limit=40${before ? `&before=${encodeURIComponent(before)}` : ""}`);
export const fetchCreditAdmin = (periodKey?: string | null) => cjson<CreditAdmin>(`/api/gideon/credits/admin${periodKey ? `?period=${periodKey}` : ""}`);
export const saveCreditPolicy = (policy: CreditPolicy) => cjson<{ policy: CreditPolicy }>("/api/gideon/credits/admin", { method: "PUT", body: JSON.stringify({ policy }) });
export const saveCreditOverride = (body: { userId: string; dailyLimit: number | null; monthlyLimit: number | null; unlimited: boolean | null; note?: string | null }) =>
  cjson<{ ok: true; summary: CreditSummary }>("/api/gideon/credits/admin/override", { method: "PUT", body: JSON.stringify(body) });
export const grantCreditBonus = (body: { userId: string; credits: number; reason?: string | null }) =>
  cjson<{ bonus: CreditBonus; summary: CreditSummary }>("/api/gideon/credits/admin/bonus", { method: "POST", body: JSON.stringify(body) });
export const fetchCreditBonuses = (userId: string) => cjson<{ bonuses: CreditBonus[] }>(`/api/gideon/credits/admin/bonus?userId=${encodeURIComponent(userId)}`);

/**
 * The signed-in person's credits. Live: the socket `gideon-credits` (sent after every billed answer and every
 * admin change) replaces the cached summary, and the chat stream's `credits` event does the same in the tab
 * that asked. A refetch on focus covers a missed event.
 */
export function useGideonCredits(enabled = true) {
  const qc = useQueryClient();
  const { socket } = useRealtime();
  useEffect(() => {
    if (!socket) return;
    const on = (data: { summary?: CreditSummary | null }) => {
      if (data?.summary) qc.setQueryData(CREDITS_KEY, data.summary);
      else void qc.invalidateQueries({ queryKey: CREDITS_KEY });
      void qc.invalidateQueries({ queryKey: ["gideon-credit-history"] });
    };
    socket.on("gideon-credits", on);
    return () => { socket.off("gideon-credits", on); };
  }, [socket, qc]);
  return useQuery({ queryKey: CREDITS_KEY, queryFn: fetchCredits, enabled, staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 });
}

/** The tier's display name for a ledger row (the ids stay the server's). */
export const CREDIT_TIER_NAME: Record<string, string> = { astra: "Artemis", luna: "Phaëthon", terra: "Aphrodite", experimental: "Model 0" };
