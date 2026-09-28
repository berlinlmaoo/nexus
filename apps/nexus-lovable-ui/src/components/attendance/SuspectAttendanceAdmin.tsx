import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Camera, CheckCircle2, ChevronLeft, ChevronRight, Loader2, MapPin, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar } from "@/components/Avatar";
import { ApiError, fmtDate, fmtTime, nexusApi, type NexusSuspectItem, type NexusSuspectLevel, type NexusSuspectSide } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

/**
 * Absen Monitor (was "Fake GPS"; owner, 28–29 Sep 2026). Abnormal attendance per 28→27 period:
 * a fake location (FAKE), a selfie with no face in it (NOFACE, from the server's face check), or a
 * weak location signal (CHECK). Only PROOF of a fake location may be judged "Not valid" (the day
 * becomes TK): the phone itself reported a mock / simulated position, or an impossible jump. Any
 * card can be answered with a warning — a personal pop-up + push for that person, nothing else.
 */
function shiftPeriod(key: string, by: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Tab = "fake" | "noface" | "check" | "done";

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
      : tab === "noface" ? i.state === "open" && i.level === "NOFACE"
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
            <div className="font-bold">Absen Monitor</div>
            <p className="text-xs text-muted-foreground">
              Abnormal check-ins and check-outs: a faked location, or a selfie without a face. <b className="text-foreground">Not valid</b> is only
              possible with proof of fake GPS — the phone itself reported a fake-GPS app, or an impossible jump — and turns the day
              into TK (remaining day off first, then −150 XP). <b className="text-foreground">Send warning</b> only tells the person.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button aria-label="Previous period" disabled={!periodKey} onClick={() => periodKey && setPeriodKey(shiftPeriod(periodKey, -1))} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[8.5rem] text-center text-sm font-semibold tabular-nums">{list.data?.periodLabel ?? "…"}</span>
            <button aria-label="Next period" disabled={!periodKey || isCurrent} onClick={() => periodKey && setPeriodKey(shiftPeriod(periodKey, 1))} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {([["fake", "Fake GPS", c?.fakeOpen], ["noface", "No face", c?.noFaceOpen], ["check", "Worth a look", c?.checkOpen], ["done", "Reviewed", c ? c.valid + c.invalid : undefined]] as const).map(([k, label, n]) => (
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
          <div className="font-semibold">{tab === "fake" ? "No fake GPS this period" : tab === "noface" ? "Every selfie shows a face" : tab === "check" ? "Nothing to look at" : "Nothing reviewed yet"}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {tab === "fake" ? "No phone reported a mock location and nobody jumped impossibly far."
              : tab === "noface" ? "No check-in or check-out selfie without a face this period. Selfies are checked a few minutes after they arrive."
              : tab === "check" ? "No weak signals this period." : "Verdicts given this period show here."}
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
    <div className={cn("flex gap-3 rounded-xl border p-3", s.level === "FAKE" ? "border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30" : s.level === "NOFACE" ? "border-orange-200 bg-orange-50/60 dark:border-orange-900 dark:bg-orange-950/30" : s.level === "CHECK" ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20" : "border-border")}>
      {s.photoUrl
        ? <a href={s.photoUrl} target="_blank" rel="noreferrer"><img src={s.photoUrl} alt={`${label} selfie`} loading="lazy" className="h-20 w-16 shrink-0 rounded-lg object-cover ring-1 ring-border" /></a>
        : <div className="grid h-20 w-16 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground/40"><Camera className="h-5 w-5" /></div>}
      <div className="min-w-0 flex-1 space-y-1 text-xs">
        <div className="font-semibold">
          {label} <span className="tabular-nums text-muted-foreground">{s.at ? fmtTime(s.at) : "--:--"}</span>
          {s.offline && <span className="ml-1 rounded bg-muted px-1 text-[10px]">offline</span>}
          {s.photoUrl && <FaceChip count={s.faceCount} />}
        </div>
        {s.signals.length > 0
          ? <ul className="space-y-0.5">{s.signals.map((t) => <li key={t} className={s.level === "FAKE" ? "font-semibold text-rose-700 dark:text-rose-300" : s.level === "NOFACE" ? "font-semibold text-orange-700 dark:text-orange-300" : "text-amber-800 dark:text-amber-300"}>• {t}</li>)}</ul>
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

/** Faces found in a selfie by the server's face check; null = not checked yet. */
function FaceChip({ count }: { count: number | null }) {
  if (count == null) return <span className="ml-1 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">face: not checked</span>;
  if (count === 0) return <span className="ml-1 rounded bg-orange-100 px-1 text-[10px] font-bold text-orange-700 dark:bg-orange-950 dark:text-orange-300">no face</span>;
  return <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{count} {count === 1 ? "face" : "faces"}</span>;
}

const LEVEL_BADGE: Record<NexusSuspectLevel, { label: string; cls: string }> = {
  FAKE: { label: "Fake GPS", cls: "bg-rose-100 text-rose-700 ring-rose-200" },
  NOFACE: { label: "No face", cls: "bg-orange-100 text-orange-700 ring-orange-200" },
  CHECK: { label: "Worth a look", cls: "bg-amber-100 text-amber-800 ring-amber-200" },
};

/** "2026-09-27" → "27 September" (a day key, so no time zone shift). */
function longDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** The prefilled warning, per level. The BoD can edit it before sending. */
function defaultWarning(item: NexusSuspectItem) {
  const date = longDate(item.date);
  const sides: Array<[string, NexusSuspectSide | null]> = [["check-in", item.checkIn], ["check-out", item.checkOut]];
  const pick = (ok: (s: NexusSuspectSide) => boolean) => sides.find(([, s]) => s && ok(s))?.[0] ?? "check-in";
  if (item.level === "NOFACE") {
    const which = pick((s) => s.faceCount === 0);
    return `Your ${which} selfie on ${date} doesn't show your face. Attendance selfies must show your face clearly — next time it may count as absent.`;
  }
  if (item.level === "FAKE") {
    const which = pick((s) => s.level === "FAKE");
    return `Your ${which} on ${date} came from a fake location (a fake-GPS / mock-location app, or an impossible jump). Attendance must be taken where you really are — next time it may count as absent.`;
  }
  const which = pick((s) => s.level === "CHECK");
  return `Your ${which} location on ${date} looked unusual (the same coordinates as before, or an unlikely jump). Make sure location is on and fresh when you check in — next time it may count as absent.`;
}

function WarnDialog({ item, open, onClose, onSent }: { item: NexusSuspectItem; open: boolean; onClose: () => void; onSent: () => void }) {
  const [message, setMessage] = useState("");
  useEffect(() => { if (open) setMessage(defaultWarning(item)); }, [open, item]);
  const send = useMutation({
    mutationFn: () => nexusApi.warnSuspectAttendance(item.recordId, message.trim()),
    onSuccess: () => {
      toast.success(`Warning sent to ${item.user.name ?? "them"}`, { description: "They get a push and a pop-up." });
      onSent();
      onClose();
    },
    onError: (e: unknown) => toast.error("Couldn't send the warning", { description: e instanceof ApiError ? e.message : "Try again." }),
  });
  const len = message.trim().length;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send warning to {item.user.name ?? "this person"}</DialogTitle>
          <DialogDescription>
            They get a push notification and a personal pop-up with this message and the selfie. Their attendance for {longDate(item.date)} does not change.
          </DialogDescription>
        </DialogHeader>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={500}
          className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        <div className="text-right text-[11px] tabular-nums text-muted-foreground">{len}/500</div>
        <DialogFooter className="gap-2">
          <button onClick={onClose} className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold hover:bg-accent">Cancel</button>
          <button disabled={send.isPending || len < 3 || len > 500} onClick={() => send.mutate()}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />} Send warning
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuspectCard({ item, onDone }: { item: NexusSuspectItem; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [warning, setWarning] = useState(false);
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
          ? item.level && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold ring-1", LEVEL_BADGE[item.level].cls)}>{LEVEL_BADGE[item.level].label}</span>
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
      {(item.warnings?.length ?? 0) > 0 && (
        <div className="mt-3 space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex items-center gap-1 font-bold text-amber-800 dark:text-amber-300"><AlertTriangle className="h-3 w-3" /> {item.warnings!.length === 1 ? "Warning sent" : `${item.warnings!.length} warnings sent`}</div>
          {item.warnings!.map((w) => (
            <div key={w.at} className="text-muted-foreground">
              <span className="font-semibold text-foreground">{w.by.name ?? "BoD"}</span> · {fmtDate(w.at)} {fmtTime(w.at)} — “{w.message}”
            </div>
          ))}
        </div>
      )}
      {item.state === "open" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
            placeholder={fake ? "Note for them (required for Not valid)" : "Note (optional)"}
            className="min-w-[12rem] flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <button disabled={review.isPending} onClick={() => review.mutate("VALID")}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50">It's fine</button>
          <button disabled={review.isPending} onClick={() => setWarning(true)}
            className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-950/40 dark:text-amber-300">Send warning…</button>
          {fake && (confirming
            ? <button disabled={review.isPending || note.trim().length < 3} onClick={() => review.mutate("INVALID")}
                className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">Confirm: make it TK</button>
            : <button disabled={review.isPending} onClick={() => setConfirming(true)}
                className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:bg-rose-950/40">Not valid…</button>)}
        </div>
      )}
      {item.state === "valid" && (
        <div className="mt-3 flex justify-end">
          <button onClick={() => setWarning(true)}
            className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300">Send warning…</button>
        </div>
      )}
      {item.state !== "invalid" && <WarnDialog item={item} open={warning} onClose={() => setWarning(false)} onSent={onDone} />}
      {item.state === "open" && fake && confirming && (
        <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">This deletes the day's attendance (the evidence is kept) and counts it as TK. {note.trim().length < 3 ? "Write a note first — they will read it." : ""}</p>
      )}
    </div>
  );
}
