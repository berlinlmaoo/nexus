import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Bot, Check, Clock, Loader2, ShieldCheck, X } from "lucide-react";
import nexusLogo from "@/assets/nexus-logo.png";
import { ApiError, nexusApi, type NexusMcpApproval } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

// Approval page for a change an assistant asked for over MCP (17 Nov 2026, server: lib/mcp-attendance.ts).
// The assistant sends this link to its owner (e.g. in WhatsApp). Only the owner's normal NEXUS web session can
// approve it; the assistant's token cannot. Signed out → /login, then back here.
export const Route = createFileRoute("/approve/mcp/$id")({ component: McpApprovalPage });

type Phase = "loading" | "ready" | "submitting" | "wrongUser" | "notFound" | "error";

const fmtXp = (n: number) => new Intl.NumberFormat("id-ID").format(n);

function McpApprovalPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const { t } = useLang();
  useTheme();
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<NexusMcpApproval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = async () => {
    try {
      const d = await nexusApi.mcpApproval(id);
      setData(d);
      setPhase("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        void navigate({ to: "/login", search: { callbackUrl: `/approve/mcp/${id}` } as never, replace: true });
        return;
      }
      const code = e instanceof ApiError ? (e.payload as { code?: string } | null)?.code : null;
      setPhase(code === "WRONG_USER" ? "wrongUser" : code === "NOT_FOUND" ? "notFound" : "error");
      setError(e instanceof Error ? e.message : null);
    }
  };
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);

  const decide = async (decision: "APPROVE" | "REJECT") => {
    if (!data || phase === "submitting") return;
    setPhase("submitting");
    setError(null);
    try {
      const r = await nexusApi.decideMcpApproval(id, decision, data.csrf);
      setDone(r.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't process your decision."));
    }
    await load();
  };

  const status = data?.status === "APPROVING" ? "PENDING" : data?.status;
  const left = data ? Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - now) / 1000)) : 0;
  const pending = status === "PENDING" && left > 0;

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-6 sm:py-10">
        <div className="flex items-center gap-3">
          <img src={nexusLogo} alt="NEXUS" className="h-9 w-9 object-contain" />
          <div className="min-w-0">
            <div className="text-sm font-bold">NEXUS</div>
            <div className="text-xs text-muted-foreground">{t("Approval request")}</div>
          </div>
        </div>

        {phase === "loading" && (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}
          </div>
        )}

        {(phase === "wrongUser" || phase === "notFound" || phase === "error") && (
          <div className="space-y-2 rounded-2xl border border-border bg-card p-6 text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-destructive/10"><AlertTriangle className="h-5 w-5 text-destructive" /></div>
            <h1 className="text-base font-bold">
              {phase === "wrongUser" ? t("This request isn't yours") : phase === "notFound" ? t("This link isn't valid") : t("Can't continue")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {phase === "wrongUser"
                ? t("It belongs to another NEXUS account. Only the person whose assistant asked for it can approve it.")
                : phase === "notFound" ? t("Check that you opened the whole link.") : error}
            </p>
          </div>
        )}

        {data && (phase === "ready" || phase === "submitting") && (
          <>
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10"><Bot className="h-5 w-5 text-primary" /></div>
                <div className="min-w-0">
                  <h1 className="text-base font-bold leading-snug">
                    {data.kind === "WAIVE_PENALTIES" ? t("Remove attendance deductions") : data.kind === "MARK_PRESENT" ? t("Mark a day present") : t("Fix check-in / check-out times")}
                  </h1>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("Asked by {app}", { app: data.app })} · {data.before?.person ?? "—"}
                    {data.kind !== "WAIVE_PENALTIES" && data.before?.date ? ` · ${data.before.date}` : ""}
                  </p>
                </div>
              </div>
              {data.reason && (
                <div className="mt-4 rounded-xl bg-muted px-3 py-2.5 text-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Reason")}</div>
                  <div className="mt-0.5 break-words">{data.reason}</div>
                </div>
              )}
            </div>

            {data.kind === "WAIVE_PENALTIES" ? <WaiverDetail data={data} /> : <CorrectionDetail data={data} />}

            <StatusBlock status={status ?? "PENDING"} left={left} done={done} error={error ?? data.error} />

            {pending && (
              <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
                <button onClick={() => decide("REJECT")} disabled={phase === "submitting"}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold transition hover:bg-accent active:scale-[0.98] disabled:opacity-60">
                  <X className="h-4 w-4" /> {t("Reject")}
                </button>
                <button onClick={() => decide("APPROVE")} disabled={phase === "submitting"}
                  className="flex min-h-11 flex-[1.4] items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60">
                  {phase === "submitting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {data.kind === "WAIVE_PENALTIES" ? t("Approve all") : t("Approve")}
                </button>
              </div>
            )}
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              {t("Signed in as {name}. Nothing changes until you approve.", { name: data.viewer?.name ?? data.viewer?.email ?? "—" })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function StatusBlock({ status, left, done, error }: { status: string; left: number; done: string | null; error?: string | null }) {
  const { t } = useLang();
  if (status === "PENDING" && left > 0) {
    const m = Math.floor(left / 60), s = String(left % 60).padStart(2, "0");
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" /> {t("Expires in {time}", { time: `${m}:${s}` })}
        {error && <span className="ml-auto font-semibold text-destructive">{error}</span>}
      </div>
    );
  }
  const tone = status === "APPROVED" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : status === "FAILED" ? "border-destructive/30 bg-destructive/10 text-destructive"
    : "border-border bg-muted text-muted-foreground";
  const text = status === "APPROVED" ? t("Approved and applied.")
    : status === "REJECTED" ? t("Rejected. Nothing was changed.")
    : status === "FAILED" ? t("Approved, but NEXUS refused to apply it. Nothing was changed.")
    : status === "PENDING" || status === "EXPIRED" ? t("This request expired. Nothing was changed. Ask for a new one.")
    : status;
  return (
    <div className={cn("rounded-xl border px-3 py-2.5 text-sm font-semibold", tone)}>
      {text}
      {status === "FAILED" && error && <div className="mt-1 text-xs font-normal">{error}</div>}
      {done && status !== done && <div className="mt-1 text-xs font-normal">{t("Someone already decided this request.")}</div>}
    </div>
  );
}

const dash = (v?: string | null) => v || "—";

function Row({ label, before, after }: { label: string; before: React.ReactNode; after: React.ReactNode }) {
  const changed = String(before) !== String(after);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-t border-border py-2 first:border-t-0">
      <div className="col-span-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="min-w-0 truncate text-sm text-muted-foreground">{before}</div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      <div className={cn("min-w-0 truncate text-sm", changed ? "font-bold text-foreground" : "text-muted-foreground")}>{after}</div>
    </div>
  );
}

function CorrectionDetail({ data }: { data: NexusMcpApproval }) {
  const { t } = useLang();
  const b = data.before ?? {};
  const a = data.after ?? {};
  const br = b.record ?? null;
  const ar = a.record ?? {};
  const p = b.penalties ?? {};
  const xp = (p.lateXp ?? 0) + (p.noCheckoutXp ?? 0) + (p.alphaXp ?? 0);
  const refunded = data.kind === "MARK_PRESENT" || Boolean(a.penalties?.refunded);
  const statusWord = (s?: string | null) => (s ? t(s === "COMPLETED" ? "Checked out" : s === "CHECKED_IN" ? "Checked in" : s) : t("No record"));
  const dayWord = (d?: string) => (d === "ABSENT" ? t("Absent (TK)") : d === "PRESENT" ? t("Present") : d ? t(d) : "—");
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-1 flex text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="flex-1">{t("Before")}</span><span className="flex-1 text-right">{t("After")}</span>
      </div>
      <Row label={t("Day")} before={dayWord(b.day?.dayType)} after={t("Present")} />
      <Row label={t("Check-in")} before={dash(br?.checkIn)} after={dash(ar.checkIn)} />
      <Row label={t("Check-out")} before={dash(br?.checkOut)} after={dash(ar.checkOut)} />
      <Row label={t("Status")} before={statusWord(br?.status)} after={statusWord(ar.status)} />
      <Row label={t("Late (minutes)")} before={br ? String(br.lateMinutes ?? 0) : "—"} after={String(ar.lateMinutes ?? 0)} />
      <div className="mt-3 rounded-xl bg-muted px-3 py-2.5 text-xs">
        {xp === 0 && !p.autoDayOffsDeducted
          ? t("No XP or day-off deduction on this day.")
          : refunded
            ? t("Deductions refunded: {xp} XP, {days} day off.", { xp: fmtXp(-xp), days: p.autoDayOffsDeducted ?? 0 })
            : t("Deductions stay ({xp} XP, {days} day off): the corrected day is still late or has no check-out.", { xp: fmtXp(-xp), days: p.autoDayOffsDeducted ?? 0 })}
        {(a.requestsCancelled?.length ?? 0) > 0 && <div className="mt-1">{t("Requests cancelled for this day: {list}", { list: a.requestsCancelled!.map((r) => r.type).join(", ") })}</div>}
        {data.flags?.checkOutDefaulted && <div className="mt-1">{t("No check-out time was given: it is set to the end of the shift.")}</div>}
        {(data.flags?.multiDayRequestTypes?.length ?? 0) > 0 && <div className="mt-1">{t("A multi-day request covers this day and is not changed.")}</div>}
      </div>
    </div>
  );
}

const ENTRY_LABEL: Record<string, string> = { XP_LATE: "Late check-in", XP_NOCHECKOUT: "No check-out", XP_ALPHA: "Absent (TK)", DAYOFF_AUTO: "Day off cut automatically" };

function WaiverDetail({ data }: { data: NexusMcpApproval }) {
  const { t } = useLang();
  const items = data.before?.items ?? [];
  const bal = data.after?.balances ?? [];
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Deductions to remove ({n} days)", { n: items.length })}</div>
      <div className="mt-2 divide-y divide-border">
        {items.map((it) => (
          <div key={it.date} className="py-2">
            <div className="text-sm font-semibold">{it.date}</div>
            {it.entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span className="min-w-0 truncate">{t(ENTRY_LABEL[e.kind] ?? e.label)}</span>
                <span className="shrink-0 font-semibold text-foreground">{e.unit === "XP" ? `+${fmtXp(-e.amount)} XP` : t("+1 day off")}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-1 rounded-xl bg-muted px-3 py-2.5 text-xs">
        <div>{t("Back in total: {xp} XP and {days} day off.", { xp: fmtXp(data.after?.xpRefunded ?? 0), days: data.after?.dayOffsRestored ?? 0 })}</div>
        {bal.map((b) => (
          <div key={b.period}>{t("Day off left in period {period}: {before} → {after} of {quota}", { period: b.period, before: b.remainingBefore, after: b.remainingAfter, quota: b.quota })}</div>
        ))}
        <div className="text-muted-foreground">{t("Each date is cleared as a whole day, like the remove button in the deduction log.")}</div>
      </div>
    </div>
  );
}
