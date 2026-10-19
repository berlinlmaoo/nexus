import { useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import { apiFetch } from "@/lib/nexus-api";
import { useLang, type Lang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * Presence status (owner, 19 Oct 2026): the dot on avatars, the line under a name, the DM header. The server decides
 * everything (src/lib/presence-core.ts); this file only fetches, keeps it live and draws it.
 *
 *   GET /api/presence → { enabled, statuses } once, cached under PRESENCE_KEY;
 *   socket `presence-changed` { userId, status } patches that cache in place (bindPresenceSocket, from lib/realtime.tsx);
 *   a reconnect refetches (a change sent while offline is gone).
 * `enabled:false` (remote config off) → nothing is drawn anywhere.
 */

export type PresenceState = "online" | "away" | "dnd" | "sick" | "leave" | "not_checked_in" | "offline";
/** N-1 (19 Oct 2026): what a manual status shows — Online · / Away · / Do not disturb ·. */
export type PresenceAvailability = "online" | "away" | "dnd";
export type PresenceTone = "green" | "yellow" | "red" | "grey" | "black";
export type PresenceStatus = {
  userId: string;
  state: PresenceState;
  tone: PresenceTone;
  reason: string;
  text: string | null;
  /** The running manual status's availability; null when none is running (older servers: absent). */
  availability?: PresenceAvailability | null;
  label: { en: string; id: string };
  until: string | null;
  since: string | null;
  manual: { id: string; text: string; startsAt: string; endsAt: string; availability?: PresenceAvailability } | null;
};
type PresenceList = { enabled: boolean; statuses: PresenceStatus[]; serverTime?: string };

export const PRESENCE_KEY = ["nexus", "presence"] as const;

export const presenceApi = {
  list: () => apiFetch<PresenceList>("/api/presence"),
  setManual: (body: { text: string; startsAt?: string | null; endsAt: string; availability?: PresenceAvailability }) =>
    apiFetch<{ manual: PresenceStatus["manual"]; status: PresenceStatus | null }>("/api/presence/manual", { method: "PUT", body: JSON.stringify(body) }),
  clearManual: (id?: string | null) =>
    apiFetch<{ cleared: number; status: PresenceStatus | null }>(`/api/presence/manual${id ? `?id=${encodeURIComponent(id)}` : ""}`, { method: "DELETE" }),
};

/** userId → status, shared by every avatar on the page (one request, then live). */
export function usePresenceMap(): { enabled: boolean; map: Map<string, PresenceStatus> } {
  const q = useQuery({ queryKey: PRESENCE_KEY, queryFn: presenceApi.list, retry: false, staleTime: 5 * 60_000, refetchOnWindowFocus: true });
  return useMemo(() => {
    const map = new Map<string, PresenceStatus>();
    for (const s of q.data?.statuses ?? []) map.set(s.userId, s);
    return { enabled: q.data?.enabled === true, map };
  }, [q.data]);
}

export function usePresence(userId: string | null | undefined): PresenceStatus | null {
  const { enabled, map } = usePresenceMap();
  return enabled && userId ? (map.get(userId) ?? null) : null;
}

/** Put one status into the cache (a realtime event, or the answer of a set/clear). */
export function patchPresence(qc: QueryClient, status: PresenceStatus | null | undefined) {
  if (!status?.userId) return;
  qc.setQueryData<PresenceList>(PRESENCE_KEY, (cur) => {
    if (!cur) return cur;
    const rest = cur.statuses.filter((s) => s.userId !== status.userId);
    return { ...cur, statuses: [...rest, status] };
  });
}

/** Called once by the realtime provider; returns the cleanup. */
export function bindPresenceSocket(socket: Socket, qc: QueryClient): () => void {
  const onChanged = (payload?: unknown) => {
    const data = (payload && typeof payload === "object" ? payload : {}) as { status?: PresenceStatus };
    if (data.status && typeof data.status.userId === "string") patchPresence(qc, data.status);
  };
  let first = true;
  const onConnect = () => {
    if (!first) void qc.invalidateQueries({ queryKey: PRESENCE_KEY });
    first = false;
  };
  socket.on("presence-changed", onChanged);
  socket.on("connect", onConnect);
  return () => {
    socket.off("presence-changed", onChanged);
    socket.off("connect", onConnect);
  };
}

/** The status in the interface language. */
export function presenceText(s: PresenceStatus, lang: Lang): string {
  return lang === "id" ? s.label.id : s.label.en;
}

/** "until 20:00" / "until Tue 21 Oct" in the interface language (WIB shown as the browser's clock is in WIB for everyone). */
export function presenceUntil(s: PresenceStatus, lang: Lang, t: (en: string, v?: Record<string, string | number>) => string): string | null {
  if (!s.until) return null;
  const locale = lang === "id" ? "id-ID" : "en-GB";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.until)) {
    const d = new Date(`${s.until}T00:00:00Z`);
    return t("until {when}", { when: d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) });
  }
  const d = new Date(s.until);
  const sameDay = d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }) === new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
  return t("until {when}", { when: sameDay ? time : `${d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta" })} ${time}` });
}

/**
 * Dot colours. Green and red are the usual (red = Sick leave and Do not disturb); Away is amber; Leave / Not checked in are a hollow grey ring (⚪, "no
 * attendance expected / not yet"), Offline a solid slate dot (⚫). Each tone differs in shape or fill as well as
 * colour, so the five read apart without colour (and the label is always next to it or in the tooltip).
 */
const DOT: Record<PresenceTone, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-rose-500",
  grey: "bg-background ring-[2px] ring-inset ring-slate-400 dark:ring-slate-400",
  black: "bg-slate-500 dark:bg-slate-500",
};

export function PresenceDot({ status, size = 10, className, ring = true }: { status: PresenceStatus; size?: number; className?: string; ring?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rounded-full", DOT[status.tone], ring && "outline outline-2 outline-background", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** "● Away · Potong rambut · until 20:00" — the line under a name. */
export function PresenceLine({ userId, className, showUntil = true }: { userId: string | null | undefined; className?: string; showUntil?: boolean }) {
  const { lang, t } = useLang();
  const s = usePresence(userId);
  if (!s) return null;
  const until = showUntil ? presenceUntil(s, lang, t) : null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground", className)} title={presenceText(s, lang)}>
      <PresenceDot status={s} size={8} ring={false} />
      <span className="truncate">
        <span className={cn("font-medium", s.tone === "green" && "text-emerald-700 dark:text-emerald-300", s.tone === "yellow" && "text-amber-700 dark:text-amber-300", s.tone === "red" && "text-rose-700 dark:text-rose-300")}>{presenceText(s, lang)}</span>
        {until && <span> · {until}</span>}
      </span>
    </span>
  );
}

/** A soft chip version (profile header). */
export function PresenceChip({ userId, className }: { userId: string | null | undefined; className?: string }) {
  const { lang, t } = useLang();
  const s = usePresence(userId);
  if (!s) return null;
  const until = presenceUntil(s, lang, t);
  const tone = {
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/25",
    yellow: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25",
    red: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/25",
    grey: "bg-muted text-foreground/80 ring-border",
    black: "bg-muted text-muted-foreground ring-border",
  }[s.tone];
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1", tone, className)}>
      <PresenceDot status={s} size={8} ring={false} />
      <span className="truncate">{presenceText(s, lang)}</span>
      {until && <span className="shrink-0 font-normal opacity-80">· {until}</span>}
    </span>
  );
}
