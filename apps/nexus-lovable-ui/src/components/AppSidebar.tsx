import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Inbox, MessageCircle, CheckSquare, Calendar, CalendarClock, FolderKanban,
  Users, Trophy, ClipboardCheck, Settings, Shield, FileText, Megaphone,
  Search, PanelLeftClose, LogOut, Loader2, AtSign, Ticket, Sun, Moon,
 HardDrive, Languages,
} from "lucide-react";
import { useState } from "react";
import { SidebarProjectTree } from "@/components/SidebarProjectTree";
import { GideonMark } from "@/components/gideon/GideonMark";
import nexusLogo from "@/assets/nexus-logo.png";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";
import { useQuery } from "@tanstack/react-query";
import { nexusApi } from "@/lib/nexus-api";
import { useTheme } from "@/lib/theme";
import { useLang } from "@/lib/lang";
import { useChatUnread } from "@/lib/chat-unread";
import { cn } from "@/lib/utils";

const groups = [
  {
    label: "Home",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Messages", url: "/messages", icon: MessageCircle },
      // GIDEON full page (12 Oct 2026, Notion AI's chat page): conversations with search.
      { title: "GIDEON", url: "/gideon", icon: GideonMark },
      { title: "Notifications", url: "/inbox", icon: Inbox },
      { title: "Threads", url: "/threads", icon: AtSign },
      { title: "Z Vault", url: "/vault", icon: HardDrive },
      { title: "My Tasks", url: "/my-tasks", icon: CheckSquare },
      { title: "My Submissions", url: "/submissions", icon: FileText },
      { title: "Calendar", url: "/calendar", icon: Calendar },
      { title: "Room Booking", url: "/room-booking", icon: CalendarClock },
    ],
  },
  {
    label: "Work",
    items: [
      { title: "Projects", url: "/projects", icon: FolderKanban },
      { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
    ],
  },
  {
    label: "Team",
    items: [
      { title: "Attendance", url: "/attendance", icon: ClipboardCheck },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Ticket", url: "/complaints", icon: Ticket },
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "Control Room", url: "/admin", icon: Shield },
    ],
  },
];

export function AppSidebar() {
  const { toggleSidebar } = useSidebar();
  const { isDark, toggle: toggleTheme } = useTheme();
  const { lang, setLang, t } = useLang();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");
  const profileQuery = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 60_000 });
  const me = profileQuery.data?.user;
  // Org role gates management-only nav (Control Room /admin + Crew Hub /teams):
  // visible to BoD/Manager, hidden from Staff (and while role is still unknown).
  const orgRoleQuery = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const canManageOrg = ["ONE_ABOVE_ALL", "BOD", "MANAGER"].includes(orgRoleQuery.data?.role ?? "");
  const canManageAttendance = ["ONE_ABOVE_ALL", "BOD"].includes(orgRoleQuery.data?.role ?? "");
  // No "Pipeline" entry here (owner, 9 Oct 2026: "kenapa pipeline masuk ke mission? … yg masuk ke project
  // doang"): the board is a project like any other, opened from Projects.
  const MANAGER_ONLY_URLS = new Set(["/admin", "/teams"]);

  // Live nav badges. Inbox = unread notifications (shared cache w/ the inbox page). Attendance =
  // pending offsite-checkout approvals (BoD only). Both refresh every 45s + on relevant mutations.
  const notifQuery = useQuery({ queryKey: ["nexus", "notifications"], queryFn: () => nexusApi.notifications(false), retry: false, refetchInterval: 45_000 });
  const offsiteQuery = useQuery({ queryKey: ["offsite-checkouts"], queryFn: () => nexusApi.offsiteCheckouts("PENDING"), enabled: canManageAttendance, retry: false, refetchInterval: 45_000 });
  // Messages = unread chat over rooms that aren't muted (lib/chat-unread.ts), live via the socket.
  const chatUnread = useChatUnread();
  const badgeFor = (url: string): number => {
    if (url === "/inbox") return notifQuery.data?.unreadCount ?? 0;
    if (url === "/messages") return chatUnread;
    if (url === "/attendance") return canManageAttendance ? (offsiteQuery.data?.pendingCount ?? 0) : 0;
    return 0;
  };
  const badgeText = (n: number) => (n > 9 ? "9+" : String(n));
  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((item) => (canManageOrg || !MANAGER_ONLY_URLS.has(item.url))) }))
    .filter((g) => g.items.length > 0);

  const [loggingOut, setLoggingOut] = useState(false);
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await nexusApi.logout(); } catch { /* ignore — clear cookies best-effort, still redirect */ }
    window.location.href = "/login"; // full reload drops all session state
  };

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b border-sidebar-border">
        {/* Stable row (no flex-direction / mount swaps) — the brand text clips via
            overflow as the bar narrows, and the controls fade out via CSS, so the
            logo never jumps or pops when expanding/collapsing. */}
        <div className="flex items-center gap-1 overflow-hidden">
          <Link to="/dashboard" className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2 py-1.5">
            <img src={nexusLogo} alt="NEXUS" className="h-8 w-8 shrink-0 object-contain" />
            <div className="flex min-w-0 flex-col whitespace-nowrap leading-tight">
              <span className="truncate text-sm font-semibold tracking-tight">NEXUS</span>
              <span className="truncate text-[11px] text-muted-foreground">Phaëthon</span>
            </div>
          </Link>
          <button
            onClick={toggleSidebar}
            aria-label="Collapse sidebar"
            title="Collapse (⌘B)"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }))}
          className="mx-2 my-1 flex items-center gap-2 overflow-hidden rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent group-data-[collapsible=icon]:hidden"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate text-left">Search…</span>
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">⌘K</kbd>
        </button>
      </SidebarHeader>

      <SidebarContent>
        {visibleGroups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{t(g.label)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.filter((item) => orgRoleQuery.data?.isCompany === true || (item.url !== "/vault" && item.url !== "/threads")).map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={t(item.title)}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 truncate">{t(item.title)}</span>
                        {badgeFor(item.url) > 0 ? (
                          <span className={cn("ml-auto rounded-full text-[10px] font-bold px-1.5 py-0.5", item.url === "/attendance" ? "bg-amber-500 text-white" : "bg-primary/10 text-primary")}>{badgeText(badgeFor(item.url))}</span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        <SidebarProjectTree />
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2 overflow-hidden px-1 py-1">
          {me?.avatar ? (
            <img src={me.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-sidebar-border" />
          ) : (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary ring-1 ring-sidebar-border">
              {(me?.name ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-xs font-medium">{me?.name ?? "—"}</span>
            <span className="truncate text-[10px] text-muted-foreground">{me?.email ?? ""}</span>
          </div>
          <button
            onClick={toggleTheme}
            aria-label={t("Toggle theme")}
            title={isDark ? t("Light mode") : t("Dark mode")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {/* Language / Bahasa: flips the interface between Indonesian and English (lib/lang.ts). */}
          <button
            onClick={() => setLang(lang === "id" ? "en" : "id")}
            aria-label={t("Language")}
            title={t("Language")}
            className="flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          >
            <Languages className="h-3.5 w-3.5" />
            <span className="text-[10px] font-bold tabular-nums">{lang === "id" ? "ID" : "EN"}</span>
          </button>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            aria-label="Log out"
            title="Log out"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-50 group-data-[collapsible=icon]:hidden"
          >
            {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          </button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
