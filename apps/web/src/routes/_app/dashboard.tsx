import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ProjectMarkFor, ProjectPageIcon } from "@/components/projects/ProjectIcon";
import { openGlobalSearch } from "@/lib/search-event";
import { modKey } from "@/lib/keyboard";
import { AndroidAppBanner } from "@/components/attendance/IosAppCheckInCard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Search,
  FolderKanban,
  ListChecks,
  Sparkles,
  Flame,
  Pencil,
  Check,
  Crown,
  X,
  Maximize2,
  Loader2,
  RotateCw,
  } from "lucide-react";

import learner from "@/assets/philearn/learner.png";
import sophia from "@/assets/philearn/sophia.png";
import { cn } from "@/lib/utils";
import { competitionRank } from "@/lib/competition-rank";
import { useLang } from "@/lib/lang";
import { Avatar } from "@/components/Avatar";
import { notificationMessage, notificationTitle } from "@/lib/server-text";
import { chatUnreadTotal } from "@/lib/chat-unread";
import { isSystemMessage, systemSentence } from "@/lib/chat-system";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { XpRulesCard } from "@/components/XpRulesCard";
import { UserXpLogModal } from "@/components/UserXpLogModal";
import { MorphPanel, type MorphOrigin } from "@/components/motion/MorphPanel";
import { activeNotifications, fmtTime, nexusApi, notificationGroup, statusLabel, type NexusDashboardResponse, type NexusProject, type NexusTask, type NexusQuest, type NexusConversation, type NexusUser, type NexusNotification, type NexusLeaderboardRow, type NotificationGroupId } from "@/lib/nexus-api";
import { NotificationFilterTabs } from "@/components/NotificationFilterTabs";
import { LEVELS, levelForXp } from "@/lib/levels";
import { TierBadge } from "@/components/gamification/TierBadge";
import { Reveal, AnimatedBar, CountUp } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { monthGrid, sameMonth, shiftMonth } from "@/lib/calendar/core";
import { thumbUrl } from "@/lib/thumb";

export const Route = createFileRoute("/_app/dashboard")({
  // `quest` comes from the quest_claimable notification: "<questKey>:<periodKey>".
  validateSearch: (s: Record<string, unknown>): { quest?: string } => ({
    quest: typeof s.quest === "string" && s.quest ? s.quest : undefined,
  }),
  component: Dashboard,
  head: () => ({ meta: [{ title: "NEXUS Phaëthon — Dashboard" }] }),
});

// Short day ("5 Oct" / "5 Okt") in the interface language; with a time when the value carries one.
function fmtDay(value: string | null | undefined, locale: string) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}
function fmtDueDay(value: string | null | undefined, locale: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;
  return hasTime ? `${fmtDay(value, locale)}, ${fmtTime(value)}` : fmtDay(value, locale);
}

// Before the dashboard loads (or if it fails) the stats show zeros: never demo data. It used to fall
// back to sample projects/tasks ("NEXUS Revamp", "Sophia Carie", 5 unread) whenever someone had no
// projects and no tasks yet (audit, 12 Oct 2026).
const emptyDashboard: NexusDashboardResponse = {
  stats: { totalTasks: 0, inProgressTasks: 0, overdueTasks: 0, completedThisWeek: 0 },
  projects: [],
  tasks: [],
  sprints: [],
  goals: [],
};

function Dashboard() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: nexusApi.dashboard, retry: 1 });
  const notifications = useQuery({ queryKey: ["notifications-unread"], queryFn: () => nexusApi.notifications(), retry: 1 });

  const live = dashboard.data;
  const data: NexusDashboardResponse = live ?? emptyDashboard;
  const userName = profile.data?.user?.name ?? "";

  return (
    <div className="w-full px-5 py-6 md:px-8 md:py-8 2xl:px-10">
      <OnboardingWizard />
      <TopBar userName={userName} unread={notifications.data?.unreadCount ?? 0} />
      <AndroidAppBanner className="mt-5" />

      <div className="mt-7 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-8">
        {/* main: stats, XP rules. No "Your Quests" card: the owner dropped it; quests are
            listed and claimed inside the Quest stat card. */}
        <div className="space-y-6">
          <StatRow data={data} />
          <Reveal delay={0.1}><XpRulesCard /></Reveal>
          {/* The calendar and schedule sit under XP rules on every width, as on the desktop (QA S-26 put
              them in the main column; the UI tour of 13 Oct 2026 found the phone showing them only after
              the whole rail, and a double gap where the hidden copy was). Two columns from xl. */}
          <div data-dashboard-main-cal="" className="grid gap-6 xl:grid-cols-2">
            <Reveal delay={0.15}><CalendarCard /></Reveal>
            <Reveal delay={0.2}><ScheduleCard /></Reveal>
          </div>
        </div>

        {/* right rail */}
        <aside className="space-y-6">
          <Reveal delay={0.05}><ProfileCard userName={userName} avatarUrl={profile.data?.user?.avatar} /></Reveal>
          <Reveal delay={0.1}><MessagesCard /></Reveal>
          <Reveal delay={0.15}><LeaderboardCard /></Reveal>
        </aside>
      </div>
    </div>
  );
}

/* ---------- top bar ---------- */
/* Uses the SAME grid template as the content grid below, so the level chip's
   right edge (in the main zone) lines up with the stat cards / Quest card,
   while search + notifications sit in the right-rail zone. */
function TopBar({ userName, unread }: { userName: string; unread: number }) {
  const { t } = useLang();
  const hour = new Date().getHours();
  const greeting = hour < 11 ? t("Good morning,") : hour < 18 ? t("Good afternoon,") : t("Good evening,");
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-6 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-8">
      {/* main zone: greeting (left) + level chip (right, aligns with stat cards).
          On phones the chip drops below so the greeting gets full width (2 lines,
          not 4); sm+ keeps the original side-by-side row — desktop unchanged. */}
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <p className="text-xl font-medium text-foreground/80">{greeting}</p>
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{userName}!</h1>
        </div>
        <LevelChip />
      </div>
      {/* rail zone: search + notifications */}
      <div className="flex items-center gap-3">
        {/* Opens the global search (⌘K), like the sidebar's box. It was an input with no handler (QA B12). */}
        <button
          type="button"
          data-dashboard-search=""
          onClick={openGlobalSearch}
          aria-label={t("Search")}
          aria-haspopup="dialog"
          className="flex h-12 min-w-0 flex-1 cursor-text items-center gap-2 rounded-full border border-border bg-card px-5 text-left text-sm text-muted-foreground transition-shadow hover:border-primary/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t("Search…")}</span>
          <kbd className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] md:inline">{modKey("K")}</kbd>
        </button>
        <NotificationsBell unread={unread} />
      </div>
    </div>
  );
}

/* Notification bell → morphs into a detail modal (same expand pattern as the
   stat cards / level chip / messages card), instead of navigating to /inbox. */
function NotificationsBell({ unread }: { unread: number }) {
  const { t, tn } = useLang();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["notifications-unread"], queryFn: () => nexusApi.notifications(), retry: 1 });
  // Hide notifications read more than a week ago (matches the Inbox page).
  const list = activeNotifications(q.data?.notifications ?? []);
  const count = q.data?.unreadCount ?? unread;
  return (
    <>
      <motion.button
        type="button"
        layoutId={reduce ? undefined : "notif-bell"}
        onClick={() => setOpen(true)}
        aria-label={count > 0 ? tn(count, "Notifications, {n} unread. Open", "Notifications, {n} unread. Open") : t("Notifications. Open")}
        whileHover={reduce ? undefined : { y: -2 }}
        whileTap={reduce ? undefined : { scale: 0.96 }}
        className="relative grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">{count}</span>
        )}
      </motion.button>
      <NotificationsModal open={open} onClose={() => setOpen(false)} list={list} unread={count} loading={q.isLoading} error={q.isError} />
    </>
  );
}

function NotificationsModal({ open, onClose, list, unread, loading, error }: { open: boolean; onClose: () => void; list: NexusNotification[]; unread: number; loading: boolean; error: boolean }) {
  const { t, locale } = useLang();
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications-unread"] });
  const markRead = useMutation({ mutationFn: (id: string) => nexusApi.markNotificationRead(id), onSuccess: refresh });
  const markAll = useMutation({ mutationFn: nexusApi.markAllNotificationsRead, onSuccess: refresh });
  const [group, setGroup] = useState<NotificationGroupId>("all");
  const shown = useMemo(
    () => (group === "all" ? list : list.filter((n) => notificationGroup(n.type) === group)),
    [list, group],
  );
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-black/50 dark:bg-scrim backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            layoutId={reduce ? undefined : "notif-bell"}
            role="dialog"
            aria-modal="true"
            aria-label={t("Notifications")}
            initial={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            animate={reduce ? { opacity: 1, scale: 1 } : undefined}
            exit={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-border bg-card text-card-foreground shadow-2xl"
          >
            <button onClick={onClose} aria-label={t("Close")} className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X className="h-4 w-4" /></button>
            {/* header */}
            <div className="flex items-center gap-3 border-b border-border p-5 pr-12">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Bell className="h-6 w-6" /></span>
              <div className="min-w-0">
                <div className="font-display text-xl font-bold tracking-tight">{t("Notifications")}</div>
                <div className="text-xs text-muted-foreground">{unread > 0 ? t("{n} unread", { n: unread }) : t("All caught up")}</div>
              </div>
              {unread > 0 && (
                <button onClick={() => markAll.mutate()} disabled={markAll.isPending} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
                  {markAll.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {t("Mark all read")}
                </button>
              )}
            </div>
            {/* list */}
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.15, duration: 0.25 }}
              className="min-h-0 flex-1 overflow-y-auto p-2"
            >
              {loading && <p className="p-3 text-sm text-muted-foreground">{t("Loading…")}</p>}
              {error && <p className="p-3 text-sm text-muted-foreground">{t("Sign in to see your notifications.")}</p>}
              {!loading && !error && list.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t("No notifications.")}</p>}
              {!loading && !error && list.length > 0 && (
                <div className="px-1 pb-2">
                  <NotificationFilterTabs list={list} group={group} onChange={setGroup} layoutId="bell-filter-tab" compact />
                </div>
              )}
              {!loading && !error && list.length > 0 && shown.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t("Nothing of this kind.")}</p>}
              {shown.map((n) => (
                <button
                  key={n.id}
                  onClick={() => { if (!n.read) markRead.mutate(n.id); }}
                  className={cn("flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", !n.read && "bg-primary/[0.04]")}
                >
                  {n.actor?.id
                    ? <Avatar userId={n.actor.id} name={n.actor.name} avatar={n.actor.avatar} size={36} className="mt-0.5 shrink-0" />
                    : <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Bell className="h-4 w-4" /></span>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{notificationTitle(n)}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{notificationMessage(n) || t("New notification")}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtDay(n.createdAt, locale)}</div>
                  </div>
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                </button>
              ))}
            </motion.div>
            {/* footer */}
            <div className="border-t border-border p-3">
              <Link to="/inbox" onClick={onClose} className="flex h-10 items-center justify-center gap-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                {t("See all notifications")} <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------- section card shell ---------- */
function Section({ title, action, className, children, morphId, contentHidden, dim }: { title: string; action?: React.ReactNode; className?: string; children: React.ReactNode; morphId?: string; contentHidden?: boolean; dim?: boolean }) {
  return (
    <motion.section
      layoutId={morphId}
      // `dim`: fade the WHOLE card out while its genie modal zooms open from this spot, so the card
      // doesn't sit there duplicated ("card di tempat semula"). Space is kept (opacity only) → no shift.
      animate={{ opacity: dim ? 0 : 1 }}
      transition={{ duration: 0.18 }}
      className={cn("rounded-3xl border border-border bg-card p-5 shadow-soft", className)}
    >
      {/* contentHidden: while the card itself is morphing into a modal, hide its content so it
          doesn't crossfade ("kebawa") — only the card box morphs. */}
      <div className={cn(contentHidden && "opacity-0")}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-display text-base font-semibold tracking-tight">{title}</h3>
          {action}
        </div>
        {children}
      </div>
    </motion.section>
  );
}

function SeeAll({ to, label }: { to: string; label?: string }) {
  const { t } = useLang();
  return <Link to={to} className="tap-area rounded text-xs font-medium text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{label ?? t("See all")}</Link>;
}

/** Tasks assigned to the currently logged-in user (uses /api/tasks?assigneeId=me). */
function useMyTasks() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const myId = profile.data?.user?.id;
  return useQuery({
    queryKey: ["nexus", "tasks", "assignee", myId],
    queryFn: () => nexusApi.tasks(`assigneeId=${myId}`),
    enabled: !!myId,
    retry: false,
    staleTime: 60_000,
  });
}

/* ---------- stat cards (expandable → reveal detail) ---------- */
type StatCard = {
  value: number;
  total?: number;
  label: string;
  Icon: typeof FolderKanban;
  from: string;
  to: string;
  glow: string;
  detail: React.ReactNode;
  /** Set when the card's request failed: the card shows "—" and a retry instead of a fake 0 (QA 13 Oct 2026). */
  retry?: () => void;
};

function StatRow(_: { data: NexusDashboardResponse }) {
  // Accurate per-user sources: full project list + tasks assigned to me + my quests.
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: nexusApi.projects, retry: 1, staleTime: 60_000 });
  const myTasks = useMyTasks();
  const g = useGamification();
  const claim = useClaimQuest();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [active, setActive] = useState<number | null>(null);

  const projectList = projectsQ.data ?? [];
  const quests = g.data?.quests ?? [];

  // Hide tasks done more than a month ago (uses updatedAt as the completion proxy); open tasks
  // always stay. Same window as the app's card (owner, 9 Oct 2026: done tasks from April still
  // showed there; this page used 3 days, now both use 30).
  const DONE_WINDOW = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const taskList = (myTasks.data ?? []).filter((t) => {
    const done = (t.status ?? "").toUpperCase() === "DONE";
    if (!done) return true;
    const ts = t.updatedAt ? new Date(t.updatedAt).getTime() : 0;
    return ts > 0 && now - ts <= DONE_WINDOW;
  });
  const tasksDone = taskList.filter((t) => (t.status ?? "").toUpperCase() === "DONE").length;
  const questsDone = quests.filter((q) => q.claimed).length;

  const cards: StatCard[] = [
    {
      value: projectList.length, label: "Projects", Icon: ProjectPageIcon as unknown as typeof FolderKanban,
      from: "#c4b5fd", to: "#7c3aed", glow: "#a78bfa",
      retry: projectsQ.isError && !projectsQ.data ? () => void projectsQ.refetch() : undefined,
      detail: <ProjectsDetail projects={projectList} />,
    },
    {
      value: tasksDone, total: taskList.length, label: "Tasks", Icon: ListChecks,
      from: "#6ee7b7", to: "#059669", glow: "#34d399",
      retry: myTasks.isError && !myTasks.data ? () => void myTasks.refetch() : undefined,
      detail: <TasksDetail tasks={taskList} />,
    },
    {
      value: questsDone, total: quests.length, label: "Quests", Icon: Sparkles,
      from: "#fcd34d", to: "#ea580c", glow: "#fbbf24",
      retry: g.isError && !g.data ? () => void g.refetch() : undefined,
      detail: <QuestsDetail quests={quests} claim={claim} focusKey={search.quest?.split(":")[0]} />,
    },
  ];

  // A quest_claimable notification lands on /dashboard?quest=<key>:<period>: open the Quest card.
  const questCard = cards.findIndex((c) => c.label === "Quests");
  useEffect(() => {
    if (search.quest) setActive(questCard);
  }, [search.quest, questCard]);
  const close = () => {
    setActive(null);
    // Drop the param so closing sticks (no reopen on re-render / refresh).
    if (search.quest) navigate({ to: "/dashboard", search: {}, replace: true }).catch(() => {});
  };

  return (
    <>
      <div className="grid grid-cols-3 items-stretch gap-3 sm:gap-5">
        {cards.map((c, i) => (
          <StatCardButton key={c.label} card={c} index={i} onOpen={() => (c.retry ? c.retry() : setActive(i))} />
        ))}
      </div>
      <StatCardModal cards={cards} active={active} onClose={close} />
    </>
  );
}

/** Collapsed card in the grid. Shares a `layoutId` with the modal so it morphs open. */
function StatCardButton({ card, index, onOpen }: { card: StatCard; index: number; onOpen: () => void }) {
  const { t } = useLang();
  const reduce = useReducedMotion();
  const { Icon } = card;
  return (
    <motion.button
      type="button"
      layoutId={reduce ? undefined : `stat-card-${index}`}
      onClick={onOpen}
      aria-label={card.retry ? t("{label}: couldn't load. Try again", { label: t(card.label) }) : card.total != null ? t("{label}: {n} of {total}. Open details", { label: t(card.label), n: card.value, total: card.total }) : t("{label}: {n}. Open details", { label: t(card.label), n: card.value })}
      initial={reduce ? false : { opacity: 0, y: 18, scale: 0.97 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ type: "spring", stiffness: 260, damping: 24, delay: index * 0.07 }}
      whileHover={reduce ? undefined : { y: -4 }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      className="group relative flex h-full w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl px-3 py-5 text-center text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:px-4 dark:shadow-none!"
      style={{ backgroundImage: `linear-gradient(150deg, ${card.from} 0%, ${card.to} 100%)`, boxShadow: `0 12px 28px -12px ${card.glow}` }}
    >
      <span className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/20 blur-2xl" />
      <Maximize2 className="absolute right-3 top-3 h-3.5 w-3.5 text-white/50 transition-colors group-hover:text-white/90" />
      <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-2xl bg-white/25 backdrop-blur-sm">
        <Icon className="h-5 w-5" strokeWidth={2.5} />
      </span>
      <div className="font-display text-3xl font-bold tracking-tight drop-shadow-sm md:text-4xl">
        {card.retry ? "—" : <CountUp value={card.value} />}
        {!card.retry && card.total != null && <span className="text-white/70">/{card.total}</span>}
      </div>
      <div className="mt-1.5 text-sm font-medium text-white/85">{t(card.label)}</div>
      {card.retry && <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-white/90"><RotateCw className="h-3 w-3" /> {t("Couldn't load · Try again")}</div>}
    </motion.button>
  );
}

/** Expanded view — card morphs into a larger centered modal (shared layoutId). */
function StatCardModal({ cards, active, onClose }: { cards: StatCard[]; active: number | null; onClose: () => void }) {
  const { t } = useLang();
  const reduce = useReducedMotion();
  useEffect(() => {
    if (active == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [active, onClose]);

  if (typeof document === "undefined") return null;
  const card = active != null ? cards[active] : null;

  return createPortal(
    <AnimatePresence>
      {active != null && card && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          <motion.div
            className="absolute inset-0 bg-black/50 dark:bg-scrim backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            layoutId={reduce ? undefined : `stat-card-${active}`}
            role="dialog"
            aria-modal="true"
            aria-label={t(card.label)}
            initial={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            animate={reduce ? { opacity: 1, scale: 1 } : undefined}
            exit={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl text-white shadow-2xl"
            style={{ backgroundImage: `linear-gradient(150deg, ${card.from} 0%, ${card.to} 100%)` }}
          >
            <span className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/20 blur-2xl" />
            <button onClick={onClose} aria-label={t("Close")} className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
              <X className="h-4 w-4" />
            </button>
            <div className="flex shrink-0 items-center gap-4 px-6 pb-4 pt-6">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/25 backdrop-blur-sm">
                <card.Icon className="h-7 w-7" strokeWidth={2.5} />
              </span>
              <div>
                <div className="font-display text-4xl font-bold leading-none tracking-tight drop-shadow-sm">
                  {card.value}{card.total != null && <span className="text-white/70">/{card.total}</span>}
                </div>
                <div className="mt-1.5 text-sm font-medium text-white/85">{t(card.label)}</div>
              </div>
            </div>
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.15, duration: 0.25 }}
              className="min-h-0 overflow-y-auto px-6 pb-6"
            >
              <div className="rounded-2xl bg-black/10 p-3">{card.detail}</div>
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* mini white progress bar for use inside the colored stat cards */
function WhiteBar({ pct }: { pct: number }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-white/25">
      <span className="block h-full rounded-full bg-white" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

function StatDetailEmpty({ text }: { text: string }) {
  return <p className="py-1 text-center text-xs text-white/70">{text}</p>;
}

function ProjectsDetail({ projects }: { projects: NexusProject[] }) {
  const { t } = useLang();
  if (projects.length === 0) return <StatDetailEmpty text={t("No projects yet.")} />;
  return (
    <div className="space-y-1.5">
      {projects.map((p) => (
        <Link key={p.id} to="/projects/$projectId" params={{ projectId: p.id }} className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          <div className="flex items-center justify-between gap-2 text-xs font-medium">
            <span className="truncate">{p.name}</span>
            <span className="shrink-0 tabular-nums text-white/80">{p.progress ?? 0}%</span>
          </div>
          <div className="mt-1"><WhiteBar pct={p.progress ?? 0} /></div>
        </Link>
      ))}
    </div>
  );
}

function TasksDetail({ tasks }: { tasks: NexusTask[] }) {
  const { t } = useLang();
  if (tasks.length === 0) return <StatDetailEmpty text={t("No tasks assigned to you.")} />;
  return (
    <div className="space-y-1">
      {tasks.map((task) => {
        const done = (task.status ?? "").toUpperCase() === "DONE";
        return (
          <Link key={task.id} to="/tasks/$taskId" params={{ taskId: task.id }} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", done ? "bg-white" : "bg-white/50")} />
            <span className={cn("min-w-0 flex-1 truncate text-xs font-medium", done && "line-through opacity-70")}>{task.title}</span>
            <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold">{statusLabel(task.status)}</span>
          </Link>
        );
      })}
    </div>
  );
}

/** Claiming quest XP. Quest XP is never auto-granted: this is the only way it gets paid out
 *  (POST /api/gamification/quests/claim), so the Quest card must keep offering it. */
function useClaimQuest() {
  const { t } = useLang();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => nexusApi.claimQuest(key), onError: (e: unknown) => alert(e instanceof Error ? e.message : t("Couldn't claim the quest.")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gamification", "me"] }),
  });
}

function QuestsDetail({ quests, claim, focusKey }: { quests: NexusQuest[]; claim: ReturnType<typeof useClaimQuest>; focusKey?: string }) {
  const { t, locale } = useLang();
  if (quests.length === 0) return <StatDetailEmpty text={t("No active quests right now.")} />;
  return (
    <div className="space-y-1.5">
      {quests.map((q) => {
        const pct = q.target ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0;
        const left = Math.max(0, q.target - q.progress);
        const claimingThis = claim.isPending && claim.variables === q.key;
        return (
          <div key={q.key} className={cn("rounded-lg px-2 py-1.5", q.key === focusKey && "bg-white/15 ring-2 ring-white/60")}>
            <div className="flex items-center justify-between gap-2 text-xs font-medium">
              <span className="truncate">{q.title}</span>
              <span className="flex shrink-0 items-center gap-1 tabular-nums text-white/80">
                {q.progress}/{q.target}{q.claimed && <Check className="h-3 w-3" />}
              </span>
            </div>
            {q.description && <p className="mt-0.5 text-[11px] leading-snug text-white/75">{q.description}</p>}
            <div className="mt-1"><WhiteBar pct={pct} /></div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] text-white/80">
                <span className="font-bold text-white">+{q.xpReward} XP</span>
                {q.deadline && <> · {t("until {date}", { date: fmtDay(q.deadline, locale) })}</>}
              </span>
              {q.claimed ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white/20 px-2 py-1 text-[11px] font-bold"><Check className="h-3 w-3" /> {t("Claimed")}</span>
              ) : q.claimable ? (
                <button type="button" disabled={claim.isPending} onClick={() => claim.mutate(q.key)} className="shrink-0 cursor-pointer rounded-md bg-white px-2.5 py-1 text-[11px] font-bold text-orange-600 transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-default disabled:opacity-60">{claimingThis ? t("Claiming…") : t("Claim")}</button>
              ) : left === 0 && q.eligible === false ? (
                <span className="shrink-0 text-[11px] text-white/70">{t("Assignees only")}</span>
              ) : (
                <span className="shrink-0 text-[11px] text-white/70">{t("{n} more to go", { n: left })}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- your level ---------- */
/** Gamification (XP/level/quests). Degrades gracefully to zeroes if the backend
 *  endpoint isn't deployed yet (returns undefined data; we fall back to level 1). */
function useGamification() {
  return useQuery({ queryKey: ["gamification", "me"], queryFn: () => nexusApi.gamificationMe(), retry: false, staleTime: 30_000 });
}

/** Compact level indicator beside the greeting. Click → morphs into a detail modal
 *  showing the full tier ladder + current XP (same expand pattern as the stat cards). */
function LevelChip() {
  const { t, locale } = useLang();
  const g = useGamification();
  const totalXp = g.data?.xp?.totalXp ?? 0;
  const info = levelForXp(totalXp);
  const streak = g.data?.streak?.current ?? 0;
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  // A failed XP request is not "Iron Lv.1, 0 XP" (QA 13 Oct 2026): say it didn't load, tap to retry.
  if (g.isError && !g.data) {
    return (
      <button type="button" onClick={() => void g.refetch()} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2 text-left text-sm shadow-soft transition hover:border-primary/30 sm:w-auto">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground"><RotateCw className="h-4 w-4" /></span>
        <span className="min-w-0">
          <span className="block font-semibold">{t("Your level didn't load")}</span>
          <span className="block text-[11px] text-muted-foreground">{t("Tap to try again")}</span>
        </span>
      </button>
    );
  }
  return (
    <>
      <motion.button
        type="button"
        layoutId={reduce ? undefined : "level-chip"}
        onClick={() => setOpen(true)}
        aria-label={t("Your level: {name}, level {level}. Open details", { name: info.name, level: info.level })}
        whileHover={reduce ? undefined : { y: -2 }}
        whileTap={reduce ? undefined : { scale: 0.98 }}
        className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2 text-left shadow-soft transition-shadow hover:border-primary/30 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:w-auto"
      >
        <TierBadge level={info.level} size={40} />
        <div className="min-w-0 flex-1 sm:flex-initial">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-sm font-bold tracking-tight">{info.name}</span>
            <span className="text-[11px] font-semibold text-muted-foreground">Lv.{info.level}</span>
            {streak > 0 && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-warning-foreground dark:text-warning"><Flame className="h-3 w-3" />{streak}</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <AnimatedBar pct={info.pct} className="h-1.5 flex-1 rounded-full bg-muted sm:w-24 sm:flex-none" barClassName="h-full rounded-full bg-primary" />
            <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
              {totalXp.toLocaleString(locale)} XP{info.isMax ? "" : ` / ${(info.nextFloor ?? 0).toLocaleString(locale)}`}
            </span>
          </div>
        </div>
      </motion.button>
      <LevelModal open={open} onClose={() => setOpen(false)} info={info} totalXp={totalXp} streak={streak} />
    </>
  );
}

function LevelModal({ open, onClose, info, totalXp, streak }: { open: boolean; onClose: () => void; info: ReturnType<typeof levelForXp>; totalXp: number; streak: number }) {
  const { t, tn, locale } = useLang();
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-black/50 dark:bg-scrim backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            layoutId={reduce ? undefined : "level-chip"}
            role="dialog"
            aria-modal="true"
            aria-label={t("Your level")}
            initial={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            animate={reduce ? { opacity: 1, scale: 1 } : undefined}
            exit={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-border bg-card text-card-foreground shadow-2xl"
          >
            <button onClick={onClose} aria-label={t("Close")} className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <X className="h-4 w-4" />
            </button>
            {/* header */}
            <div className="flex items-center gap-3 border-b border-border p-5">
              <TierBadge level={info.level} size={52} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-xl font-bold tracking-tight">{info.name}</span>
                  <span className="text-xs font-semibold text-muted-foreground">Lv. {info.level}</span>
                  {streak > 0 && <span className="ml-auto mr-8 inline-flex items-center gap-1 text-xs font-semibold text-warning-foreground dark:text-warning"><Flame className="h-3.5 w-3.5" />{tn(streak, "{n} day", "{n} days")}</span>}
                </div>
                <AnimatedBar pct={info.pct} className="mt-2 h-2 rounded-full bg-muted" barClassName="h-full rounded-full bg-primary" />
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                  <span>{totalXp.toLocaleString(locale)} XP</span>
                  <span>{info.isMax ? t("Top level") : t("{xp} XP to the next level", { xp: (info.nextFloor ?? 0).toLocaleString(locale) })}</span>
                </div>
              </div>
            </div>
            {/* ladder */}
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.15, duration: 0.25 }}
              className="overflow-y-auto p-3"
            >
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("All levels")}</div>
              {LEVELS.map((lv) => {
                const reached = totalXp >= lv.floor;
                const isCurrent = lv.level === info.level;
                return (
                  <div key={lv.level} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors", isCurrent ? "bg-primary/10" : "")}>
                    <TierBadge level={lv.level} size={28} rounded="rounded-lg" active={reached} className={isCurrent ? "ring-2 ring-primary ring-offset-1 ring-offset-card dark:ring-ring" : undefined} />
                    <span className={cn("flex-1 truncate text-sm", isCurrent ? "font-bold" : "font-medium", !reached && "text-muted-foreground")}>{lv.name}</span>
                    {isCurrent && <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">{t("Current")}</span>}
                    {reached && !isCurrent && <Check className="h-4 w-4 shrink-0 text-success" />}
                    <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{lv.floor.toLocaleString(locale)} XP</span>
                  </div>
                );
              })}
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------- right rail: profile ---------- */
function ProfileCard({ userName, avatarUrl }: { userName: string; avatarUrl?: string | null }) {
  const { t, locale } = useLang();
  const g = useGamification();
  const totalXp = g.data?.xp?.totalXp ?? 0;
  const info = levelForXp(totalXp);
  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          <img src={thumbUrl(avatarUrl, 80)} loading="lazy" decoding="async" alt={t("Your avatar")} className="h-20 w-20 shrink-0 rounded-2xl object-cover" />
        ) : (
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-success/10 dark:bg-success/15">
            <img src={learner} alt={t("Your avatar")} className="h-[68px] w-[68px] object-contain" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-baseline justify-between gap-2"><span className="text-xs uppercase tracking-wide text-muted-foreground">{t("Level")}</span><span className="text-sm font-bold">{info.level} · {info.name}</span></div>
          <div className="flex items-baseline justify-between gap-2"><span className="text-xs uppercase tracking-wide text-muted-foreground">{t("Period points")}</span><span className="text-sm font-bold tabular-nums">{totalXp.toLocaleString(locale)}</span></div>
        </div>
      </div>
      <Link to="/settings" className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl border border-primary/40 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <Pencil className="h-4 w-4" /> {t("Edit profile")}
      </Link>
      <p className="mt-2 text-center text-xs text-muted-foreground">{userName}</p>
    </section>
  );
}

function MessagesCard() {
  const { t, tn } = useLang();
  const convos = useQuery({ queryKey: ["conversations"], queryFn: () => nexusApi.conversations(), retry: false, staleTime: 30_000 });
  const rows = convos.data?.conversations ?? [];
  // Same count as the nav badge: the server's total when it sends one, muted rooms left out.
  const unread = chatUnreadTotal(convos.data);
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  return (
    <>
      <motion.button
        type="button"
        layoutId={reduce ? undefined : "messages-card"}
        onClick={() => setOpen(true)}
        aria-label={`${t("Messages")}: ${tn(rows.length, "{n} conversation", "{n} conversations")}${unread ? `, ${t("{n} unread", { n: unread })}` : ""}. ${t("Open details")}`}
        whileHover={reduce ? undefined : { y: -2 }}
        whileTap={reduce ? undefined : { scale: 0.98 }}
        className="flex w-full cursor-pointer items-center gap-3 rounded-3xl border border-border bg-card p-4 text-left shadow-soft transition-shadow hover:border-primary/30 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><MessageCircle className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{t("Messages")}</div>
          <div className="truncate text-xs text-muted-foreground">{rows.length === 0 ? t("No conversations yet") : tn(rows.length, "{n} conversation", "{n} conversations")}</div>
        </div>
        {unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{unread}</span>}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </motion.button>
      <MessagesModal open={open} onClose={() => setOpen(false)} rows={rows} unread={unread} loading={convos.isLoading} />
    </>
  );
}

function convoLabel(c: NexusConversation, t: (s: string) => string, myId?: string) {
  if (c.name) return c.name;
  const others = (c.members ?? []).map((m) => m.user).filter((u): u is NexusUser => !!u).filter((u) => u.id !== myId);
  if (others.length) return others.map((u) => u.name ?? t("Member")).join(", ");
  return c.type === "DM" ? t("Direct message") : t("Conversation");
}

function MessagesModal({ open, onClose, rows, unread, loading }: { open: boolean; onClose: () => void; rows: NexusConversation[]; unread: number; loading: boolean }) {
  const { t, tn } = useLang();
  const reduce = useReducedMotion();
  const me = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const myId = me.data?.user?.id;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-black/50 dark:bg-scrim backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            layoutId={reduce ? undefined : "messages-card"}
            role="dialog"
            aria-modal="true"
            aria-label={t("Messages")}
            initial={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            animate={reduce ? { opacity: 1, scale: 1 } : undefined}
            exit={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-border bg-card text-card-foreground shadow-2xl"
          >
            <button onClick={onClose} aria-label={t("Close")} className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X className="h-4 w-4" /></button>
            {/* header */}
            <div className="flex items-center gap-3 border-b border-border p-5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><MessageCircle className="h-6 w-6" /></span>
              <div>
                <div className="font-display text-xl font-bold tracking-tight">{t("Messages")}</div>
                <div className="text-xs text-muted-foreground">{tn(rows.length, "{n} conversation", "{n} conversations")}{unread > 0 ? ` · ${t("{n} unread", { n: unread })}` : ""}</div>
              </div>
            </div>
            {/* list */}
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.15, duration: 0.25 }}
              className="min-h-0 flex-1 overflow-y-auto p-2"
            >
              {loading && <p className="p-3 text-sm text-muted-foreground">{t("Loading…")}</p>}
              {!loading && rows.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t("No conversations yet.")}</p>}
              {rows.map((c) => {
                const label = convoLabel(c, t, myId);
                const initials = label.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
                return (
                  <Link key={c.id} to="/messages" onClick={onClose} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary ring-1 ring-border">{initials}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{label}</div>
                      <div className="truncate text-xs text-muted-foreground">{c.lastMessage ? (isSystemMessage(c.lastMessage) ? systemSentence(c.lastMessage, myId) : c.lastMessage.content) : t("No messages yet")}</div>
                    </div>
                    {(c.unreadCount ?? 0) > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{c.unreadCount}</span>}
                  </Link>
                );
              })}
            </motion.div>
            {/* footer */}
            <div className="border-t border-border p-3">
              <Link to="/messages" onClick={onClose} className="flex h-10 items-center justify-center gap-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                {t("Open messages")} <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------- right rail: leaderboard ---------- */
function LeaderboardCard() {
  const { t, locale } = useLang();
  const me = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const myId = me.data?.user?.id;
  const lb = useQuery({ queryKey: ["gamification", "leaderboard"], queryFn: () => nexusApi.leaderboard(), retry: false, staleTime: 60_000 });
  // See All → go straight to the full leaderboard page for now. The "card mekar" expand modal
  // (LeaderboardExpandModal, parked below) is on hold until the open animation feels right.
  // Same ranking as the Leaderboard page: ties share a rank (lib/competition-rank.ts).
  const rows = competitionRank(lb.data?.rows ?? [], (r) => r.totalXp, (r) => r.name ?? "").slice(0, 5);
  const [xpUser, setXpUser] = useState<{ id: string; name?: string | null; avatar?: string | null } | null>(null);
  // Keep the source row's content hidden through BOTH the open and close morph (cleared only after
  // the modal's exit animation completes) so it never crossfades into/out of the morph.
  const [morphingId, setMorphingId] = useState<string | null>(null);
  const openXp = (r: { userId: string; name?: string | null; avatar?: string | null }) => { setMorphingId(r.userId); setXpUser({ id: r.userId, name: r.name, avatar: r.avatar }); };
  const rankTone = (i: number) =>
    i === 0 ? "bg-amber-400/20 text-amber-600 dark:text-amber-400"
    : i === 1 ? "bg-slate-300/40 text-slate-600 dark:bg-slate-400/20 dark:text-slate-300"
    : i === 2 ? "bg-orange-400/20 text-orange-700 dark:text-orange-400"
    : "bg-muted text-muted-foreground";
  return (
    <Section title={t("Leaderboard")} action={<SeeAll to="/leaderboard" />}>
      {lb.isLoading && (
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-2.5 py-2">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-7 w-7 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
              <Skeleton className="h-3.5 w-12" />
            </div>
          ))}
        </div>
      )}
      {!lb.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">{t("No ranking yet.")}</p>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <motion.button layoutId={`xp-card-${r.userId}`} type="button" key={r.userId} onClick={() => openXp(r)} className={cn("flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left ring-1 ring-border transition-shadow hover:shadow-soft", r.userId === myId ? "bg-primary/10" : "bg-card")}>
            {/* Hide the row's content while IT is the one expanding so its avatar/name/XP don't
                crossfade ("kebawa") through the morph — only the card box morphs. */}
            <div className={cn("flex w-full items-center gap-3", morphingId === r.userId && "opacity-0")}>
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums", rankTone(r.rank - 1))}>
                {r.rank === 1 ? <Crown className="h-3.5 w-3.5" /> : r.rank}
              </span>
              <div className="shrink-0">
                {r.avatar ? (
                  <img src={thumbUrl(r.avatar, 40)} loading="lazy" decoding="async" alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-border" />
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-1 ring-border">{(r.name ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.name ?? t("Member")}{r.userId === myId ? ` ${t("(you)")}` : ""}</div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><TierBadge level={r.level} size={14} rounded="rounded" /> {r.levelName ?? `Lv. ${r.level}`}</div>
              </div>
              <span className="shrink-0 text-xs font-bold">{r.totalXp.toLocaleString(locale)} XP</span>
            </div>
          </motion.button>
        ))}
      </div>
      <AnimatePresence onExitComplete={() => setMorphingId(null)}>
        {xpUser && <UserXpLogModal key={xpUser.id} user={xpUser} layoutId={`xp-card-${xpUser.id}`} onClose={() => setXpUser(null)} />}
      </AnimatePresence>
    </Section>
  );
}

/** "See All" → the leaderboard card "mekar": the modal genie-zooms open from the card's exact spot/size
 *  (origin + originScale) while the card fades out, then the full list pops in once it lands. */
function LeaderboardExpandModal({ origin, originScale, onClose, onSelect, myId }: { origin?: MorphOrigin; originScale?: number; onClose: () => void; onSelect: (r: NexusLeaderboardRow) => void; myId?: string }) {
  const { t, locale } = useLang();
  const reduce = useReducedMotion();
  const lb = useQuery({ queryKey: ["gamification", "leaderboard"], queryFn: () => nexusApi.leaderboard(), retry: false, staleTime: 60_000 });
  const rows = (lb.data?.rows ?? []).slice().sort((a, b) => b.totalXp - a.totalXp);
  // Light skeleton shown WHILE the box morphs (fixed h-[80vh] so the swap to real rows doesn't resize
  // the panel). Keeps the 13 avatar <img>s from decoding mid-morph — that was the "laggy banget".
  const placeholder = (
    <>
      <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <Skeleton className="h-10 w-10 shrink-0 rounded-2xl" />
        <div className="flex-1 space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-44" /></div>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-hidden p-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5 px-2.5 py-2">
            <Skeleton className="h-6 w-6 rounded" />
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-2.5 w-1/3" /></div>
            <Skeleton className="h-3.5 w-12" />
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3"><Skeleton className="h-10 w-full rounded-xl" /></div>
    </>
  );
  return (
    <MorphPanel origin={origin} originScale={originScale} onClose={onClose} className="max-w-lg h-[80vh]" placeholder={placeholder}>
      {/* Real content lands AFTER the zoom (placeholder bridges the gap). Header drops in, the rows
          cascade (stagger), footer fades — a clear "muncul", not a dull snap. */}
      <motion.div
        className="flex min-h-0 w-full flex-1 flex-col"
        initial={reduce ? false : "hide"}
        animate="show"
        variants={{ hide: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.05 } } }}
      >
        <motion.div variants={{ hide: { opacity: 0, y: -6 }, show: { opacity: 1, y: 0 } }} className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Crown className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><div className="font-display text-lg font-bold tracking-tight">{t("Leaderboard")}</div><div className="text-xs text-muted-foreground">{t("Select someone to see their XP history")}</div></div>
          <button onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </motion.div>
        <motion.div className="min-h-0 flex-1 overflow-y-auto p-2" variants={{ hide: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.022 } } }}>
          {rows.map((r, i) => (
            <motion.button variants={{ hide: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.24, ease: "easeOut" }} key={r.userId} onClick={() => onSelect(r)} className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent active:scale-[0.99]", r.userId === myId && "bg-primary/10")}>
              <span className="w-6 shrink-0 text-center text-xs font-bold tabular-nums text-muted-foreground">{i === 0 ? <Crown className="mx-auto h-4 w-4 text-amber-500" /> : i + 1}</span>
              {r.avatar ? <img src={thumbUrl(r.avatar, 40)} loading="lazy" decoding="async" alt="" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border" /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary ring-1 ring-border">{(r.name ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}</span>}
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{r.name ?? t("Member")}{r.userId === myId ? ` ${t("(you)")}` : ""}</div><div className="flex items-center gap-1 text-[11px] text-muted-foreground"><TierBadge level={r.level} size={14} rounded="rounded" /> {r.levelName ?? `Lv. ${r.level}`}</div></div>
              <span className="shrink-0 text-xs font-bold tabular-nums">{r.totalXp.toLocaleString(locale)} XP</span>
            </motion.button>
          ))}
        </motion.div>
        <motion.div variants={{ hide: { opacity: 0 }, show: { opacity: 1 } }} className="border-t border-border p-3"><Link to="/leaderboard" onClick={onClose} className="block w-full rounded-xl bg-primary py-2.5 text-center text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90">{t("Full page")} →</Link></motion.div>
      </motion.div>
    </MorphPanel>
  );
}

/* ---------- right rail: calendar ---------- */
// Days are WIB days ("YYYY-MM-DD" at UTC+7), the same day the server and /calendar put a due date on —
// toISOString() alone is the UTC day, which moved anything due before 07:00 WIB to the day before.
const WIB_MS = 7 * 3600_000;
const wibDay = (ms: number) => new Date(ms + WIB_MS).toISOString().slice(0, 10);

function CalendarCard() {
  const { t, locale } = useLang();
  const [anchor, setAnchor] = useState(() => wibDay(Date.now()));
  const tasks = useMyTasks();
  // Days that have at least one task due.
  const dueDays = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks.data ?? []) {
      if (!t.dueDate) continue;
      const ms = Date.parse(t.dueDate);
      if (!Number.isNaN(ms)) set.add(wibDay(ms));
    }
    return set;
  }, [tasks.data]);

  const days = monthGrid(anchor);
  const todayKey = wibDay(Date.now());
  // The day strings are calendar dates, so format them in UTC to keep the month from shifting.
  const monthLabel = new Date(`${anchor.slice(0, 8)}01T00:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <Section title={t("Calendar")} action={<SeeAll to="/calendar" />}>
      <div className="mb-3 flex items-center justify-center gap-3 text-sm font-medium">
        <button onClick={() => setAnchor((a) => shiftMonth(a, -1))} aria-label={t("Previous month")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><ChevronLeft className="h-4 w-4" /></button>
        {monthLabel}
        <button onClick={() => setAnchor((a) => shiftMonth(a, 1))} aria-label={t("Next month")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-y-1.5 text-center text-xs">
        {/* 5 Jan 2026 is a Monday: the weekday initials in the interface language. */}
        {Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 0, 5 + i)).toLocaleDateString(locale, { weekday: locale.startsWith("id") ? "short" : "narrow", timeZone: "UTC" })).map((d, i) => <span key={i} className="text-muted-foreground">{d}</span>)}
        {days.map((key) => {
          const inMonth = sameMonth(key, anchor);
          const isToday = key === todayKey;
          const hasDue = dueDays.has(key);
          return (
            <Link key={key} to="/calendar" search={{ date: key }} aria-label={key} className="relative mx-auto grid h-7 w-7 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <span className={cn("grid h-7 w-7 place-items-center rounded-full", isToday ? "bg-primary font-semibold text-primary-foreground" : !inMonth ? "text-muted-foreground/40" : "text-foreground/80 hover:bg-accent")}>{Number(key.slice(8, 10))}</span>
              {hasDue && !isToday && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary" />}
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

/* ---------- right rail: schedule ---------- */
function ScheduleCard() {
  const { t, locale } = useLang();
  const tasks = useMyTasks();
  const items = useMemo(() => {
    return (tasks.data ?? [])
      .filter((t) => t.dueDate && (t.status ?? "").toUpperCase() !== "DONE" && (t.status ?? "").toUpperCase() !== "CANCELLED")
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
      .slice(0, 6);
  }, [tasks.data]);
  return (
    <Section title={t("Your schedule")} action={<SeeAll to="/my-tasks" />}>
      {tasks.isLoading && (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <Skeleton className="h-8 w-1 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      )}
      {!tasks.isLoading && items.length === 0 && <p className="text-sm text-muted-foreground">{t("No upcoming tasks with a due date.")}</p>}
      <div className="space-y-2.5">
        {items.map((task) => (
          <Link key={task.id} to="/tasks/$taskId" params={{ taskId: task.id }} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span className="h-8 w-1 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{task.title}</div>
              <div className="truncate text-xs text-muted-foreground">{task.taskList?.name ?? "NEXUS"}</div>
            </div>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">{fmtDueDay(task.dueDate, locale)}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}
