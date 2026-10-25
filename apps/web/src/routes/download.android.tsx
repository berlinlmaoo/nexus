import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Loader2, LogIn, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { nexusApi, type AndroidReleaseInfo } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { formatCount } from "@/lib/number-format";

// The Android app is sideloaded (no Play Store yet), and only signed-in people may download it (owner
// decision 24 Sep 2026). This page is what the app opens for "Update", what the update reminder links
// to, and the URL in the install guide. It lives outside `_app` so a phone gets a plain page, not the
// dashboard shell. Signed out it still shows the release and the steps, like a form that needs an
// account (owner, 25 Oct 2026); the button is "Sign in to download", to /login and back here. The APK
// itself stays session-only (the release answer has no downloadUrl then).
//
// Server side: GET /api/app/android/release (facts) and GET /api/app/android/apk (the file, Range-able,
// exempt from the 426 gate so a locked build can still update).
export const Route = createFileRoute("/download/android")({ component: AndroidDownloadPage });

const HERE = "/download/android";
const SIGN_IN_URL = `/login?callbackUrl=${encodeURIComponent(HERE)}`;

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${formatCount(bytes / (1024 * 1024), 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(iso: string | null, locale: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
}

/**
 * A translated sentence with emphasis kept inside the string, so each language can put the bold words
 * where its grammar wants them: `**Install**` is bold (a button name on the phone), `_Other_` italic.
 */
function rich(s: string): React.ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <b key={i} className="text-foreground">{part.slice(2, -2)}</b>;
    if (part.length > 2 && part.startsWith("_") && part.endsWith("_")) return <i key={i}>{part.slice(1, -1)}</i>;
    return part;
  });
}

function AndroidDownloadPage() {
  const { t } = useLang();
  const q = useQuery({
    queryKey: ["android-release"],
    queryFn: nexusApi.androidRelease,
    retry: (count) => count < 2,
    refetchOnWindowFocus: false,
  });

  if (q.isLoading) {
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
          <h2 className="mt-3 font-semibold">{t("Couldn't load the download")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("Check your connection and try again.")}</p>
          <Button className="mt-4" variant="outline" onClick={() => q.refetch()}>
            {t("Try again")}
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
  const { t, locale } = useLang();
  const released = formatDate(info.releasedAt, locale);
  const notes = (info.notes ?? "").split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">NEXUS {info.versionName}</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{formatSize(info.sizeBytes)}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">
        {released
          ? t("Build {code} · released {date}", { code: info.versionCode, date: released })
          : t("Build {code}", { code: info.versionCode })}
      </p>

      {info.downloadUrl ? (
        <Button asChild size="lg" className="mt-5 w-full h-12 text-base">
          {/* A plain link, not fetch(): the browser's own download manager handles progress and resume. */}
          <a href={info.downloadUrl} download={info.fileName}>
            <Download className="h-5 w-5 mr-2" /> {t("Download")}
          </a>
        </Button>
      ) : (
        <>
          <Button asChild size="lg" className="mt-5 w-full h-12 text-base">
            <a href={SIGN_IN_URL}>
              <LogIn className="h-5 w-5 mr-2" /> {t("Sign in to download")}
            </a>
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("Only NEXUS accounts can download the app. After you sign in you come back here.")}
          </p>
        </>
      )}

      {notes.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("What's new")}</h3>
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
  const { t } = useLang();
  return (
    <section className="text-center py-4">
      <h2 className="font-semibold">{t("No Android build yet")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("The Android app isn't available to download yet. Check back soon, or use NEXUS on the web in the meantime.")}
      </p>
      <Button asChild variant="outline" className="mt-4">
        <a href="/dashboard">{t("Open NEXUS on the web")}</a>
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

// From nexus-android docs/INSTALL-APK.md (Indonesian there; English here, same steps). Words in **…**
// are the names of buttons the phone shows; the Indonesian table uses the names an Indonesian-language
// phone shows.
function InstallGuide() {
  const { t } = useLang();
  return (
    <section className="mt-8 border-t border-border pt-6">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("How to install")}</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("NEXUS for Android isn't on the Play Store yet, so you install the official file directly. It's a one-time setup, about two minutes. You need Android 8 or newer, on a phone that has Google Play (newer Huawei phones without Google Play can't run it yet).")}
      </p>
      <ol className="mt-5 space-y-5">
        <Step n={1} title={t("Download")}>
          <p>
            {rich(t("Open this page in Chrome on your phone and tap **Download**. If Chrome says the file might be harmful, choose **Download anyway**. Chrome says that about every app that doesn't come from the Play Store."))}
          </p>
        </Step>
        <Step n={2} title={t("Let Chrome install apps (once)")}>
          <p>
            {t("Open the downloaded file (from the notification, or Chrome → ⋮ → Downloads). When Android says your phone isn't allowed to install unknown apps from this source:")}
          </p>
          <p>
            {rich(t("Tap **Settings**, turn on **Allow from this source** (on Oppo/Realme: _Allow app installs_), go back, then tap **Install**."))}
          </p>
        </Step>
        <Step n={3} title={t("If Play Protect shows up")}>
          <p>
            {rich(t("Play Protect may call NEXUS an unknown app or block it, because it isn't on the Play Store yet. Choose **More details** → **Install anyway**. If it asks to send the app for scanning, either answer is fine."))}
          </p>
          <p>{t("Don't turn Play Protect off.")}</p>
        </Step>
        <Step n={4} title={t("Open NEXUS and allow access")}>
          <p>
            {rich(t("Sign in. When asked, allow **Camera**, **Location** (\"While using the app\", then \"Allow all the time\" for location during working hours) and **Notifications**."))}
          </p>
          <p>
            {t("On Oppo, Xiaomi, Vivo and Samsung phones NEXUS also walks you through turning off battery saving for NEXUS. Follow it. Without that, the phone can quietly shut NEXUS down.")}
          </p>
        </Step>
      </ol>

      <div className="mt-6 rounded-2xl bg-muted/50 p-4 text-sm">
        <h4 className="font-semibold">{t("Updating")}</h4>
        <p className="mt-1 text-muted-foreground">
          {rich(t("When there's a new version, NEXUS tells you and opens this page. Download it and tap **Install** over the old version. Your data and any check-ins still waiting to send are kept."))}
        </p>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        {rich(t("Only install NEXUS from **nexus.znetworks.id**, never from WhatsApp or another link. Still stuck? Open a ticket on NEXUS web (category _Other_) with a screenshot."))}
      </p>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
            <Smartphone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">NEXUS</div>
            <h1 className="text-xl font-semibold leading-tight">{t("Get NEXUS for Android")}</h1>
          </div>
        </div>
        <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
