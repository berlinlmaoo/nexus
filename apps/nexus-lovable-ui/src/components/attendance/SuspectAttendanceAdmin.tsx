import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, Loader2, MapPin, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { ApiError, fmtDate, fmtTime, nexusApi, type NexusSuspectItem, type NexusSuspectSide } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

/**
 * Suspicious attendance (owner, 28 Sep 2026). Attendance the server flagged for its location, per
 * 28→27 period. Only PROOF of a fake location may be judged "Not valid" (the day becomes TK):
 * the phone itself reported a mock / simulated position, or an impossible jump. Weak signals (same
 * coordinates as last time, fast travel) are listed under "Worth a look" and can only be cleared.
 */
function shiftPeriod(key: string, by: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Tab = "fake" | "check" | "done";

export function SuspectAttendanceAdmin() {
  const qc = useQueryClient();
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("fake");
  const list = useQuery({
    queryKey: ["nexus", "attendance-suspects", periodKey ?? "current"],
    queryFn: () => nexusApi.suspectAttendance(periodKey ?? undefined),
    retry: false,
  });
  useEffect(() => { if (!periodKey && list.data) setPeriodKey(list.data.currentPeriodKey); }, [periodKey, list.data]);
  const items = list.data?.items ?? [];
  const shown = items.filter((i) =>
    tab === "fake" ? i.state === "open" && i.level === "FAKE"
      : tab === "check" ? i.state === "open" && i.level === "CHECK"
        : i.state !== "open");
  const c = list.data?.counts;
  const isCurrent = !!periodKey && periodKey === list.data?.currentPeriodKey;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["nexus", "attendance-suspects"] });
    qc.invalidateQueries({ queryKey: ["attendance-history"] });
    qc.invalidateQueries({ queryKey: ["attendance-dayoff-summary"] });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="flex flex-wrap items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-rose-600" />
          <div className="min-w-0 flex-1">
            <div className="font-bold">Suspicious attendance</div>
            <p className="text-xs text-muted-foreground">
              Check-ins and check-outs whose location looks faked. <b className="text-foreground">Not valid</b> is only
              possible with proof — the phone itself reported a fake-GPS app, or an impossible jump — and turns the day
              into TK (remaining day off first, then −150 XP). The person is told.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button aria-label="Previous period" disabled={!periodKey} onClick={() => periodKey && setPeriodKey(shiftPeriod(periodKey, -1))} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[8.5rem] text-center text-sm font-semibold tabular-nums">{list.data?.periodLabel ?? "…"}</span>
            <button aria-label="Next period" disabled={!periodKey || isCurrent} onClick={() => periodKey && setPeriodKey(shiftPeriod(periodKey, 1))} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {([["fake", "Fake GPS", c?.fakeOpen], ["check", "Worth a look", c?.checkOpen], ["done", "Reviewed", c ? c.valid + c.invalid : undefined]] as const).map(([k, label, n]) => (
            <button key={k} onClick={() => setTab(k)} className={cn("rounded-full px-3 py-1 text-xs font-semibold ring-1 transition", tab === k ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border hover:bg-accent")}>
              {label}{n != null && <span className="ml-1 tabular-nums opacity-80">{n}</span>}
            </button>
          ))}
        </div>
      </div>

      {list.isLoading && <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
      {list.isError && <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{list.error instanceof ApiError ? list.error.message : "Couldn't load. Try again."}</div>}
      {!list.isLoading && !list.isError && shown.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <ShieldCheck className="mx-auto mb-2 h-7 w-7 text-emerald-600" />
          <div className="font-semibold">{tab === "fake" ? "No fake GPS this period" : tab === "check" ? "Nothing to look at" : "Nothing reviewed yet"}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {tab === "fake" ? "No phone reported a mock location and nobody jumped impossibly far." : tab === "check" ? "No weak signals this period." : "Verdicts given this period show here."}
          </p>
        </div>
      )}
      <div className="grid gap-3">
        {shown.map((i) => <SuspectCard key={i.recordId} item={i} onDone={refresh} />)}
      </div>
    </div>
  );
}

function SideBlock({ label, s }: { label: string; s: NexusSuspectSide | null }) {
  if (!s) return (
    <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">{label}: —</div>
  );
  const maps = s.lat != null && s.lng != null ? `https://www.google.com/maps?q=${s.lat},${s.lng}` : null;
  return (
    <div className={cn("flex gap-3 rounded-xl border p-3", s.level === "FAKE" ? "border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30" : s.level === "CHECK" ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20" : "border-border")}>
      {s.photoUrl
        ? <a href={s.photoUrl} target="_blank" rel="noreferrer"><img src={s.photoUrl} alt={`${label} selfie`} loading="lazy" className="h-20 w-16 shrink-0 rounded-lg object-cover ring-1 ring-border" /></a>
        : <div className="grid h-20 w-16 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground/40"><Camera className="h-5 w-5" /></div>}
      <div className="min-w-0 flex-1 space-y-1 text-xs">
        <div className="font-semibold">{label} <span className="tabular-nums text-muted-foreground">{s.at ? fmtTime(s.at) : "--:--"}</span>{s.offline && <span className="ml-1 rounded bg-muted px-1 text-[10px]">offline</span>}</div>
        {s.signals.length > 0
          ? <ul className="space-y-0.5">{s.signals.map((t) => <li key={t} className={s.level === "FAKE" ? "font-semibold text-rose-700 dark:text-rose-300" : "text-amber-800 dark:text-amber-300"}>• {t}</li>)}</ul>
          : <div className="text-muted-foreground">No signal on this side.</div>}
        <div className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
          {s.address && <span className="truncate">{s.address.split(",").slice(0, 2).join(",")}</span>}
          {s.accuracyM != null && s.accuracyM > 0 && <span className="tabular-nums">±{Math.round(s.accuracyM)} m</span>}
          {maps && <a href={maps} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"><MapPin className="h-3 w-3" />Map</a>}
        </div>
      </div>
    </div>
  );
}

function SuspectCard({ item, onDone }: { item: NexusSuspectItem; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const review = useMutation({
    mutationFn: (verdict: "VALID" | "INVALID") => nexusApi.reviewSuspectAttendance(item.recordId, { verdict, note: note.trim() }),
    onSuccess: (r) => {
      onDone();
      toast.success(r.verdict === "INVALID" ? `${item.user.name ?? "Their"} ${fmtDate(item.date)} is now TK` : "Marked as fine", {
        description: r.verdict === "INVALID" ? "They were notified." : undefined,
      });
    },
    onError: (e: unknown) => toast.error("Couldn't save the verdict", { description: e instanceof ApiError ? e.message : "Try again." }),
  });
  const fake = item.level === "FAKE";
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <Avatar userId={item.user.id} name={item.user.name} avatar={item.user.image} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{item.user.name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{fmtDate(item.date)}{item.place ? ` · ${item.place}` : ""}</div>
        </div>
        {item.state === "open"
          ? <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold ring-1", fake ? "bg-rose-100 text-rose-700 ring-rose-200" : "bg-amber-100 text-amber-800 ring-amber-200")}>{fake ? "Fake GPS" : "Worth a look"}</span>
          : item.state === "invalid"
            ? <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200"><ShieldX className="h-3 w-3" />Not valid · TK</span>
            : <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200"><CheckCircle2 className="h-3 w-3" />Fine</span>}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <SideBlock label="Check-in" s={item.checkIn} />
        <SideBlock label="Check-out" s={item.checkOut} />
      </div>
      {item.review && (
        <div className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {item.review.verdict === "INVALID" ? "Not valid" : "Fine"} · {item.review.reviewedBy.name ?? "BoD"} · {fmtDate(item.review.reviewedAt)}
          {item.review.note && <span className="text-foreground"> — “{item.review.note}”</span>}
        </div>
      )}
      {item.state === "open" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
            placeholder={fake ? "Note for them (required for Not valid)" : "Note (optional)"}
            className="min-w-[12rem] flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <button disabled={review.isPending} onClick={() => review.mutate("VALID")}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50">It's fine</button>
          {fake && (confirming
            ? <button disabled={review.isPending || note.trim().length < 3} onClick={() => review.mutate("INVALID")}
                className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">Confirm: make it TK</button>
            : <button disabled={review.isPending} onClick={() => setConfirming(true)}
                className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:bg-rose-950/40">Not valid…</button>)}
        </div>
      )}
      {item.state === "open" && fake && confirming && (
        <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">This deletes the day's attendance (the evidence is kept) and counts it as TK. {note.trim().length < 3 ? "Write a note first — they will read it." : ""}</p>
      )}
    </div>
  );
}
