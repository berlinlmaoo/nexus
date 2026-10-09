import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  LayoutDashboard, Inbox, CheckSquare, FolderKanban, Menu, X,
  MessageCircle, Calendar, CalendarClock, Users, Trophy,
  ClipboardCheck, Settings, Shield, LogOut, Loader2, FileText, AtSign, ShieldAlert, Ticket, Sun, Moon,
 HardDrive, Languages, Filter,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { nexusApi, activeNotifications } from "@/lib/nexus-api";
import { useTheme } from "@/lib/theme";
import { useLang } from "@/lib/lang";
import { useChatUnread } from "@/lib/chat-unread";
import { cn } from "@/lib/utils";

/* Primary destinations live in the floating bar; everything else lives in the
   "More" glass sheet (replaces the old left slide-out sidebar on mobile). */
const primary = [
  { title: "Home", url: "/dashboard", icon: LayoutDashboard },
  // Chat took Tasks' place (owner, 9 Oct 2026, as in the app); My Mission stays in More. The Chat tab
  // carries the unread chats.
  { title: "Chat", url: "/messages", icon: MessageCircle },
  // Calendar took Inbox's place (owner, 8 Oct 2026); notifications live in More, whose button carries
  // the unread count instead.
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Projects", url: "/projects", icon: FolderKanban },
] as const;

const moreGroups = [
  {
    label: "Home Base",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Messages", url: "/messages", icon: MessageCircle },
      { title: "Notification", url: "/inbox", icon: Inbox },
      { title: "Threads", url: "/threads", icon: AtSign },
      { title: "Z Vault", url: "/vault", icon: HardDrive },
      { title: "My Mission", url: "/my-tasks", icon: CheckSquare },
      { title: "My Submissions", url: "/submissions", icon: FileText },
      { title: "Calendar", url: "/calendar", icon: Calendar },
      { title: "Room Booking", url: "/room-booking", icon: CalendarClock },
    ],
  },
  {
    label: "Missions",
    items: [
      { title: "Mission Control", url: "/projects", icon: FolderKanban },
      { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
      { title: "Integrity", url: "/peer-reports", icon: ShieldAlert },
    ],
  },
  {
    label: "Pulse Check",
    items: [
      { title: "Attendance", url: "/attendance", icon: ClipboardCheck },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Ticket", url: "/complaints", icon: Ticket },
      { title: "Setting", url: "/settings", icon: Settings },
      { title: "Control Room", url: "/admin", icon: Shield },
    ],
  },
] as const;

export function MobileTabBar() {
  const { t: tr } = useLang();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const reduce = useReducedMotion();
  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

  const notif = useQuery({ queryKey: ["notifications-unread"], queryFn: () => nexusApi.notifications(), retry: 1 });
  const unread = notif.data?.unreadCount ?? activeNotifications(notif.data?.notifications ?? []).filter((n) => !n.read).length;
  // Chat has its own tab and its own count; More carries the notifications'.
  const chatUnread = useChatUnread();
  const moreBadge = unread;

  // Active slot: a matching primary tab, else "More" (index 4) when you're on a
  // secondary destination reachable through the sheet.
  const matched = primary.findIndex((t) => isActive(t.url));
  const activeIndex = matched === -1 ? 4 : matched;

  // Slide the glass indicator under the active slot (measured for px-accuracy).
  const navRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLElement | null)[]>([]);
  const [ind, setInd] = useState({ left: 0, width: 0, ready: false });
  useLayoutEffect(() => {
    const measure = () => {
      const el = slotRefs.current[activeIndex];
      const wrap = navRef.current;
      if (!el || !wrap) return;
      const a = el.getBoundingClientRect();
      const b = wrap.getBoundingClientRect();
      // Inset the highlight from the slot edges so it reads as a selection pill,
      // not a hard box jammed against the bar's rounded corners.
      const pad = 8;
      setInd({ left: a.left - b.left + pad, width: Math.max(0, a.width - pad * 2), ready: true });
    };
    measure();
    const id = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(id); window.removeEventListener("resize", measure); };
  }, [activeIndex]);

  return (
    <>
      <nav className="md:hidden fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto w-[min(92%,26rem)] px-0">
        {/* liquid-glass pill */}
        <div
          ref={navRef}
          className="relative isolate flex items-stretch rounded-[26px]"
        >
          {/* 1. backdrop: refracts the page via #nexus-glass on Chrome, blur+saturate frost on Safari */}
          <div
            aria-hidden
            className="absolute inset-0 -z-10 overflow-hidden rounded-[26px]"
            style={{ backdropFilter: 'url("#nexus-glass") blur(3px) saturate(160%)', WebkitBackdropFilter: "blur(18px) saturate(180%)" }}
          />
          {/* 2. thick-glass edges + faint tint */}
          <div aria-hidden className="glass-bar absolute inset-0 rounded-[26px]" />
          {/* sliding active indicator — a raised glass lozenge */}
          {ind.ready && (
            <motion.span
              aria-hidden
              className="glass-indicator absolute bottom-2 top-2 z-[1] rounded-2xl"
              animate={{ left: ind.left, width: ind.width }}
              initial={false}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
            />
          )}

          {primary.map((t, i) => {
            const active = activeIndex === i;
            return (
              <Link
                key={t.url}
                to={t.url}
                ref={(el: HTMLAnchorElement | null) => { slotRefs.current[i] = el; }}
                className={cn(
                  "relative z-10 flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="relative">
                  <t.icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.5 : 2} />
                  {t.url === "/messages" && chatUnread > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">{chatUnread > 99 ? "99+" : chatUnread}</span>
                  )}
                </span>
                <span>{tr(t.title)}</span>
              </Link>
            );
          })}

          {/* More → glass sheet */}
          <button
            type="button"
            ref={(el) => { slotRefs.current[4] = el; }}
            onClick={() => setMoreOpen(true)}
            aria-label="More"
            className={cn(
              "relative z-10 flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors",
              activeIndex === 4 ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Menu className="h-[22px] w-[22px]" strokeWidth={activeIndex === 4 ? 2.5 : 2} />
            {moreBadge > 0 && (
              <span className="absolute left-1/2 top-1 ml-2 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">{moreBadge > 99 ? "99+" : moreBadge}</span>
            )}
            <span>{tr("More")}</span>
          </button>
          <GlassFilter />
        </div>
      </nav>

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} isActive={isActive} unread={unread} chatUnread={chatUnread} />
    </>
  );
}

/* SVG displacement filter that warps the backdrop like real refracting glass.
   Chrome honours backdrop-filter:url(#…); Safari ignores it → frost fallback. */
function GlassFilter() {
  return (
    <svg aria-hidden className="absolute h-0 w-0">
      <defs>
        <filter id="nexus-glass" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.009 0.009" numOctaves="2" seed="7" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="2" result="blurred" />
          <feDisplacementMap in="SourceGraphic" in2="blurred" scale="30" xChannelSelector="R" yChannelSelector="B" />
        </filter>
      </defs>
    </svg>
  );
}

function MoreSheet({ open, onClose, isActive, unread, chatUnread }: { open: boolean; onClose: () => void; isActive: (p: string) => boolean; unread: number; chatUnread: number }) {
  const reduce = useReducedMotion();
  const me = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 60_000 }).data?.user;
  const { isDark, toggle: toggleTheme } = useTheme();
  const { lang, setLang, t } = useLang();
  // Org role gates management-only nav (Control Room + Crew Hub) — hidden from Staff.
  const membersInfo = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 }).data;
  const orgRole = membersInfo?.role;
  // Z Vault and Threads are the company's (Z Networks) only.
  const isCompany = membersInfo?.isCompany === true;
  // The company's one deal board (owner/GM, 9 Oct 2026), for its project members only (9 Oct evening).
  const pipelineProjectId = membersInfo?.canAccessPipeline ? membersInfo.pipelineProjectId ?? null : null;
  const canManageOrg = ["ONE_ABOVE_ALL", "BOD", "MANAGER"].includes(orgRole ?? "");
  // Threads / Integrity show in nav for ALL roles; Manager-and-below land on a "Coming Soon"
  // page there. Ticket is OPEN to everyone since 2026-07-29 (staff see only their own tickets).
  // page (gated inside each route component) — no ETA yet, so we tease, not hide.
  const visibleGroups = moreGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => canManageOrg || i.url !== "/admin") }))
    .filter((g) => g.items.length > 0);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  const [loggingOut, setLoggingOut] = useState(false);
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await nexusApi.logout(); } catch { /* ignore — still redirect */ }
    window.location.href = "/login";
  };
  if (typeof document === "undefined") return null;
  const initials = (me?.name ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="md:hidden fixed inset-0 z-[60]">
          <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
            initial={reduce ? { opacity: 0 } : { y: "100%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 360, damping: 36 }}
            className="glass-sheet absolute inset-x-0 bottom-0 max-h-[82vh] overflow-hidden rounded-t-[28px]"
          >
            {/* grab handle */}
            <div className="relative flex items-center justify-between px-5 pt-3">
              <div className="mx-auto h-1.5 w-10 rounded-full bg-foreground/15" />
              <button onClick={onClose} aria-label="Close" className="absolute right-3 top-2.5 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X className="h-4 w-4" /></button>
            </div>
            <div className="relative max-h-[calc(82vh-3.5rem)] overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
              {visibleGroups.map((g) => (
                <div key={g.label} className="mb-3">
                  <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t(g.label)}</div>
                  <div className="grid grid-cols-1 gap-0.5">
                    {g.items.filter((item) => isCompany || (item.url !== "/vault" && item.url !== "/threads")).map((item) => {
                      const active = isActive(item.url);
                      return (
                        <Link
                          key={item.title}
                          to={item.url}
                          onClick={onClose}
                          className={cn(
                            "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                            active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent",
                          )}
                        >
                          <item.icon className="h-[18px] w-[18px] shrink-0" />
                          <span className="flex-1">{t(item.title)}</span>
                          {item.url === "/inbox" && unread > 0 && (
                            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{unread}</span>
                          )}
                          {item.url === "/messages" && chatUnread > 0 && (
                            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{chatUnread > 99 ? "99+" : chatUnread}</span>
                          )}
                        </Link>
                      );
                    })}
                    {g.label === "Missions" && pipelineProjectId && (
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: pipelineProjectId }}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                          isActive(`/projects/${pipelineProjectId}`) ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent",
                        )}
                      >
                        <Filter className="h-[18px] w-[18px] shrink-0" />
                        <span className="flex-1">{t("Pipeline")}</span>
                      </Link>
                    )}
                  </div>
                </div>
              ))}
              {/* profile footer */}
              <Link to="/settings" onClick={onClose} className="mt-1 flex items-center gap-3 rounded-2xl border border-border/60 bg-background/40 px-3 py-2.5">
                {me?.avatar ? (
                  <img src={me.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-border" />
                ) : (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary ring-1 ring-border">{initials}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{me?.name ?? "—"}</div>
                  <div className="truncate text-xs text-muted-foreground">{me?.email ?? ""}</div>
                </div>
                <Settings className="h-4 w-4 text-muted-foreground" />
              </Link>
              <button
                onClick={toggleTheme}
                className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-background/40 px-3 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
              >
                {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
                <span className="flex-1 text-left">{isDark ? t("Light mode") : t("Dark mode")}</span>
              </button>
              {/* Language / Bahasa: flips the interface between Indonesian and English (lib/lang.ts). */}
              <button
                onClick={() => setLang(lang === "id" ? "en" : "id")}
                className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-background/40 px-3 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
              >
                <Languages className="h-[18px] w-[18px]" />
                <span className="flex-1 text-left">{t("Language")}</span>
                <span className="text-xs font-medium text-muted-foreground">{lang === "id" ? "Bahasa Indonesia" : "English"}</span>
              </button>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:opacity-60"
              >
                {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />} Log out
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
