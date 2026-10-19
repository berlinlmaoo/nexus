import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Inbox, MessageCircle, CheckSquare, Calendar, CalendarClock, FolderKanban,
  Users, Trophy, ClipboardCheck, Settings, Shield, FileText, Megaphone,
  Search, PanelLeftClose, PanelLeftOpen, LogOut, Loader2, AtSign, Ticket, Sun, Moon,
 HardDrive, Languages, Keyboard, Scale,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SidebarProjectTree } from "@/components/SidebarProjectTree";
import { navGroups } from "@/components/nav-groups";
import { GideonAskButton } from "@/components/gideon/GideonLauncher";
import nexusLogo from "@/assets/nexus-logo.png";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";
import { useQuery } from "@tanstack/react-query";
import { nexusApi } from "@/lib/nexus-api";
import { PresenceDot, PresenceLine, usePresence } from "@/lib/presence";
import { SetStatusDialog } from "@/components/SetStatusDialog";
import { useTheme } from "@/lib/theme";
import { useLang } from "@/lib/lang";
import { useChatUnread } from "@/lib/chat-unread";
import { cn } from "@/lib/utils";
import { thumbUrl } from "@/lib/thumb";
import { modKey } from "@/lib/keyboard";
import { openGlobalSearch } from "@/lib/search-event";
import { openShortcutsHelp } from "@/components/ShortcutsHelp";


export function AppSidebar() {
  const { toggleSidebar } = useSidebar();
  const { isDark, toggle: toggleTheme } = useTheme();
  const { lang, setLang, t } = useLang();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navRef = useRef<HTMLDivElement>(null);
  const [navMore, setNavMore] = useState(false);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const read = () => setNavMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => { el.removeEventListener("scroll", read); ro.disconnect(); };
  }, []);
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");
  const profileQuery = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 60_000 });
  const me = profileQuery.data?.user;
  const myStatus = usePresence(me?.id);
  const [statusOpen, setStatusOpen] = useState(false);
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
  // The same cap as the dashboard bell and the phone tab bar ("47", "99+"): the sidebar said "9+" while the bell
  // beside it said "47" for one count (UI tour run 14, R14-WD-13).
  const badgeText = (n: number) => (n > 99 ? "99+" : String(n));
  const visibleGroups = navGroups
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
          {/* Collapsed rail: the logo's place holds the "open sidebar" button (Notion / Linear), so reopening
              is one obvious click instead of hunting for the rail's edge (owner, 14 Oct 2026). */}
          <button
            onClick={toggleSidebar}
            aria-label={t("Expand sidebar")}
            title={t("Expand ({keys})", { keys: modKey("B") })}
            className="mx-auto hidden h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:grid"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
          <Link to="/dashboard" className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2 py-1.5 group-data-[collapsible=icon]:hidden">
            <img src={nexusLogo} alt="NEXUS" data-nexus-logo="" className="h-8 w-8 shrink-0 object-contain dark:invert" />
            <div className="flex min-w-0 flex-col whitespace-nowrap leading-tight">
              <span className="truncate text-sm font-semibold tracking-tight">NEXUS</span>
              <span className="truncate text-[11px] text-muted-foreground">Phaëthon</span>
            </div>
          </Link>
          <button
            onClick={toggleSidebar}
            aria-label={t("Collapse sidebar")}
            title={t("Collapse ({keys})", { keys: modKey("B") })}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
        {/* Search and "Ask GIDEON" share one row. GIDEON's button lives here, not floating over the page
            (UI tour run 11, WD-1): a fixed corner button always ended up on someone's content. */}
        <div className="mx-2 my-1 flex items-center gap-1.5 group-data-[collapsible=icon]:hidden">
          <button
            onClick={openGlobalSearch}
            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate text-left">{t("Search…")}</span>
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{modKey("K")}</kbd>
          </button>
          <GideonAskButton />
        </div>
      </SidebarHeader>

      {/* Short desktop screens (≤960px tall, mouse): a denser nav, so the last entry (Control Room) is not
          hidden under the footer at 1440×900 (QA 13 Oct 2026). Touch keeps its 32px+ rows. */}
      {/* While more of the nav lies below, its bottom edge fades into the footer instead of cutting a label in
          half ("Folders", UI tour run 13, W-D7). The last 0.75rem is fully clear and the fade runs over the
          row above it: a 2rem fade still left the top half of the next row (or project icon, in the collapsed
          rail) readable right on the footer line (UI tour run 14, R14-WD-4 / R14-WD-15). */}
      {/* The fade is a band of the sidebar's colour pinned to the nav's bottom (not a mask over everything), so a
          section header can be drawn over it whole: "Projects" in the fade read as disabled (UI tour run 15,
          R15-WD-10). */}
      <SidebarContent ref={navRef} className={cn("[@media(max-height:960px)_and_(pointer:fine)]:[&_[data-sidebar=group]]:py-1 [@media(max-height:960px)_and_(pointer:fine)]:[&_[data-sidebar=group-label]]:h-6 [@media(max-height:960px)_and_(pointer:fine)]:[&_[data-sidebar=menu]]:gap-0.5 [@media(max-height:960px)_and_(pointer:fine)]:[&_[data-sidebar=menu-button]]:h-7")}>
        {/* Collapsed to icons, the rail spreads its icons evenly over the full height (owner, 18 Oct 2026): each group
            grows by its number of items, and the items share the group's height. */}
        {visibleGroups.map((g) => { const items = g.items.filter((item) => (orgRoleQuery.data?.isCompany === true || (item.url !== "/vault" && item.url !== "/threads" && item.url !== "/room-booking")) && (orgRoleQuery.data?.canAccessLegal === true || item.url !== "/legal")); return (
          <SidebarGroup key={g.label} style={{ ["--n" as string]: items.length } as import("react").CSSProperties} className="group-data-[collapsible=icon]:min-h-0 group-data-[collapsible=icon]:[flex:var(--n)_1_0px]">
            <SidebarGroupLabel>{t(g.label)}</SidebarGroupLabel>
            <SidebarGroupContent className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:flex-1">
              <SidebarMenu className="group-data-[collapsible=icon]:flex-1 group-data-[collapsible=icon]:justify-around">
                {items.map((item) => (
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
        ); })}

        {/* Collapsed to icons the rail ends at Control Room: the project list is hidden (owner, 18 Oct 2026). */}
        <div className="contents group-data-[collapsible=icon]:hidden"><SidebarProjectTree /></div>
        {navMore && <div aria-hidden className="pointer-events-none sticky bottom-0 z-[5] -mt-14 h-14 shrink-0 bg-[linear-gradient(to_top,var(--sidebar)_0.75rem,transparent)]" />}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {/* Who's signed in gets the whole row and the actions sit on their own row under it: on one row the
            four buttons left "QA D…" / "qa5@…" (UI tour run 10, WD-7). The full name and email are on hover. */}
        <div className="flex flex-col gap-1 overflow-hidden px-1 py-1">
        {/* The identity row sets one's presence status (19 Oct 2026); the status replaces the email line while the
            feature is on (the email stays in the tooltip). */}
        <button
          type="button"
          onClick={() => setStatusOpen(true)}
          disabled={!myStatus}
          className="flex min-w-0 items-center gap-2 rounded-md text-left transition-colors enabled:hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:cursor-default"
          title={[me?.name, me?.email, myStatus ? t("Set a status") : null].filter(Boolean).join("\n") || undefined}
        >
          <span className="relative shrink-0">
            {me?.avatar ? (
              <img src={thumbUrl(me.avatar, 40)} loading="lazy" decoding="async" alt="" className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-sidebar-border" />
            ) : (
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary ring-1 ring-sidebar-border">
                {(me?.name ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}
              </span>
            )}
            {myStatus && <PresenceDot status={myStatus} size={9} className="absolute -bottom-px -right-px outline-sidebar" />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-xs font-medium">{me?.name ?? "—"}</span>
            {myStatus ? <PresenceLine userId={me?.id} showUntil={false} className="flex max-w-full text-[10px]" /> : <span className="truncate text-[10px] text-muted-foreground">{me?.email ?? ""}</span>}
          </span>
        </button>
        <SetStatusDialog open={statusOpen} onOpenChange={setStatusOpen} meId={me?.id} />
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:hidden">
          <button
            onClick={toggleTheme}
            aria-label={t("Toggle theme")}
            title={isDark ? t("Light mode") : t("Dark mode")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {/* Every keyboard shortcut of the app (also "?" / ⌘/ anywhere). */}
          <button
            onClick={openShortcutsHelp}
            aria-label={t("Keyboard shortcuts")}
            title={t("Keyboard shortcuts (?)")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          >
            <Keyboard className="h-4 w-4" />
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
            aria-label={t("self\u0004Sign out")}
            title={t("self\u0004Sign out")}
            className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-50 group-data-[collapsible=icon]:hidden"
          >
            {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          </button>
        </div>
        </div>
      </SidebarFooter>
      <SidebarRail aria-label={t("Show or hide the sidebar")} />
    </Sidebar>
  );
}
