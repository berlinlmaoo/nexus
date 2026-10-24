import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, FileText, Loader2, Paperclip, Pencil, Scale, TriangleAlert, X } from "lucide-react";
import { celebrate } from "@/components/Celebration";
import { nexusApi } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { fmtDayKey } from "@/components/reports/report-format";

// Moved here unchanged from routes/_app/attendance.tsx (28 Sep 2026) so the member record page offers
// the same panel; it now also refreshes that page ("member-record") after a change.
// English source labels; translated where they are shown.
const OVERRIDE_LABEL: Record<string, string> = { PRESENT: "Present", PERMIT: "Permit", LEAVE: "Leave", SICK: "Sick", DAY_OFF: "Day off" };

type Action = "PRESENT" | "LEAVE" | "SICK" | "DAY_OFF" | "PERMIT" | "CLEAR_PENALTY";

/** What the day is before the change, as the board shows it (mirrors src/lib/attendance-override-evidence.ts). */
export type OverrideDayState = "PRESENT" | "PERMIT" | "SICK" | "LEAVE" | "DAY_OFF" | "ABSENT" | "NONE";

/** The day's state from a history row (or nothing when the day has no row). */
export function overrideDayStateOf(row: { requestType?: string | null; checkInAt?: string | null; recordKind?: string | null } | null | undefined): OverrideDayState {
  const t = (row?.requestType || "").toUpperCase();
  if (t === "PERMIT") return "PERMIT";
  if (row?.checkInAt) return "PRESENT";
  if (t === "SICK") return "SICK";
  if (t === "LEAVE") return "LEAVE";
  if (t === "DAY_OFF" || t === "RED_DATE") return "DAY_OFF";
  return row?.recordKind === "ABSENT" ? "ABSENT" : "NONE";
}

/**
 * Owner rule (20 Oct 2026): → Sick asks for the sick note, → Permit and Permit / TK / nothing → Present ask
 * for a supporting photo or file. Optional: the change saves without it and is marked "no evidence attached".
 * Same rule as the server (lib/attendance-override-evidence.ts overrideEvidenceKind).
 */
export function overrideAsksForEvidence(action: string, from: OverrideDayState): "SICK_NOTE" | "SUPPORTING" | null {
  if (action === "SICK") return "SICK_NOTE";
  if (action === "PERMIT") return "SUPPORTING";
  if (action === "PRESENT" && (from === "PERMIT" || from === "ABSENT" || from === "NONE")) return "SUPPORTING";
  return null;
}

const ACCEPT = "image/*,application/pdf,.heic,.heif";
const MAX_BYTES = 10 * 1024 * 1024;

/** The upload field for an override's evidence: take a photo (camera on a phone) or pick a photo/PDF. */
export function EvidencePicker({ kind, file, onChange, disabled }: { kind: "SICK_NOTE" | "SUPPORTING"; file: File | null; onChange: (f: File | null) => void; disabled?: boolean }) {
  const { t } = useLang();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > MAX_BYTES) { setError(t("The file must be smaller than 10 MB.")); return; }
    const okType = /^image\//i.test(f.type) || f.type === "application/pdf" || /\.(jpe?g|png|heic|heif|webp|gif|pdf)$/i.test(f.name);
    if (!okType) { setError(t("Attach a photo or a PDF.")); return; }
    setError(null);
    onChange(f);
  };
  const hint = kind === "SICK_NOTE" ? t("Attach the sick note") : t("Attach a supporting photo or file");
  const btn = "inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold transition hover:border-ring hover:text-primary disabled:opacity-50";
  return (
    <div className="rounded-xl border border-primary/30 bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs font-bold text-foreground"><Paperclip className="h-3.5 w-3.5 text-primary" /> {hint}</div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{t("Optional. Photo or PDF, up to 10 MB. Saved without it, the day is marked “no evidence attached”.")}</p>
      {file ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2 text-xs">
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate font-semibold" title={file.name}>{file.name}</span>
          <button type="button" disabled={disabled} onClick={() => onChange(null)} aria-label={t("Remove file")} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" disabled={disabled} onClick={() => cameraRef.current?.click()} className={btn}><Camera className="h-3.5 w-3.5" /> {t("Take photo")}</button>
          <button type="button" disabled={disabled} onClick={() => fileRef.current?.click()} className={btn}><Paperclip className="h-3.5 w-3.5" /> {t("Choose file")}</button>
        </div>
      )}
      {error && <p className="mt-1.5 text-[11px] font-semibold text-destructive">{error}</p>}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

/** The evidence stored on a day (or the "no evidence attached" mark), for the record detail views. */
export function OverrideEvidenceView({ url, name, missing, label }: { url?: string | null; name?: string | null; missing?: boolean | null; label?: string }) {
  const { t } = useLang();
  if (!url && !missing) return null;
  if (!url) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> {t("No evidence attached")}
      </div>
    );
  }
  const isPhoto = /\.(jpe?g|png|heic|heif|webp|gif)$/i.test((url.split(/[?#]/)[0]) || "") || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(name ?? "");
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 rounded-xl border border-border bg-background p-1 pr-3 text-xs font-semibold transition hover:bg-accent">
      {isPhoto
        ? <img src={url} alt={label ?? t("Evidence")} loading="lazy" className="h-12 w-12 shrink-0 rounded-lg bg-muted object-cover" />
        : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><FileText className="h-4 w-4" /></span>}
      <span className="min-w-0"><span className="block truncate">{label ?? t("Evidence")}</span>{name && <span className="block truncate text-[11px] font-normal text-muted-foreground">{name}</span>}</span>
    </a>
  );
}

/** BoD-only: rewrite one member-day's status (Hadir on-time / Cuti / Sakit / Day off) — XP penalties
 *  for that day are refunded + an auto-cut day-off restored — or just remove the punishment.
 *  `current` is what the day is now; it decides whether the change asks for evidence (owner 20 Oct 2026). */
export function StatusOverridePanel({ userId, name, dateKey, onDone, current = "NONE" }: { userId: string; name: string | null; dateKey: string; onDone: () => void; current?: OverrideDayState }) {
  const qc = useQueryClient();
  const { t } = useLang();
  const label = (a: string) => (OVERRIDE_LABEL[a] ? t(OVERRIDE_LABEL[a]) : a);
  // The day as the board header shows it ("4 Oct"), not the ISO key the API takes (visual QA 24 Oct 2026).
  const day = fmtDayKey(dateKey);
  // An action that asks for evidence opens this step instead of the plain confirm.
  const [pending, setPending] = useState<{ action: Action; kind: "SICK_NOTE" | "SUPPORTING" } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const override = useMutation({
    mutationFn: ({ action, evidence }: { action: Action; evidence?: File | null }) => nexusApi.attendanceOverride({ userId, date: dateKey, action, evidence: evidence ?? null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["attendance-history"] });
      qc.invalidateQueries({ queryKey: ["attendance-requests"] });
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      qc.invalidateQueries({ queryKey: ["member-record"] });
      if (r.action === "CLEAR_PENALTY") {
        celebrate(r.refunded ? t("Penalty for {date} cleared. XP and day off restored.", { date: fmtDayKey(r.date) }) : t("No penalty on {date}. This day stays safe from deductions.", { date: fmtDayKey(r.date) }));
      } else {
        celebrate(`${name ?? "Staff"} · ${fmtDayKey(r.date)} → ${label(r.action)}${r.refunded ? " " + t("(penalty restored)") : ""}`);
      }
      if ((r.multiDayRequestsLeft ?? 0) > 0) {
        alert(t("Note: this date is still covered by {n} multi-day request(s) (leave or permit over several days). If this day should show as Present, change that request in the Requests section.", { n: r.multiDayRequestsLeft ?? 0 }));
      }
      setPending(null);
      setFile(null);
      onDone();
    },
    onError: (e) => alert(e instanceof Error ? e.message : t("Couldn’t change the status.")),
  });
  const ask = (action: Action) => {
    const kind = overrideAsksForEvidence(action, current);
    if (kind) { setFile(null); setPending({ action, kind }); return; }
    const what = action === "CLEAR_PENALTY"
      ? t("Clear the penalty for {date} for {name}?\n\nDeducted XP (late, forgot to check out, no-show) is refunded and any day off taken automatically is restored. The attendance status does NOT change.", { date: day, name: name ?? t("this staff member") })
      : t("Change {date} ({name}) to {status}?\n\nThat day’s automatic XP and day-off deductions are restored too.", { date: day, name: name ?? t("this staff member"), status: label(action) });
    if (window.confirm(what)) override.mutate({ action });
  };
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-ring/40 bg-primary/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary"><Pencil className="h-3.5 w-3.5" /> {t("Change status (board)")}</div>
      {pending ? (
        <div className="space-y-2.5">
          <p className="text-sm font-semibold">{t("Change {date} ({name}) to {status}", { date: day, name: name ?? t("this staff member"), status: label(pending.action) })}</p>
          <EvidencePicker kind={pending.kind} file={file} onChange={setFile} disabled={override.isPending} />
          <p className="text-[11px] text-muted-foreground">{t("That day’s automatic XP and day-off deductions are restored too.")}</p>
          <div className="flex gap-2">
            <button type="button" disabled={override.isPending} onClick={() => { setPending(null); setFile(null); }} className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold transition hover:bg-accent disabled:opacity-50">{t("Cancel")}</button>
            <button type="button" disabled={override.isPending} onClick={() => override.mutate({ action: pending.action, evidence: file })} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
              {override.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {file ? t("Save") : t("Save without evidence")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(["PRESENT", "PERMIT", "LEAVE", "SICK", "DAY_OFF"] as const).map((a) => (
              <button key={a} disabled={override.isPending} onClick={() => ask(a)} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold transition hover:border-ring hover:text-primary disabled:opacity-50">
                {label(a)}
              </button>
            ))}
          </div>
          <button disabled={override.isPending} onClick={() => ask("CLEAR_PENALTY")} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15">
            {override.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scale className="h-3.5 w-3.5" />} {t("Clear penalty (restore XP and day off)")}
          </button>
          <p className="mt-1.5 text-[10px] text-muted-foreground">{t("Every action restores that day’s XP and day-off deductions automatically, and is recorded in the audit log.")}</p>
        </>
      )}
    </div>
  );
}
