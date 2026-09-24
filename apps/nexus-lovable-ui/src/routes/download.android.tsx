import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { AlertTriangle, Download, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isAuthError, nexusApi, type AndroidReleaseInfo } from "@/lib/nexus-api";

// The Android app is sideloaded (no Play Store yet), and only signed-in people may download it (owner
// decision 24 Sep 2026). This page is what the app opens for "Update", what the update reminder links
// to, and the URL in the install guide. It lives outside `_app` so a phone gets a plain page, not the
// dashboard shell; signed out, it sends you to /login and back here.
//
// Server side: GET /api/app/android/release (facts) and GET /api/app/android/apk (the file, Range-able,
// exempt from the 426 gate so a locked build can still update).
export const Route = createFileRoute("/download/android")({ component: AndroidDownloadPage });

const HERE = "/download/android";

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
}

function AndroidDownloadPage() {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["android-release"],
    queryFn: nexusApi.androidRelease,
    retry: (count, error) => (isAuthError(error) ? false : count < 2),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (q.error && isAuthError(q.error)) {
      navigate({ to: "/login", search: { callbackUrl: HERE }, replace: true });
    }
  }, [q.error, navigate]);

  if (q.isLoading || (q.error && isAuthError(q.error))) {
    return (
      <Shell>
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Shell>
    );
  }

  if (q.error) {
    return (
      <Shell>
        <div className="text-center py-6">
          <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <h2 className="mt-3 font-semibold">Couldn't load the download</h2>
          <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
          <Button className="mt-4" variant="outline" onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      </Shell>
    );
  }

  const info = q.data as AndroidReleaseInfo;
  return (
    <Shell>
      {info.available ? <Release info={info} /> : <NotYet />}
      <InstallGuide />
    </Shell>
  );
}

function Release({ info }: { info: Extract<AndroidReleaseInfo, { available: true }> }) {
  const released = formatDate(info.releasedAt);
  const notes = (info.notes ?? "").split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">NEXUS {info.versionName}</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{formatSize(info.sizeBytes)}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">
        Build {info.versionCode}
        {released ? ` · released ${released}` : ""}
      </p>

      <Button asChild size="lg" className="mt-5 w-full h-12 text-base">
        {/* A plain link, not fetch(): the browser's own download manager handles progress and resume. */}
        <a href={info.downloadUrl} download={info.fileName}>
          <Download className="h-5 w-5 mr-2" /> Download
        </a>
      </Button>

      {notes.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">What's new</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {notes.map((n, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {info.sha256 && (
        <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground break-all">
          <ShieldCheck className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          SHA-256 {info.sha256}
        </p>
      )}
    </section>
  );
}

function NotYet() {
  return (
    <section className="text-center py-4">
      <h2 className="font-semibold">No Android build yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The Android app isn't available to download yet. Check back soon, or use NEXUS on the web in the meantime.
      </p>
      <Button asChild variant="outline" className="mt-4">
        <a href="/dashboard">Open NEXUS on the web</a>
      </Button>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {n}
      </span>
      <div className="min-w-0">
        <h4 className="text-sm font-semibold">{title}</h4>
        <div className="mt-1 space-y-1.5 text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

// From nexus-android docs/INSTALL-APK.md (Indonesian there; English here, same steps).
function InstallGuide() {
  return (
    <section className="mt-8 border-t border-border pt-6">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">How to install</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        NEXUS for Android isn't on the Play Store yet, so you install the official file directly. It's a one-time setup,
        about two minutes. You need Android 8 or newer, on a phone that has Google Play (newer Huawei phones without
        Google Play can't run it yet).
      </p>
      <ol className="mt-5 space-y-5">
        <Step n={1} title="Download">
          <p>
            Open this page in Chrome on your phone and tap <b className="text-foreground">Download</b>. If Chrome says the
            file might be harmful, choose <b className="text-foreground">Download anyway</b> — Chrome says that about every
            app that doesn't come from the Play Store.
          </p>
        </Step>
        <Step n={2} title="Let Chrome install apps (once)">
          <p>
            Open the downloaded file (from the notification, or Chrome → ⋮ → Downloads). When Android says your phone
            isn't allowed to install unknown apps from this source:
          </p>
          <p>
            Tap <b className="text-foreground">Settings</b>, turn on <b className="text-foreground">Allow from this source</b>{" "}
            (on Oppo/Realme: <i>Allow app installs</i>), go back, then tap <b className="text-foreground">Install</b>.
          </p>
        </Step>
        <Step n={3} title="If Play Protect shows up">
          <p>
            Play Protect may call NEXUS an unknown app or block it, because it isn't on the Play Store yet. Choose{" "}
            <b className="text-foreground">More details</b> → <b className="text-foreground">Install anyway</b>. If it asks
            to send the app for scanning, either answer is fine.
          </p>
          <p>Don't turn Play Protect off.</p>
        </Step>
        <Step n={4} title="Open NEXUS and allow access">
          <p>
            Sign in. When asked, allow <b className="text-foreground">Camera</b>, <b className="text-foreground">Location</b>{" "}
            ("While using the app", then "Allow all the time" for location during working hours) and{" "}
            <b className="text-foreground">Notifications</b>.
          </p>
          <p>
            On Oppo, Xiaomi, Vivo and Samsung phones NEXUS also walks you through turning off battery saving for NEXUS.
            Follow it — without that, the phone can quietly shut NEXUS down.
          </p>
        </Step>
      </ol>

      <div className="mt-6 rounded-2xl bg-muted/50 p-4 text-sm">
        <h4 className="font-semibold">Updating</h4>
        <p className="mt-1 text-muted-foreground">
          When there's a new version, NEXUS tells you and opens this page. Download it and tap{" "}
          <b className="text-foreground">Install</b> over the old version. Your data and any check-ins still waiting to
          send are kept.
        </p>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Only install NEXUS from <b className="text-foreground">nexus.znetworks.id</b> — never from WhatsApp or another
        link. Still stuck? Open a ticket on NEXUS web (category <i>Other</i>) with a screenshot.
      </p>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
            <Smartphone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">NEXUS</div>
            <h1 className="text-xl font-semibold leading-tight">Get NEXUS for Android</h1>
          </div>
        </div>
        <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
