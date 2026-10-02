import { useState } from "react";
import { Download, ExternalLink, Globe, Smartphone, X } from "lucide-react";
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

/** The server's refusal for a browser that may not take attendance (iPhone/iPad: USE_IOS_APP; laptop or
 *  desktop: USE_PHONE_APP) — switch to the card. */
export function isUseIosAppError(e: unknown) {
  const code = e instanceof ApiError && e.status === 403 ? (e.payload as { code?: string } | null)?.code : undefined;
  return code === "USE_IOS_APP" || code === "USE_PHONE_APP";
}

/** Only an Android phone's browser may still check in or out (owner, 2 Oct 2026); everything else uses the app. */
export function browserMayTakeAttendance() {
  if (typeof navigator === "undefined") return true;
  return /Android/i.test(navigator.userAgent || "");
}

export function IosAppCheckInCard({ className }: { className?: string }) {
  if (!isIosBrowser()) return <PhoneAppCheckInCard className={className} />;
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

/**
 * Android: the NEXUS app (sideloaded, /download/android) is announced to people who still use NEXUS
 * in an Android browser (owner, 29 Sep 2026). Only an Android browser ever sees these; the app itself
 * is native and never loads this page.
 */
export const NEXUS_ANDROID_DOWNLOAD = "/download/android";

export function isAndroidBrowser() {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

const ANDROID_BANNER_KEY = "nexus.androidAppBanner.hiddenUntil";

function bannerHidden() {
  try {
    const until = Number(localStorage.getItem(ANDROID_BANNER_KEY) || 0);
    return until > Date.now();
  } catch {
    return false;
  }
}

/** Top of Home in an Android browser. Closing it hides it for 7 days, not forever. */
export function AndroidAppBanner({ className }: { className?: string }) {
  const [hidden, setHidden] = useState(() => !isAndroidBrowser() || bannerHidden());
  if (hidden) return null;
  const close = () => {
    try { localStorage.setItem(ANDROID_BANNER_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000)); } catch { /* private mode */ }
    setHidden(true);
  };
  return (
    <div className={cn("relative rounded-2xl border border-primary/20 bg-card p-4 shadow-soft", className)}>
      <button type="button" onClick={close} aria-label="Hide" className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-accent">
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Smartphone className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="font-display text-base font-bold leading-snug tracking-tight">NEXUS is now an app on Android</p>
          <p className="mt-1 text-sm text-muted-foreground">Check in with one tap, get notified the moment something needs you, and keep working with no signal.</p>
        </div>
      </div>
      <a href={NEXUS_ANDROID_DOWNLOAD} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-primary-foreground shadow-soft transition hover:bg-primary/90 active:scale-[0.99]">
        <Download className="h-4 w-4" /> Download the app
      </a>
    </div>
  );
}

/** Under the web check-in button in an Android browser: the app keeps the day's trail, the web can't. */
export function AndroidAppCheckInNote({ className }: { className?: string }) {
  if (!isAndroidBrowser()) return null;
  return (
    <a href={NEXUS_ANDROID_DOWNLOAD} className={cn("flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm transition hover:bg-primary/10", className)}>
      <span className="flex min-w-0 items-center gap-2">
        <Smartphone className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 font-semibold text-foreground">Check in from the NEXUS app for Android</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 font-bold text-primary"><Download className="h-3.5 w-3.5" /> Get it</span>
    </a>
  );
}

/** Laptop / desktop: attendance happens on the phone (owner, 2 Oct 2026). */
function PhoneAppCheckInCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-primary/20 bg-card p-4 shadow-soft", className)}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Smartphone className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="font-display text-base font-bold leading-snug tracking-tight">Check in and out from the NEXUS app on your phone</p>
          <p className="mt-1 text-sm text-muted-foreground">Attendance isn't taken from a laptop — the app records where your workday happens. Everything else here still works.</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={NEXUS_APP_STORE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold transition hover:bg-accent active:scale-[0.99]">iPhone · App Store <ExternalLink className="h-3.5 w-3.5" /></a>
        <a href={NEXUS_ANDROID_DOWNLOAD} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold transition hover:bg-accent active:scale-[0.99]"><Download className="h-3.5 w-3.5" /> Android app</a>
      </div>
    </div>
  );
}
