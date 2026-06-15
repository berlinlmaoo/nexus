import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, Megaphone, X } from "lucide-react";
import { nexusApi } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

const TONE: Record<string, { icon: typeof Info; head: string; accent: string }> = {
  info: { icon: Info, head: "from-accent via-card to-secondary", accent: "text-primary" },
  success: { icon: CheckCircle2, head: "from-emerald-100 via-card to-emerald-50", accent: "text-emerald-600" },
  warning: { icon: AlertTriangle, head: "from-amber-100 via-card to-amber-50", accent: "text-amber-600" },
};

/** Global pop-up for BoD-posted announcements; shown once per user (dismiss = marked seen). */
export function AnnouncementModal() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["announcements-active"], queryFn: () => nexusApi.activeAnnouncements(), retry: 1, staleTime: 30_000 });
  const list = q.data?.announcements ?? [];
  const current = list[0];
  const dismiss = useMutation({
    mutationFn: (id: string) => nexusApi.dismissAnnouncement(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements-active"] }),
  });

  if (typeof document === "undefined" || !current) return null;
  const tone = TONE[current.tone] ?? TONE.info;
  const Icon = tone.icon;

  return createPortal(
    <AnimatePresence>
      {current && (
        <div className="fixed inset-0 z-[85] grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => dismiss.mutate(current.id)} />
          <motion.div
            role="dialog" aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-pop"
          >
            <div className={cn("flex items-center justify-between gap-3 border-b border-border bg-gradient-to-br px-5 py-3.5", tone.head)}>
              <div className="flex items-center gap-2">
                <Megaphone className={cn("h-4 w-4", tone.accent)} />
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/70">Pengumuman</p>
              </div>
              <button onClick={() => dismiss.mutate(current.id)} aria-label="Tutup" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-3 p-5">
              <div className="flex items-start gap-3">
                <div className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted", tone.accent)}><Icon className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-bold tracking-tight">{current.title}</h2>
                  <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{current.body}</p>
                </div>
              </div>
              <button
                onClick={() => dismiss.mutate(current.id)}
                disabled={dismiss.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
              >
                Oke, ngerti
              </button>
              {list.length > 1 && <p className="text-center text-[11px] text-muted-foreground">+{list.length - 1} pengumuman lagi setelah ini</p>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
