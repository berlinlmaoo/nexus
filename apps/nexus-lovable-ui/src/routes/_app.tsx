import { Outlet, createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { SearchModal } from "@/components/SearchModal";
import { Loader2, Sparkles } from "lucide-react";
import { isAuthError, nexusApi } from "@/lib/nexus-api";
import { GideonPanel } from "@/components/gideon/GideonPanel";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { AttendanceReminderModal } from "@/components/attendance/AttendanceReminderModal";
import { AnnouncementModal } from "@/components/AnnouncementModal";
import { XpPenaltyModal } from "@/components/XpPenaltyModal";
import { RealtimeProvider } from "@/lib/realtime";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isPublicAuthRoute = location.pathname === "/login" || location.pathname.startsWith("/register") || location.pathname.startsWith("/forgot-password");
  const profile = useQuery({
    queryKey: ["nexus", "profile"],
    queryFn: nexusApi.profile,
    retry: false,
    staleTime: 60_000,
    enabled: !isPublicAuthRoute,
  });

  useEffect(() => {
    if (isPublicAuthRoute) return;
    if (profile.error && isAuthError(profile.error)) {
      const callbackUrl = location.pathname === "/login" ? "/dashboard" : `${location.pathname}${location.searchStr || ""}`;
      navigate({
        to: "/login",
        search: { callbackUrl },
        replace: true,
      });
    }
  }, [isPublicAuthRoute, location.pathname, location.searchStr, navigate, profile.error]);

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

  if (profile.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="rounded-3xl border border-border bg-card px-8 py-6 text-center shadow-sm">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">Syncing mission pass</div>
          <p className="mt-2 text-xs font-medium text-muted-foreground">Checking your NEXUS session...</p>
        </div>
      </div>
    );
  }

  if (profile.error && !isAuthError(profile.error)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/15 text-2xl">🛰️</div>
          <h1 className="text-xl font-semibold text-foreground">Core NEXUS lagi nggak kejangkau</h1>
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            Revamp UI jalan, tapi live API belum bisa dihubungi. Pastikan core app di port 3000 nyala, lalu refresh.
          </p>
          <button
            className="mt-6 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            onClick={() => window.location.reload()}
          >
            Retry Uplink
          </button>
        </div>
      </div>
    );
  }

  return (
    <RealtimeProvider userId={profile.data?.user?.id} userName={profile.data?.user?.name ?? undefined}>
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <div className="pb-28 md:pb-0">
            <Outlet />
          </div>
          <MobileTabBar />
        </SidebarInset>
        <GlobalSearch />
        <GideonLauncher />
        <AttendanceReminderModal />
        <AnnouncementModal />
        <XpPenaltyModal />
      </SidebarProvider>
    </RealtimeProvider>
  );
}

function GideonLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Gideon AI"
          className="fixed bottom-32 right-4 z-50 grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-pop transition-all hover:scale-105 active:scale-95 md:bottom-6 md:right-6"
        >
          <Sparkles className="h-5 w-5" />
        </button>
      )}
      {open && (
        <div className="fixed bottom-4 right-4 z-50 h-[70vh] w-[calc(100vw-2rem)] max-w-md md:bottom-6 md:right-6">
          <GideonPanel onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

function GlobalSearch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!open) return null;
  return <SearchModal onClose={() => setOpen(false)} />;
}
