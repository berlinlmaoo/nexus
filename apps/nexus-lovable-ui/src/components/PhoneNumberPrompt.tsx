import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { nexusApi } from "@/lib/nexus-api";

/**
 * One-time nudge to add a WhatsApp number (ported from the old NEXUS app-layout). Auto-opens a short
 * beat after load when the signed-in user has no phoneNumber, unless dismissed this session. Saving goes
 * through updateProfile; the backend does the real normalize/validate. Editable anytime in Settings.
 */
const DISMISS_PREFIX = "nexus-phone-prompt-dismissed:";
const looksLikePhone = (v: string) => /^\+?\d{8,15}$/.test(v.replace(/[\s-]/g, ""));

export function PhoneNumberPrompt() {
  const qc = useQueryClient();
  const profileQ = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 60_000 });
  const user = profileQ.data?.user;
  const userId = user?.id;
  const hasPhone = Boolean(user?.phoneNumber);

  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const storageKey = useMemo(() => (userId ? `${DISMISS_PREFIX}${userId}` : null), [userId]);

  useEffect(() => {
    if (!userId || hasPhone || !storageKey || typeof window === "undefined") return;
    if (window.sessionStorage.getItem(storageKey)) return;
    const t = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(t);
  }, [userId, hasPhone, storageKey]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const dismiss = () => {
    if (storageKey && typeof window !== "undefined") window.sessionStorage.setItem(storageKey, "1");
    setOpen(false);
  };

  const save = useMutation({
    mutationFn: () => nexusApi.updateProfile({ phoneNumber: phone.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexus", "profile"] });
      toast.success("WhatsApp number saved ✅");
      setOpen(false);
    },
    onError: (e) => toast.error("Couldn't save", { description: e instanceof Error ? e.message : "Double-check the number and try again." }),
  });

  const valid = looksLikePhone(phone);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={dismiss} />
          <motion.div
            role="dialog" aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-pop"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border bg-gradient-to-br from-accent via-card to-secondary px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><MessageCircle className="h-5 w-5" /></span>
                <div>
                  <h2 className="font-display text-xl font-bold tracking-tight">Add your WhatsApp number</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">So assignment notifs, mentions &amp; check-in reminders land straight on your WhatsApp.</p>
                </div>
              </div>
              <button onClick={dismiss} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); if (valid && !save.isPending) save.mutate(); }} className="space-y-3 p-5">
              <input
                value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoFocus
                placeholder="08xxxxxxxxxx · outside Indonesia use + country code"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Only used for work notifications. Change it anytime in Settings.</p>
              <button type="submit" disabled={!valid || save.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50">
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} Save number
              </button>
              <button type="button" onClick={dismiss} className="block w-full text-center text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">Maybe later</button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
