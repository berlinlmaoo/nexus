import { ExternalLink, Globe, Smartphone } from "lucide-react";
import { ApiError } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

/**
 * iPhone / iPad browsers can't check in: the server refuses them (403 USE_IOS_APP) because a
 * browser tab can't keep reporting where someone works during the day — the app can. So on those
 * devices the check-in button is replaced by a way into the app, up front, instead of letting a
 * selfie + GPS round trip end in a refusal. Android and desktop browsers keep checking in.
 */

export const NEXUS_APP_STORE_URL = "https://apps.apple.com/id/app/id6807031457";
export const NEXUS_APP_DEEP_LINK = "nexus://attendance";

export function isIosBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS Safari requests the desktop site and says "Macintosh"; only the touch screen gives it away.
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

/** The server's refusal for an iPhone/iPad browser — detection above missed it, so switch to the card. */
export function isUseIosAppError(e: unknown) {
  return e instanceof ApiError && e.status === 403 && (e.payload as { code?: string } | null)?.code === "USE_IOS_APP";
}

export function IosAppCheckInCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-primary/20 bg-card p-4 shadow-soft", className)}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Smartphone className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="font-display text-base font-bold leading-snug tracking-tight">Check in from the NEXUS app on your iPhone</p>
          <p className="mt-1 text-sm text-muted-foreground">On iPhone and iPad the browser can’t record your work location during the day, so check-in and check-out happen in the app.</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={NEXUS_APP_DEEP_LINK} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-primary-foreground shadow-soft transition hover:bg-primary/90 active:scale-[0.99]">Open NEXUS</a>
        <a href={NEXUS_APP_STORE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold transition hover:bg-accent active:scale-[0.99]">App Store <ExternalLink className="h-3.5 w-3.5" /></a>
      </div>
    </div>
  );
}

/** Under the web check-in button (Android / desktop): the web day has no trail. */
export function WebCheckInNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground", className)}>
      <Globe className="h-3 w-3 shrink-0" /> Checked in from the web — your location isn't tracked during the day.
    </p>
  );
}
