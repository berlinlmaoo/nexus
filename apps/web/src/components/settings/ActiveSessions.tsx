import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronDown, Loader2, LogOut, Monitor, Smartphone, Tablet, HelpCircle } from "lucide-react";
import { formatCount } from "@/lib/number-format";
import { nexusApi, type NexusSession } from "@/lib/nexus-api";
import { describeDevice, type DeviceLabel } from "@/lib/device-label";
import { useLang } from "@/lib/lang";

type T = ReturnType<typeof useLang>["t"];

function deviceName(d: DeviceLabel, t: T): string {
  if (d.type === "app") {
    // The iOS-family app says in its User-Agent whether it runs on a Mac, an iPad or an iPhone (run 12); older
    // sessions do not, and keep "NEXUS app for iOS".
    const app = d.platform === "android" ? t("NEXUS app for Android")
      : d.os === "macOS" ? t("NEXUS app for macOS")
      : d.os === "iPadOS" ? t("NEXUS app for iPadOS")
      : t("NEXUS app for iOS");
    if (d.version) return d.build ? `${app} ${d.version} (${d.build})` : `${app} ${d.version}`;
    return d.build ? `${app} (${t("build {n}", { n: d.build })})` : app;
  }
  if (d.type === "browser") {
    if (d.browser && d.os) return t("{browser} on {os}", { browser: d.browser, os: d.os });
    return d.browser ?? d.os ?? t("Unknown device");
  }
  return t("Unknown device");
}

/** "Active now" under 5 minutes (lastActiveAt is written at most every 5), else "Active 3 hours ago". */
function activeLabel(iso: string | null | undefined, locale: string, t: T): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  if (ms < 5 * 60_000) return t("Active now");
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const min = Math.round(ms / 60_000);
  const rel =
    min < 60 ? rtf.format(-min, "minute")
    : min < 60 * 24 ? rtf.format(-Math.round(min / 60), "hour")
    : min < 60 * 24 * 30 ? rtf.format(-Math.round(min / 1440), "day")
    : new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  return t("Active {time}", { time: rel });
}

function startedLabel(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

function DeviceIcon({ kind }: { kind: DeviceLabel["kind"] }) {
  const Icon = kind === "phone" ? Smartphone : kind === "tablet" ? Tablet : kind === "desktop" ? Monitor : HelpCircle;
  return <Icon className="h-4 w-4" aria-hidden />;
}

/**
 * The address worth showing: a public client IP. A private, loopback or CGNAT address is a proxy hop or a
 * local network (UI tour run 14: every row read the same internal address), so it is left out. The server
 * already sends null for those; this guards an older server.
 */
function publicIp(raw: string | null | undefined): string | null {
  const ip = (raw ?? "").trim().replace(/^::ffff:/i, "");
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    const local = a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    return local ? null : ip;
  }
  if (!ip.includes(":")) return null;
  const low = ip.toLowerCase();
  return low === "::1" || /^f[cd]/.test(low) || /^fe[89ab]/.test(low) ? null : ip;
}

/**
 * A meta line whose " · " separators stay with the word before them: each part is unbreakable, so a
 * wrapped line never starts with "·" (UI tour run 14, R14-WM-24).
 */
function Meta({ parts }: { parts: (string | null | false | undefined)[] }) {
  const list = parts.filter((p): p is string => !!p);
  if (list.length === 0) return null;
  return (
    <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
      {list.map((p, i) => (
        <span key={i}>
          <span className="whitespace-nowrap">{p}{i < list.length - 1 ? " ·" : ""}</span>
          {i < list.length - 1 ? " " : ""}
        </span>
      ))}
    </div>
  );
}

type SessionGroup = { key: string; name: string; device: DeviceLabel; sessions: NexusSession[]; unknown: boolean };

/**
 * Sessions grouped by the device they name (UI tour run 14, R14-WB-8: about 45 rows, most of them repeated
 * "Chrome on Linux" or "Unknown device"). This device first; then one row per device name, newest
 * activity first, "Unknown device" last. A group of one is a plain session row; a larger group shows its
 * count, its latest activity, "Sign out all", and expands to the single sessions.
 */
function groupSessions(rows: NexusSession[], t: T): SessionGroup[] {
  const current: SessionGroup[] = [];
  const byName = new Map<string, SessionGroup>();
  for (const s of rows) {
    const device = describeDevice(s.userAgent, s.client);
    const name = deviceName(device, t);
    if (s.current) { current.push({ key: `current:${s.id}`, name, device, sessions: [s], unknown: false }); continue; }
    let g = byName.get(name);
    if (!g) { g = { key: `name:${name}`, name, device, sessions: [], unknown: device.type !== "app" && device.type !== "browser" }; byName.set(name, g); }
    g.sessions.push(s);
  }
  const last = (s: NexusSession) => new Date(s.lastActiveAt ?? s.createdAt ?? 0).getTime() || 0;
  const rest = [...byName.values()];
  for (const g of rest) g.sessions.sort((a, b) => last(b) - last(a));
  rest.sort((a, b) => Number(a.unknown) - Number(b.unknown) || last(b.sessions[0]) - last(a.sessions[0]));
  return [...current, ...rest];
}

/** "NEXUS app for iOS 0.1.7 (14)": the version and its build never part across lines. */
function keepVersion(name: string): string {
  return name.replace(/(\d[\d.]*) \((\d+)\)/g, "$1\u00a0($2)");
}

/**
 * Settings → Security → Active sessions: every device signed in to this account (server:
 * src/lib/user-sessions.ts), this one first. Signing one out ends it on that device's next request.
 */
export function ActiveSessions() {
  const { t, locale } = useLang();
  const qc = useQueryClient();
  const key = ["nexus", "sessions"] as const;
  const sessions = useQuery({ queryKey: key, queryFn: nexusApi.userSessions, retry: false, refetchOnWindowFocus: true });
  const drop = (ids: (s: NexusSession) => boolean) =>
    qc.setQueryData<{ sessions: NexusSession[] }>(key, (old) => (old ? { sessions: old.sessions.filter((s) => !ids(s)) } : old));
  const revoke = useMutation({
    mutationFn: (id: string) => nexusApi.revokeSession(id),
    onSuccess: (_r, id) => { drop((s) => s.id === id); qc.invalidateQueries({ queryKey: key }); },
  });
  const revokeOthers = useMutation({
    mutationFn: () => nexusApi.revokeOtherSessions(),
    onSuccess: () => { drop((s) => !s.current); qc.invalidateQueries({ queryKey: key }); },
  });
  const revokeMany = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await nexusApi.revokeSession(id); },
    onSuccess: (_r, ids) => { const gone = new Set(ids); drop((s) => gone.has(s.id)); qc.invalidateQueries({ queryKey: key }); },
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const rows = sessions.data?.sessions ?? [];
  const others = rows.filter((s) => !s.current).length;
  const groups = useMemo(() => groupSessions(rows, t), [rows, t]);

  /** One session: device, then "Active 3 hours ago · Signed in 14 Oct" (the address only when it is a real client IP). */
  const sessionRow = (s: NexusSession, name: string, device: DeviceLabel, nested?: boolean) => {
    const pending = revoke.isPending && revoke.variables === s.id;
    return (
      <li key={s.id} className="flex items-center gap-3 p-3">
        {!nested && (
          <span className={s.current ? "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary" : "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"}>
            <DeviceIcon kind={device.kind} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {!nested && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-sm font-medium [overflow-wrap:anywhere]" title={s.userAgent ?? undefined}>{keepVersion(name)}</span>
              {s.current && <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">{t("This device")}</span>}
            </div>
          )}
          <Meta
            parts={[
              publicIp(s.ipAddress),
              s.current ? null : activeLabel(s.lastActiveAt, locale, t) || null,
              t("Signed in {date}", { date: startedLabel(s.createdAt, locale) }),
            ]}
          />
        </div>
        {!s.current && (
          <button
            disabled={pending}
            onClick={() => { if (confirm(t("Sign out “{name}”? That device will need to sign in again.", { name }))) revoke.mutate(s.id); }}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition hover:bg-destructive/10 hover:text-destructive active:scale-[0.97] disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("Sign out")}
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{t("Active sessions")}</h2>
          <p className="text-xs text-muted-foreground">{t("Devices signed in to your account. Sign out any you don't recognise.")}</p>
        </div>
        {others > 0 && (
          <button
            disabled={revokeOthers.isPending}
            onClick={() => { if (confirm(t("Sign out of every other device? They will need to sign in again. This device stays signed in."))) revokeOthers.mutate(); }}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-destructive/10 hover:text-destructive active:scale-[0.97] disabled:opacity-50"
          >
            {revokeOthers.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />} {t("Sign out other sessions")}
          </button>
        )}
      </div>

      {sessions.isLoading && <p className="text-sm text-muted-foreground">{t("Loading…")}</p>}
      {sessions.isError && <p className="text-sm text-muted-foreground">{t("Couldn't load your sessions. Reload the page to try again.")}</p>}
      {!sessions.isLoading && !sessions.isError && rows.length === 0 && <p className="text-sm text-muted-foreground">{t("No active sessions.")}</p>}

      {rows.length > 0 && (
        <ul data-snap-rows className="divide-y divide-border rounded-lg border border-border">
          {groups.map((g) => {
            const first = g.sessions[0];
            if (g.sessions.length === 1) return sessionRow(first, g.name, g.device);
            const open = !!expanded[g.key];
            const ids = g.sessions.map((s) => s.id);
            const pending = revokeMany.isPending && revokeMany.variables?.[0] === ids[0];
            return (
              <li key={g.key}>
                <div className="flex items-center gap-3 p-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <DeviceIcon kind={g.device.kind} />
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* The count always on its own line under the name (UI tour run 15, R15-WM-9: inline after a short
                        name, on its own line after a long one), and a version stays whole: "0.1.7 (14)". */}
                    <div className="text-sm font-medium [overflow-wrap:anywhere]">{keepVersion(g.name)}</div>
                    <span className="mt-0.5 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums">{t("{n} sessions", { n: formatCount(g.sessions.length) })}</span>
                    <Meta parts={[activeLabel(first.lastActiveAt, locale, t) || null]} />
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setExpanded((e) => ({ ...e, [g.key]: !open }))}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      <ChevronDown className={open ? "h-3.5 w-3.5 rotate-180 transition" : "h-3.5 w-3.5 transition"} aria-hidden />
                      {open ? t("Hide sessions") : t("Show all {n}", { n: formatCount(g.sessions.length) })}
                    </button>
                  </div>
                  <button
                    disabled={pending}
                    onClick={() => { if (confirm(t("Sign out all {n} sessions of “{name}”? Those devices will need to sign in again.", { n: formatCount(g.sessions.length), name: g.name }))) revokeMany.mutate(ids); }}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition hover:bg-destructive/10 hover:text-destructive active:scale-[0.97] disabled:opacity-50"
                  >
                    {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("Sign out all")}
                  </button>
                </div>
                {open && (
                  <ul className="divide-y divide-border border-t border-border bg-muted/30 pl-6">
                    {g.sessions.map((s) => sessionRow(s, g.name, g.device, true))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(revoke.isError || revokeOthers.isError || revokeMany.isError) && <p className="text-xs font-semibold text-destructive">{t("Couldn't sign that out. Try again.")}</p>}
    </div>
  );
}
