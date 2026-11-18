import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Loader2, Minus, Plus, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/PageLayout";
import { PrintPreview } from "@/components/print/PrintPreview";
import { PrinterStatusPanel } from "@/components/print/PrinterStatusPanel";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import {
  PRINT_LOG_KEY, disconnectedText, printToastId, jobErrorText, pageRangeCount, pageSet, printApi, printErrorText, statusLabel, usePrinterStatus, usePrinting,
  type ColorMode, type PrintJob, type PrintKind,
} from "@/lib/print-api";

/**
 * Print a Legal document, a Doc page or an uploaded file on the office printer (owner, 18 Nov 2026). Left: the pages
 * that will print (the exact PDF, thumbnails); right: the printer's live status, copies (1–5), Color / Black & white,
 * pages (uploads), Print. After Print the dialog follows the job until the printer says it is done or
 * failed (GET /api/print/jobs/{id}); closing it early is fine, a toast reports the end and Settings › Print log
 * keeps every print.
 */
export function PrintDialog({ open, onOpenChange, kind, id, title, version, pages, onSent, onEnded }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PrintKind;
  id: string;
  /** What is printed, shown under the title. */
  title: string;
  /** Legal: a version other than the primary one. */
  version?: number;
  /** An uploaded file (Print menu): its page count; the dialog then offers a page range ("1-3,5"). */
  pages?: number;
  /** The printer took the job (or it failed at once): an uploaded file is the server's to delete from here on. */
  onSent?: (job: PrintJob) => void;
  /** The job ended (done or failed). */
  onEnded?: (job: PrintJob) => void;
}) {
  const { t, tn, lang } = useLang();
  const qc = useQueryClient();
  const printing = usePrinting();
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState<ColorMode>("mono");
  const [jobId, setJobId] = useState<string | null>(null);
  const [range, setRange] = useState("");
  const rangeCheck = pages ? pageRangeCount(range, pages) : null;
  const rangeError = typeof rangeCheck === "string" ? rangeCheck : null;
  const chosen = typeof rangeCheck === "number" ? rangeCheck : pages ?? null;
  const selected = pages ? pageSet(range, pages) : null;

  // A fresh dialog each time it opens.
  useEffect(() => {
    if (open) { setCopies(1); setColor("mono"); setJobId(null); setRange(""); }
  }, [open]);

  const send = useMutation({
    mutationFn: () => printApi.print({ kind, id, copies, colorMode: color, ...(version ? { version } : {}), ...(pages && range.trim() ? { pageRanges: range.trim() } : {}) }),
    onSuccess: ({ job }) => {
      setJobId(job.id);
      onSent?.(job);
      qc.setQueryData(["print", "job", job.id], { job });
      void qc.invalidateQueries({ queryKey: PRINT_LOG_KEY });
    },
    onError: (e) => toast.error(t("Couldn't print"), { description: printErrorText(e) }),
  });

  const jobQ = useQuery({
    queryKey: ["print", "job", jobId],
    queryFn: () => printApi.job(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const j = q.state.data?.job;
      if (!j || j.status === "done" || j.status === "failed") return false;
      // Often at first, then calmly while the dialog stays open (a printer that isn't connected keeps a job waiting).
      return Date.now() - Date.parse(j.createdAt) < 120_000 ? 2500 : 10_000;
    },
  });
  const job = jobQ.data?.job;

  // The end of the job, said once — also when the dialog was closed meanwhile.
  const [told, setTold] = useState<string | null>(null);
  useEffect(() => {
    if (!job || told === job.id) return;
    if (job.status === "done") {
      setTold(job.id);
      toast.success(t("Your print is ready"), { id: printToastId(job.id), description: t("{title}: pick it up at the printer.", { title: job.title }) });
      void qc.invalidateQueries({ queryKey: PRINT_LOG_KEY });
      onEnded?.(job);
    } else if (job.status === "failed") {
      setTold(job.id);
      toast.error(t("Print failed"), { id: printToastId(job.id), description: jobErrorText(job.error) });
      void qc.invalidateQueries({ queryKey: PRINT_LOG_KEY });
      onEnded?.(job);
    }
  }, [job, told, t, tn, qc, onEnded]);

  const busy = send.isPending;
  const sent = !!job;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent lang={lang} className={cn("max-h-[94dvh] overflow-y-auto", printing.enabled ? "max-w-md md:max-w-4xl" : "max-w-md")}
        onEscapeKeyDown={(e) => {
          // A page shown large closes first; the dialog on the next Esc.
          const back = document.querySelector<HTMLButtonElement>("[data-print-big-close]");
          if (back) { e.preventDefault(); back.click(); }
        }}>
        <DialogHeader>
          <DialogTitle>{t("Print")}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">{title}</DialogDescription>
        </DialogHeader>

        {!printing.enabled ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("The printer isn't set up on this server.")}</span>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
            <PrintPreview kind={kind} id={id} version={version} selected={selected} mono={(job?.colorMode ?? color) === "mono"} className="h-[36dvh] md:h-[62dvh]" />
            <div className="min-w-0 space-y-4">
              <PrinterStatusPanel compact />
        {sent ? (
          <JobStatus job={job} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5">
              <Printer className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{t("Printer")}</div>
                <div className="truncate text-sm font-medium">{printing.printerName}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span id="print-copies-label" className="text-sm font-medium">{t("Copies")}</span>
              <div role="group" aria-labelledby="print-copies-label" className="inline-flex items-center rounded-md border border-border">
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-r-none" disabled={copies <= 1 || busy}
                  aria-label={t("Fewer copies")} onClick={() => setCopies((c) => Math.max(1, c - 1))}><Minus className="h-4 w-4" /></Button>
                <output aria-live="polite" className="w-10 text-center text-sm font-semibold tabular-nums">{copies}</output>
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-l-none" disabled={copies >= printing.maxCopies || busy}
                  aria-label={t("More copies")} onClick={() => setCopies((c) => Math.min(printing.maxCopies, c + 1))}><Plus className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium">{t("Color")}</span>
              <Segmented label={t("Color")} value={color} onChange={setColor}
                options={[{ key: "color" as const, label: t("Color") }, { key: "mono" as const, label: t("Black & white") }]} />
            </div>
            {pages ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label htmlFor="print-pages" className="text-sm font-medium">{t("Pages")}</label>
                  <Input id="print-pages" value={range} onChange={(e) => setRange(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false}
                    placeholder={t("All pages")} aria-invalid={!!rangeError} aria-describedby="print-pages-hint" className="h-9 w-40" />
                </div>
                <p id="print-pages-hint" className={cn("text-xs", rangeError || (chosen ?? 0) > printing.maxPages ? "text-destructive" : "text-muted-foreground")}>
                  {rangeError ?? ((chosen ?? 0) > printing.maxPages
                    ? t("These pages add up to {n}. One print can have at most 50 pages.", { n: chosen ?? 0 })
                    : `${tn(chosen ?? pages, "{n} page", "{n} pages")} · ${t("e.g. 1-3,5")}`)}
                </p>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("A4, at most {n} pages per print. Every print is recorded in Settings › Print log.", { n: printing.maxPages })}</p>
          </div>
        )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {sent || !printing.enabled ? (
            <Button onClick={() => onOpenChange(false)}>{t("Done")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("Cancel")}</Button>
              <Button onClick={() => send.mutate()} disabled={busy || !!rangeError || (!!pages && (chosen ?? 0) > printing.maxPages)} className="gap-1.5">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                {busy ? t("Sending to the printer…") : t("Print")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobStatus({ job }: { job: PrintJob }) {
  const { t, tn } = useLang();
  const done = job.status === "done";
  const failed = job.status === "failed";
  // Live from the printer: where this job is in the queue, and whether the printer is connected at all.
  const status = usePrinterStatus(!done && !failed).data;
  const mine = status?.jobs.find((j) => j.nexusJobId === job.id);
  const waitingForPrinter = !done && !failed && (status?.state === "disconnected" || mine?.state === "stalled");
  const where = !done && !failed && !waitingForPrinter && mine
    ? mine.position > 1 ? t("Position {n} in the queue", { n: mine.position }) : mine.state === "printing" ? t("Printing now") : null
    : null;
  return (
    <div role="status" aria-live="polite" className={cn(
      "flex items-start gap-3 rounded-md border p-3",
      done ? "border-emerald-500/30 bg-emerald-500/5" : failed ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/40",
    )}>
      {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        : failed ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          : <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-muted-foreground" />}
      <div className="min-w-0 space-y-0.5 text-sm">
        <div className="font-medium">{waitingForPrinter ? t("Waiting for the printer") : statusLabel(job.status)}</div>
        {waitingForPrinter && <div className="text-amber-700 dark:text-amber-400">{disconnectedText()}</div>}
        {where && <div className="font-medium text-foreground">{where}</div>}
        <div className="text-muted-foreground">
          {tn(job.pages, "{n} page", "{n} pages")} × {job.copies} · {job.colorMode === "color" ? t("Color") : t("Black & white")}
        </div>
        {failed && <div className="text-destructive [overflow-wrap:anywhere]">{jobErrorText(job.error)}</div>}
        {!done && !failed && <div className="text-xs text-muted-foreground">{t("You can close this. Settings › Print log shows how it ends.")}</div>}
      </div>
    </div>
  );
}
