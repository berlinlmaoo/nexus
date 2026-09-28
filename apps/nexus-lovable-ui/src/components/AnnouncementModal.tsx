import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Info, Megaphone, X } from "lucide-react";
import { nexusApi } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

const TONE: Record<string, { icon: typeof Info; head: string; accent: string }> = {
  info: { icon: Info, head: "from-accent via-card to-secondary", accent: "text-primary" },
  success: { icon: CheckCircle2, head: "from-emerald-100 via-card to-emerald-50", accent: "text-emerald-600" },
  warning: { icon: AlertTriangle, head: "from-amber-100 via-card to-amber-50", accent: "text-amber-600" },
};

const SP_TONE = { icon: FileText, head: "from-rose-100 via-card to-rose-50", accent: "text-rose-600" };

/**
 * Global pop-up for BoD-posted announcements; shown once per user (dismiss = marked seen).
 * kind "sp" (surat peringatan) → red SP badge + Open PDF (viewed in place, with the session cookie);
 * kind "warning" (Absen Monitor) → amber, with the selfie it is about.
 */
export function AnnouncementModal() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["announcements-active"], queryFn: () => nexusApi.activeAnnouncements(), retry: 1, staleTime: 30_000 });
  // `?announcement=<id>` on any route (a tapped notification): that one is shown first, even when it
  // was dismissed before — the active list would hide it, and a tap that shows nothing reads as broken.
  const search = useSearch({ strict: false }) as { announcement?: string };
  const focusId = search.announcement ?? null;
  const [focusClosed, setFocusClosed] = useState<string | null>(null);
  const focusQ = useQuery({
    queryKey: ["announcement", focusId],
    queryFn: () => nexusApi.announcement(focusId as string),
    enabled: Boolean(focusId) && focusClosed !== focusId,
    retry: 1,
  });
  useEffect(() => { setFocusClosed(null); }, [focusId]);
  const [pdfOpen, setPdfOpen] = useState(false);
  const focused = focusId && focusClosed !== focusId ? focusQ.data?.announcement : undefined;
  const list = q.data?.announcements ?? [];
  const current = focused ?? list[0];
  const dismiss = useMutation({
    mutationFn: (id: string) => nexusApi.dismissAnnouncement(id),
    onSuccess: (_r, id) => {
      setPdfOpen(false);
      if (id === focusId) setFocusClosed(id);
      qc.invalidateQueries({ queryKey: ["announcements-active"] });
    },
  });

  if (typeof document === "undefined" || !current) return null;
  const kind = current.kind ?? "announcement";
  const tone = kind === "sp" ? SP_TONE : kind === "warning" ? TONE.warning : (TONE[current.tone] ?? TONE.info);
  const Icon = tone.icon;
  const eyebrow = kind === "sp" ? "Warning letter" : kind === "warning" ? "Warning" : "Announcement";
  const pdf = current.attachmentUrl ?? null;

  return createPortal(
    <AnimatePresence>
      {current && (
        <div className="fixed inset-0 z-[85] grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => dismiss.mutate(current.id)} />
          <motion.div
            role="dialog" aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className={cn("relative z-10 w-full overflow-hidden rounded-3xl border border-border bg-card shadow-pop", pdfOpen && pdf ? "max-w-3xl" : "max-w-md")}
          >
            <div className={cn("flex items-center justify-between gap-3 border-b border-border bg-gradient-to-br px-5 py-3.5", tone.head)}>
              <div className="flex items-center gap-2">
                {kind === "announcement" ? <Megaphone className={cn("h-4 w-4", tone.accent)} /> : <AlertTriangle className={cn("h-4 w-4", tone.accent)} />}
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/70">{eyebrow}</p>
              </div>
              <button onClick={() => dismiss.mutate(current.id)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-3 p-5">
              <div className="flex items-start gap-3">
                <div className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted", tone.accent)}><Icon className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-bold tracking-tight">
                    {kind === "sp" && <span className="mr-2 inline-block rounded-md bg-rose-600 px-1.5 py-0.5 align-middle text-xs font-black tracking-wider text-white">SP</span>}
                    {current.title}
                  </h2>
                  <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{current.body}</p>
                </div>
              </div>
              {current.imageUrl && (
                <img src={current.imageUrl} alt="" className={cn("max-h-72 w-full rounded-xl border border-border", kind === "warning" ? "object-contain bg-muted" : "object-cover")} />
              )}
              {pdf && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPdfOpen((o) => !o)}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                    >
                      <FileText className="h-4 w-4" /> {pdfOpen ? "Hide PDF" : "Open PDF"}
                    </button>
                    <a href={pdf} target="_blank" rel="noreferrer" aria-label="Open PDF in a new tab" className="grid w-11 place-items-center rounded-xl border border-border text-muted-foreground hover:bg-accent"><ExternalLink className="h-4 w-4" /></a>
                  </div>
                  {current.attachmentName && <p className="truncate text-center text-[11px] text-muted-foreground">{current.attachmentName}</p>}
                  {pdfOpen && <iframe src={pdf} title={current.attachmentName ?? "PDF"} className="h-[60vh] w-full rounded-xl border border-border bg-muted" />}
                </div>
              )}
              <button
                onClick={() => dismiss.mutate(current.id)}
                disabled={dismiss.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
              >
                Got it
              </button>
              {list.length > 1 && <p className="text-center text-[11px] text-muted-foreground">+{list.length - 1} more after this</p>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
