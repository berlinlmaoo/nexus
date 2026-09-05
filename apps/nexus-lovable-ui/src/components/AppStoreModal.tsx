import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Apple, X } from "lucide-react";

const KEY = "nexus-appstore-never";
const URL = "https://apps.apple.com/id/app/id6807031457";

/**
 * Tells people NEXUS is on the App Store.
 *
 * It comes back every visit on purpose, with one button that stops it for good. Closing it is
 * "not now"; silencing it is a separate, deliberate choice — a reminder that dies on the first
 * stray click never reaches anyone, and one that cannot be silenced is just an obstacle.
 *
 * The link points at the Indonesian storefront because that is where the app is published; the
 * generic apps.apple.com/app/id… URL returns 404 and would have been a broken link for everyone.
 */
export function AppStoreModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Reading site data throws outright in some privacy modes, so a failure means "show it"
    // rather than taking the shell down.
    try {
      setOpen(localStorage.getItem(KEY) !== "1");
    } catch {
      setOpen(true);
    }
  }, []);

  const later = () => setOpen(false);
  const never = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* nothing to remember it with; it returns next visit */
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[85] grid place-items-center p-4">
          <motion.div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={later}
          />
          <motion.div
            role="dialog" aria-modal="true" aria-label="NEXUS on the App Store"
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-pop"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border bg-gradient-to-br from-accent via-card to-secondary px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Apple className="h-4 w-4 text-primary" />
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/70">Now on the App Store</p>
              </div>
              <button onClick={later} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <h2 className="font-display text-lg font-bold tracking-tight">Get NEXUS on your phone</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  One app for iPhone, iPad and Mac. Clock in with your camera, get your mentions as
                  notifications, and read your threads without opening a browser.
                </p>
              </div>

              <a
                href={URL}
                target="_blank"
                rel="noreferrer"
                onClick={later}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.99]"
              >
                <Apple className="h-4 w-4" />
                Open in the App Store
              </a>

              <button
                onClick={never}
                className="w-full rounded-xl px-4 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Don&rsquo;t remind me again
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
