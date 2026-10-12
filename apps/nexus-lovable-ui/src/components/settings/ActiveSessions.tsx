import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, Monitor, Smartphone, Tablet, HelpCircle } from "lucide-react";
import { nexusApi, type NexusSession } from "@/lib/nexus-api";
import { describeDevice, type DeviceLabel } from "@/lib/device-label";
import { useLang } from "@/lib/lang";

type T = ReturnType<typeof useLang>["t"];

function deviceName(d: DeviceLabel, t: T): string {
  if (d.type === "app") {
    const app = d.platform === "ios" ? t("NEXUS app for iOS") : t("NEXUS app for Android");
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
  const rows = sessions.data?.sessions ?? [];
  const others = rows.filter((s) => !s.current).length;

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
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((s) => {
            const device = describeDevice(s.userAgent, s.client);
            const name = deviceName(device, t);
            const pending = revoke.isPending && revoke.variables === s.id;
            const meta = [
              s.ipAddress || null,
              s.current ? null : activeLabel(s.lastActiveAt, locale, t) || null,
              t("Signed in {date}", { date: startedLabel(s.createdAt, locale) }),
            ].filter(Boolean).join(" · ");
            return (
              <li key={s.id} className="flex items-center gap-3 p-3">
                <span className={s.current ? "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary" : "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"}>
                  <DeviceIcon kind={device.kind} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium" title={s.userAgent ?? undefined}>{name}</span>
                    {s.current && <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">{t("This device")}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{meta}</div>
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
          })}
        </ul>
      )}
      {(revoke.isError || revokeOthers.isError) && <p className="text-xs font-semibold text-destructive">{t("Couldn't sign that out. Try again.")}</p>}
    </div>
  );
}
