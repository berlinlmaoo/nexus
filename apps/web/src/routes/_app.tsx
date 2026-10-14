import { Outlet, createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, WifiOff } from "lucide-react";
import { isAuthError, nexusApi } from "@/lib/nexus-api";
import { GideonLauncher } from "@/components/gideon/GideonLauncher";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { AttendanceReminderModal } from "@/components/attendance/AttendanceReminderModal";
import { AnnouncementModal } from "@/components/AnnouncementModal";
import { AppStoreModal } from "@/components/AppStoreModal";
import { XpPenaltyModal } from "@/components/XpPenaltyModal";
import { RealtimeProvider } from "@/lib/realtime";
import { ChatUnreadTitle } from "@/lib/chat-unread";
import { VaultUploadPanel } from "@/components/vault/VaultUploadPanel";
import { useLang } from "@/lib/lang";
import { globalModShortcut, isEditableTarget, modalOpen } from "@/lib/keyboard";
import { ShortcutsHelp, OPEN_SHORTCUTS_EVENT } from "@/components/ShortcutsHelp";
import { OPEN_SEARCH_EVENT } from "@/lib/search-event";
import { useModalFocusTrap } from "@/hooks/use-modal-focus-trap";

const SearchModal = lazy(() => import("@/components/SearchModal").then((m) => ({ default: m.SearchModal })));

/**
 * "This browser was signed in last time" (perf pass, 12 Oct 2026). With it the shell and the page render
 * while the session check is still in flight, so the page's own requests run in parallel with it instead
 * of after it. A failed check still sends the visitor to /login, as before; without the hint (first visit,
 * signed out) the "Signing you in…" card shows as it always has.
 */
const SESSION_HINT = "nexus-session-hint";
function hadSession(): boolean {
  try { return localStorage.getItem(SESSION_HINT) === "1"; } catch { return false; }
}

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { t } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const isPublicAuthRoute = location.pathname === "/login" || location.pathname.startsWith("/register") || location.pathname.startsWith("/forgot-password");
  const profile = useQuery({
    queryKey: ["nexus", "profile"],
    queryFn: nexusApi.profile,
    // Getting signed out is the most destructive thing this app can do to someone mid-task, so a
    // single failed check must not trigger it: give one retry. Non-auth errors keep the default retries.
    retry: (failureCount, error) => (isAuthError(error) ? failureCount < 1 : failureCount < 3),
    retryDelay: 800,
    // Validate the session ONCE per load, not on every window focus. Refetch-on-focus meant every
    // phone unlock / tab-switch re-checked auth, and a focus refetch left the query `isFetching` — so
    // the guard below (which defers while fetching) could never fire, leaving a signed-out visitor
    // stuck on a blank app shell instead of being sent to /login.
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    enabled: !isPublicAuthRoute,
  });

  const qc = useQueryClient();
  const [optimistic] = useState(hadSession);
  useEffect(() => {
    if (profile.data) {
      try { localStorage.setItem(SESSION_HINT, "1"); } catch { /* private mode */ }
      // Several screens read the same profile under ["profile"]: hand them this answer instead of a second request.
      if (!qc.getQueryData(["profile"])) qc.setQueryData(["profile"], profile.data);
    } else if (profile.error && isAuthError(profile.error)) {
      try { localStorage.removeItem(SESSION_HINT); } catch { /* private mode */ }
    }
  }, [profile.data, profile.error, qc]);

  useEffect(() => {
    if (isPublicAuthRoute) return;
    // `profile.error` survives in the cache while a refetch is in flight; redirecting on it then
    // would kick the user out on a stale failure that is about to be disproven.
    if (profile.isFetching) return;
    if (profile.error && isAuthError(profile.error)) {
      const callbackUrl = location.pathname === "/login" ? "/dashboard" : `${location.pathname}${location.searchStr || ""}`;
      navigate({
        to: "/login",
        search: { callbackUrl },
        replace: true,
      });
    }
  }, [isPublicAuthRoute, location.pathname, location.searchStr, navigate, profile.error, profile.isFetching]);

  // Restore the sidebar collapsed/expanded state from its cookie AFTER mount
  // (SSR renders expanded; applying post-hydration avoids a mismatch).
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )sidebar_state=([^;]+)/);
    if (m) setSidebarOpen(m[1] !== "false");
  }, []);

  if (isPublicAuthRoute) {
    return <Outlet />;
  }

  if (profile.isLoading && !optimistic) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="rounded-3xl border border-border bg-card px-8 py-6 text-center shadow-sm">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />
          <div className="text-sm font-semibold text-foreground">{t("Signing you in…")}</div>
          <p className="mt-2 text-xs font-medium text-muted-foreground">{t("Checking your session")}</p>
        </div>
      </div>
    );
  }

  if (profile.error && !isAuthError(profile.error)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/15 text-warning-foreground dark:text-warning"><WifiOff className="h-6 w-6" /></div>
          <h1 className="text-xl font-semibold text-foreground">{t("Can't reach NEXUS right now")}</h1>
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            {t("Check your internet connection and try again. If it keeps happening, NEXUS may be down for a moment.")}
          </p>
          <button
            className="mt-6 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            onClick={() => window.location.reload()}
          >
            {t("Try again")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <RealtimeProvider userId={profile.data?.user?.id} userName={profile.data?.user?.name ?? undefined}>
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <AppSidebar />
        {/* overflow-x-clip: a guard so nothing in a page can widen the phone's layout viewport (it zoomed every
            project page out to ~720px, audit 12 Oct 2026). `clip`, not `hidden`: no scroll box, so sticky headers keep working. */}
        <SidebarInset className="min-w-0 overflow-x-clip">
          <div>
            <Outlet />
          </div>
          {/* Room for the phone's floating tab bar: its height plus its gap above the safe area, so the last
              thing on every scrolling page clears the bar at full scroll (UI tour run 13, W-M1). An element of
              its own, not padding on the page wrapper, so anything that measures where the content ends
              (and a page ending in a full-bleed card) counts the room too. */}
          <div aria-hidden data-tabbar-room="" className="h-(--tabbar-room) md:hidden" />
          <MobileTabBar />
        </SidebarInset>
        <GlobalSearch />
        <GideonLauncher />
        <AttendanceReminderModal />
        <AnnouncementModal />
        <AppStoreModal />
        <XpPenaltyModal />
        {/* Z Vault uploads: here, above every route, so they keep going wherever the person goes. */}
        <VaultUploadPanel />
        {/* "(3) NEXUS Phaëthon" in the browser tab while chats are unread. */}
        <ChatUnreadTitle />
      </SidebarProvider>
    </RealtimeProvider>
  );
}

function GlobalSearch() {
  // Tab stays inside whichever modal dialog is on top (one listener for the app).
  useModalFocusTrap();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  // Keys typed right after ⌘K, before the search box exists, are kept and handed to it (QA round 2,
  // N-05: "ZZ QA6" typed at once came out empty). null = not buffering.
  const buffered = useRef<string | null>(null);
  const openSearch = useCallback(() => { if (buffered.current === null) buffered.current = ""; setOpen(true); }, []);
  const takeBuffered = useCallback(() => { const b = buffered.current ?? ""; buffered.current = null; return b; }, []);
  // The search chunk is fetched while the browser is idle, so ⌘K opens it at once.
  useEffect(() => {
    const load = () => { void import("@/components/SearchModal"); };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(load); else window.setTimeout(load, 2000);
  }, []);
  useEffect(() => {
    const onBufferKey = (e: KeyboardEvent) => {
      if (buffered.current === null || isEditableTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (e.key.length === 1) buffered.current += e.key;
      else if (e.key === "Backspace") buffered.current = buffered.current.slice(0, -1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onBufferKey, true);
    return () => window.removeEventListener("keydown", onBufferKey, true);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘/Ctrl+K = search, but not inside a text field or editor: there it adds a link (Notion, Docs),
      // and the spreadsheet grid uses it for "Insert link" (QA S-07).
      if (e.key.toLowerCase() === "k" && !e.shiftKey && globalModShortcut(e)) { e.preventDefault(); openSearch(); return; }
      // "?" or ⌘/Ctrl+/ = the shortcut list. Decided after the event has gone everywhere: the calendar
      // and the sheet answer the same keys with their own lists and mark the event handled.
      const slash = e.key === "/" && (e.metaKey || e.ctrlKey) && !e.altKey;
      const question = e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (!slash && !question) return;
      if (isEditableTarget(e.target)) return;
      if (question && modalOpen()) return;
      window.setTimeout(() => { if (!e.defaultPrevented) setHelp(true); }, 0);
    };
    const onOpenSearch = () => openSearch();
    const onOpenHelp = () => setHelp(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpenSearch);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpenHelp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpenSearch);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpenHelp);
    };
  }, [openSearch]);
  return (
    <>
      {open && <Suspense fallback={null}><SearchModal takeInitial={takeBuffered} onClose={() => { buffered.current = null; setOpen(false); }} /></Suspense>}
      <ShortcutsHelp open={help} onOpenChange={setHelp} />
    </>
  );
}
