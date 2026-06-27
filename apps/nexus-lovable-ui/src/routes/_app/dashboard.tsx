import { createFileRoute, Link } from "@tanstack/react-router";
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
  } from "lucide-react";

import learner from "@/assets/philearn/learner.png";
import sophia from "@/assets/philearn/sophia.png";
import { cn } from "@/lib/utils";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { XpRulesCard } from "@/components/XpRulesCard";
import { UserXpLogModal } from "@/components/UserXpLogModal";
import { MorphPanel, type MorphOrigin } from "@/components/motion/MorphPanel";
import { activeNotifications, fmtDate, fmtDue, nexusApi, statusLabel, type NexusDashboardResponse, type NexusProject, type NexusTask, type NexusQuest, type NexusConversation, type NexusUser, type NexusNotification, type NexusLeaderboardRow } from "@/lib/nexus-api";
import { LEVELS, levelForXp } from "@/lib/levels";
import { TierBadge } from "@/components/gamification/TierBadge";
import { QuestIcon } from "@/components/gamification/QuestIcon";
import { Reveal, AnimatedBar, CountUp } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "NEXUS Phaëthon — Dashboard" }] }),
});

const fallbackDashboard: NexusDashboardResponse = {
  stats: { totalTasks: 10, inProgressTasks: 3, overdueTasks: 2, completedThisWeek: 5 },
  projects: [
    { id: "fallback-1", name: "NEXUS Revamp", color: "#a168be", totalTasks: 8, completedTasks: 3, progress: 95 },
    { id: "fallback-2", name: "PATS Attendance", color: "#40c4aa", totalTasks: 10, completedTasks: 3, progress: 25 },
    { id: "fallback-3", name: "Ops Rituals", color: "#ffbe4c", totalTasks: 20, completedTasks: 5, progress: 60 },
  ],
  tasks: [
    { id: "t1", title: "Creating Logo", status: "TODO", priority: "HIGH", dueDate: "2026-05-15", project: { id: "fallback-3", name: "Design Graphic", color: "#ffbe4c" } },
    { id: "t2", title: "Tone of Voice", status: "DONE", priority: "MEDIUM", dueDate: "2026-05-07", project: { id: "fallback-2", name: "Digital Marketing", color: "#40c4aa" } },
    { id: "t3", title: "Wireframing Web", status: "DONE", priority: "LOW", dueDate: "2026-05-06", project: { id: "fallback-1", name: "UI/UX Design", color: "#a168be" } },
  ],
  sprints: [
    { id: "s1", name: "UI/UX Design", project: "23/40 tasks", projectColor: "#a168be", totalTasks: 40, completedTasks: 38, progress: 95 },
    { id: "s2", name: "Digital Marketing", project: "23/40 tasks", projectColor: "#40c4aa", totalTasks: 40, completedTasks: 10, progress: 25 },
  ],
  goals: [
    { id: "g1", title: "Join 2 Workshops", status: "active", progress: 50 },
    { id: "g2", title: "Finish 2 Assignments", status: "active", progress: 90 },
  ],
};

function Dashboard() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: nexusApi.dashboard, retry: 1 });
  const notifications = useQuery({ queryKey: ["notifications-unread"], queryFn: () => nexusApi.notifications(), retry: 1 });

  const live = dashboard.data;
  const data: NexusDashboardResponse =
    live && ((live.projects?.length ?? 0) > 0 || (live.tasks?.length ?? 0) > 0) ? live : fallbackDashboard;
  const userName = profile.data?.user?.name || "Sophia Carie";

  return (
    <div className="w-full px-5 py-6 md:px-8 md:py-8 2xl:px-10">
      <OnboardingWizard />
      <TopBar userName={userName} unread={notifications.data?.unreadCount ?? 5} />

      <div className="mt-7 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-8">
        {/* main: stats, quests */}
        <div className="space-y-6">
          <StatRow data={data} />
          <Reveal delay={0.1}><YourQuests /></Reveal>
          <Reveal delay={0.15}><XpRulesCard /></Reveal>
        </div>

        {/* right rail */}
        <aside className="space-y-6">
          <Reveal delay={0.05}><ProfileCard userName={userName} avatarUrl={profile.data?.user?.avatar} /></Reveal>
          <Reveal delay={0.1}><MessagesCard /></Reveal>
          <Reveal delay={0.15}><LeaderboardCard /></Reveal>
          <Reveal delay={0.2}><CalendarCard /></Reveal>
          <Reveal delay={0.25}><ScheduleCard /></Reveal>
        </aside>
      </div>
    </div>
  );
}

/* ---------- top bar ---------- */
/* Uses the SAME grid template as the content grid below, so the level chip's
   right edge (in the main zone) lines up with the stat cards / Monthly Quest,
   while search + notifications sit in the right-rail zone. */
function TopBar({ userName, unread }: { userName: string; unread: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-6 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-8">
      {/* main zone: greeting (left) + level chip (right, aligns with stat cards).
          On phones the chip drops below so the greeting gets full width (2 lines,
          not 4); sm+ keeps the original side-by-side row — desktop unchanged. */}
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <p className="text-xl font-medium text-foreground/80">Good Morning,</p>
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{userName}!</h1>
        </div>
        <LevelChip />
      </div>
      {/* rail zone: search + notifications */}
      <div className="flex items-center gap-3">
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-card px-5 text-muted-foreground transition-shadow focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Search className="h-4 w-4 shrink-0" />
          <input placeholder="Search.." className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
        </label>
        <NotificationsBell unread={unread} />
      </div>
    </div>
  );
}

/* Notification bell → morphs into a detail modal (same expand pattern as the
   stat cards / level chip / messages card), instead of navigating to /inbox. */
function NotificationsBell({ unread }: { unread: number }) {
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
        aria-label={`Notifications${count > 0 ? `, ${count} unread` : ""}. Open`}
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

function notifTitle(n: NexusNotification) {
  const t = (n.type || "signal").toLowerCase().replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function NotificationsModal({ open, onClose, list, unread, loading, error }: { open: boolean; onClose: () => void; list: NexusNotification[]; unread: number; loading: boolean; error: boolean }) {
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications-unread"] });
  const markRead = useMutation({ mutationFn: (id: string) => nexusApi.markNotificationRead(id), onSuccess: refresh });
  const markAll = useMutation({ mutationFn: nexusApi.markAllNotificationsRead, onSuccess: refresh });
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
          <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            layoutId={reduce ? undefined : "notif-bell"}
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            initial={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            animate={reduce ? { opacity: 1, scale: 1 } : undefined}
            exit={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-border bg-card text-card-foreground shadow-2xl"
          >
            <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X className="h-4 w-4" /></button>
            {/* header */}
            <div className="flex items-center gap-3 border-b border-border p-5 pr-12">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Bell className="h-6 w-6" /></span>
              <div className="min-w-0">
                <div className="font-display text-xl font-bold tracking-tight">Notifications</div>
                <div className="text-xs text-muted-foreground">{unread > 0 ? `${unread} unread` : "All caught up"}</div>
              </div>
              {unread > 0 && (
                <button onClick={() => markAll.mutate()} disabled={markAll.isPending} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
                  {markAll.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Mark all
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
              {loading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
              {error && <p className="p-3 text-sm text-muted-foreground">You need to be logged in to open your inbox.</p>}
              {!loading && !error && list.length === 0 && <p className="p-3 text-sm text-muted-foreground">No notifications. Enjoy the silence.</p>}
              {list.map((n) => (
                <button
                  key={n.id}
                  onClick={() => { if (!n.read) markRead.mutate(n.id); }}
                  className={cn("flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", !n.read && "bg-primary/[0.04]")}
                >
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Bell className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{n.title || notifTitle(n)}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{n.message || "New NEXUS signal."}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtDate(n.createdAt)}</div>
                  </div>
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                </button>
              ))}
            </motion.div>
            {/* footer */}
            <div className="border-t border-border p-3">
              <Link to="/inbox" onClick={onClose} className="flex h-10 items-center justify-center gap-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                Open Inbox <ChevronRight className="h-4 w-4" />
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

function SeeAll({ to, label = "See All" }: { to: string; label?: string }) {
  return <Link to={to} className="rounded text-xs font-medium text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{label}</Link>;
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
};

function StatRow(_: { data: NexusDashboardResponse }) {
  // Accurate per-user sources: full project list + tasks assigned to me + my quests.
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: nexusApi.projects, retry: 1, staleTime: 60_000 });
  const myTasks = useMyTasks();
  const g = useGamification();
  const [active, setActive] = useState<number | null>(null);

  const projectList = projectsQ.data ?? [];
  const quests = g.data?.quests ?? [];

  // Hide tasks done more than 3 days ago (uses updatedAt as the completion proxy);
  // open tasks always stay. Keeps "My Tasks" focused on what's still relevant.
  const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const taskList = (myTasks.data ?? []).filter((t) => {
    const done = (t.status ?? "").toUpperCase() === "DONE";
    if (!done) return true;
    const ts = t.updatedAt ? new Date(t.updatedAt).getTime() : 0;
    return ts > 0 && now - ts <= THREE_DAYS;
  });
  const tasksDone = taskList.filter((t) => (t.status ?? "").toUpperCase() === "DONE").length;
  const questsDone = quests.filter((q) => q.claimed).length;

  const cards: StatCard[] = [
    {
      value: projectList.length, label: "Projects", Icon: FolderKanban,
      from: "#c4b5fd", to: "#7c3aed", glow: "#a78bfa",
      detail: <ProjectsDetail projects={projectList} />,
    },
    {
      value: tasksDone, total: taskList.length, label: "Your Mission", Icon: ListChecks,
      from: "#6ee7b7", to: "#059669", glow: "#34d399",
      detail: <TasksDetail tasks={taskList} />,
    },
    {
      value: questsDone, total: quests.length, label: "Monthly Quests", Icon: Sparkles,
      from: "#fcd34d", to: "#ea580c", glow: "#fbbf24",
      detail: <QuestsDetail quests={quests} />,
    },
  ];

  return (
    <>
      <div className="grid grid-cols-3 items-stretch gap-3 sm:gap-5">
        {cards.map((c, i) => (
          <StatCardButton key={c.label} card={c} index={i} onOpen={() => setActive(i)} />
        ))}
      </div>
      <StatCardModal cards={cards} active={active} onClose={() => setActive(null)} />
    </>
  );
}

/** Collapsed card in the grid. Shares a `layoutId` with the modal so it morphs open. */
function StatCardButton({ card, index, onOpen }: { card: StatCard; index: number; onOpen: () => void }) {
  const reduce = useReducedMotion();
  const { Icon } = card;
  return (
    <motion.button
      type="button"
      layoutId={reduce ? undefined : `stat-card-${index}`}
      onClick={onOpen}
      aria-label={`${card.label}: ${card.value}${card.total != null ? ` of ${card.total}` : ""}. Open details`}
      initial={reduce ? false : { opacity: 0, y: 18, scale: 0.97 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ type: "spring", stiffness: 260, damping: 24, delay: index * 0.07 }}
      whileHover={reduce ? undefined : { y: -4 }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      className="group relative flex h-full w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl px-3 py-5 text-center text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:px-4"
      style={{ backgroundImage: `linear-gradient(150deg, ${card.from} 0%, ${card.to} 100%)`, boxShadow: `0 12px 28px -12px ${card.glow}` }}
    >
      <span className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/20 blur-2xl" />
      <Maximize2 className="absolute right-3 top-3 h-3.5 w-3.5 text-white/50 transition-colors group-hover:text-white/90" />
      <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-2xl bg-white/25 backdrop-blur-sm">
        <Icon className="h-5 w-5" strokeWidth={2.5} />
      </span>
      <div className="font-display text-3xl font-bold tracking-tight drop-shadow-sm md:text-4xl">
        <CountUp value={card.value} />
        {card.total != null && <span className="text-white/70">/{card.total}</span>}
      </div>
      <div className="mt-1.5 text-sm font-medium text-white/85">{card.label}</div>
    </motion.button>
  );
}

/** Expanded view — card morphs into a larger centered modal (shared layoutId). */
function StatCardModal({ cards, active, onClose }: { cards: StatCard[]; active: number | null; onClose: () => void }) {
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
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            layoutId={reduce ? undefined : `stat-card-${active}`}
            role="dialog"
            aria-modal="true"
            aria-label={card.label}
            initial={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            animate={reduce ? { opacity: 1, scale: 1 } : undefined}
            exit={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl text-white shadow-2xl"
            style={{ backgroundImage: `linear-gradient(150deg, ${card.from} 0%, ${card.to} 100%)` }}
          >
            <span className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/20 blur-2xl" />
            <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
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
                <div className="mt-1.5 text-sm font-medium text-white/85">{card.label}</div>
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
  if (projects.length === 0) return <StatDetailEmpty text="No projects yet." />;
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
  if (tasks.length === 0) return <StatDetailEmpty text="No tasks assigned to you." />;
  return (
    <div className="space-y-1">
      {tasks.map((t) => {
        const done = (t.status ?? "").toUpperCase() === "DONE";
        return (
          <Link key={t.id} to="/tasks/$taskId" params={{ taskId: t.id }} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", done ? "bg-white" : "bg-white/50")} />
            <span className={cn("min-w-0 flex-1 truncate text-xs font-medium", done && "line-through opacity-70")}>{t.title}</span>
            <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold">{statusLabel(t.status)}</span>
          </Link>
        );
      })}
    </div>
  );
}

function QuestsDetail({ quests }: { quests: NexusQuest[] }) {
  if (quests.length === 0) return <StatDetailEmpty text="No active quests right now." />;
  return (
    <div className="space-y-1.5">
      {quests.map((q) => {
        const pct = q.target ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0;
        return (
          <div key={q.key} className="rounded-lg px-2 py-1.5">
            <div className="flex items-center justify-between gap-2 text-xs font-medium">
              <span className="truncate">{q.title}</span>
              <span className="flex shrink-0 items-center gap-1 tabular-nums text-white/80">
                {q.progress}/{q.target}{q.claimed && <Check className="h-3 w-3" />}
              </span>
            </div>
            <div className="mt-1"><WhiteBar pct={pct} /></div>
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
  const g = useGamification();
  const totalXp = g.data?.xp?.totalXp ?? 0;
  const info = levelForXp(totalXp);
  const streak = g.data?.streak?.current ?? 0;
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  return (
    <>
      <motion.button
        type="button"
        layoutId={reduce ? undefined : "level-chip"}
        onClick={() => setOpen(true)}
        aria-label={`Your level: ${info.name}, level ${info.level}. Open details`}
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
              <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-warning-foreground"><Flame className="h-3 w-3" />{streak}</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <AnimatedBar pct={info.pct} className="h-1.5 flex-1 rounded-full bg-muted sm:w-24 sm:flex-none" barClassName="h-full rounded-full bg-primary" />
            <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
              {totalXp.toLocaleString()} XP{info.isMax ? "" : ` / ${(info.nextFloor ?? 0).toLocaleString()}`}
            </span>
          </div>
        </div>
      </motion.button>
      <LevelModal open={open} onClose={() => setOpen(false)} info={info} totalXp={totalXp} streak={streak} />
    </>
  );
}

function LevelModal({ open, onClose, info, totalXp, streak }: { open: boolean; onClose: () => void; info: ReturnType<typeof levelForXp>; totalXp: number; streak: number }) {
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
          <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            layoutId={reduce ? undefined : "level-chip"}
            role="dialog"
            aria-modal="true"
            aria-label="Your level"
            initial={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            animate={reduce ? { opacity: 1, scale: 1 } : undefined}
            exit={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-border bg-card text-card-foreground shadow-2xl"
          >
            <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <X className="h-4 w-4" />
            </button>
            {/* header */}
            <div className="flex items-center gap-3 border-b border-border p-5">
              <TierBadge level={info.level} size={52} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-xl font-bold tracking-tight">{info.name}</span>
                  <span className="text-xs font-semibold text-muted-foreground">Lv. {info.level}</span>
                  {streak > 0 && <span className="ml-auto mr-8 inline-flex items-center gap-1 text-xs font-semibold text-warning-foreground"><Flame className="h-3.5 w-3.5" />{streak} day{streak === 1 ? "" : "s"}</span>}
                </div>
                <AnimatedBar pct={info.pct} className="mt-2 h-2 rounded-full bg-muted" barClassName="h-full rounded-full bg-primary" />
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                  <span>{totalXp.toLocaleString()} XP</span>
                  <span>{info.isMax ? "Max tier" : `${(info.nextFloor ?? 0).toLocaleString()} XP → next`}</span>
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
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">All levels</div>
              {LEVELS.map((t) => {
                const reached = totalXp >= t.floor;
                const isCurrent = t.level === info.level;
                return (
                  <div key={t.level} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors", isCurrent ? "bg-primary/10" : "")}>
                    <TierBadge level={t.level} size={28} rounded="rounded-lg" active={reached} className={isCurrent ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : undefined} />
                    <span className={cn("flex-1 truncate text-sm", isCurrent ? "font-bold" : "font-medium", !reached && "text-muted-foreground")}>{t.name}</span>
                    {isCurrent && <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">Current</span>}
                    {reached && !isCurrent && <Check className="h-4 w-4 shrink-0 text-success" />}
                    <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{t.floor.toLocaleString()} XP</span>
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

/* ---------- your quests ---------- */
const QUEST_REQ_DESC: Record<string, (n: number) => string> = {
  task_count: (n) => `Finish ${n} task${n === 1 ? "" : "s"} you're working on.`,
  overdue_cleared: (n) => `Clear ${n} overdue task${n === 1 ? "" : "s"}.`,
  priority_done: (n) => `Close ${n} Urgent-priority task${n === 1 ? "" : "s"}.`,
};
function questReqDesc(q: NexusQuest) {
  const t = (q as { requirementType?: string }).requirementType ?? "task_count";
  return (QUEST_REQ_DESC[t] ?? QUEST_REQ_DESC.task_count)(q.target);
}

function QuestTile({ q, onClaim, claiming, onOpenDetail }: { q: NexusQuest; onClaim: (key: string) => void; claiming: boolean; onOpenDetail?: () => void }) {
  return (
    <motion.div onClick={onOpenDetail} className="flex cursor-pointer flex-col rounded-2xl bg-muted/50 p-3 text-center" whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}>
      <QuestIcon questKey={q.key} title={q.title} size={64} className="mx-auto" />
      <div className="mt-2 truncate text-sm font-semibold" title={q.title}>{q.title}</div>
      <div className="text-xs text-muted-foreground">{q.progress}/{q.target} · +{q.xpReward} XP</div>
      {q.deadline && <div className="text-[10px] font-semibold text-amber-600">⏰ until {fmtDate(q.deadline)}</div>}
      {q.claimed ? (
        <div className="mt-2.5 inline-flex w-full items-center justify-center gap-1 rounded-lg bg-success/15 py-1.5 text-xs font-bold text-success"><Check className="h-3.5 w-3.5" /> Claimed</div>
      ) : q.claimable ? (
        <button disabled={claiming} onClick={(e) => { e.stopPropagation(); onClaim(q.key); }} className="mt-2.5 w-full cursor-pointer rounded-lg bg-warning py-1.5 text-xs font-bold text-warning-foreground transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default disabled:opacity-50">{claiming ? "Claiming…" : "Claim"}</button>
      ) : null}
    </motion.div>
  );
}

function QuestDetailModal({ q, onClose, onClaim, claiming }: { q: NexusQuest; onClose: () => void; onClaim: (key: string) => void; claiming: boolean }) {
  const pct = q.target ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0;
  return (
    <div className="fixed inset-0 z-[95] grid place-items-center p-4">
      <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        role="dialog" aria-modal="true"
        initial={{ opacity: 0, scale: 0.92, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-pop"
      >
        <div className="flex items-start gap-3 border-b border-border p-5">
          <QuestIcon questKey={q.key} title={q.title} size={56} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black leading-tight tracking-tight">{q.title}</h2>
              {q.source === "admin" && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">From BoD</span>}
            </div>
            {q.description && <p className="mt-0.5 text-sm text-muted-foreground">{q.description}</p>}
          </div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="rounded-2xl border border-dashed border-border p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">What to do</div>
            <p className="mt-1 text-sm font-semibold">{questReqDesc(q)}</p>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-sm font-semibold"><span>Progress</span><span>{q.progress}/{q.target} · {pct}%</span></div>
            <AnimatedBar pct={pct} className="h-2.5 rounded-full bg-muted" barClassName="h-full rounded-full bg-primary" />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-black text-success">+{q.xpReward} XP</span>
            {q.deadline && <span className="font-semibold text-amber-600">⏰ Deadline {fmtDate(q.deadline)}</span>}
          </div>
          {q.claimed ? (
            <div className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-success/15 py-2.5 text-sm font-bold text-success"><Check className="h-4 w-4" /> Claimed</div>
          ) : q.claimable ? (
            <button disabled={claiming} onClick={() => onClaim(q.key)} className="w-full rounded-xl bg-warning py-2.5 text-sm font-bold text-warning-foreground transition active:scale-[0.98] disabled:opacity-50">{claiming ? "Claiming…" : `Claim +${q.xpReward} XP`}</button>
          ) : (
            <div className="rounded-xl bg-muted py-2.5 text-center text-sm font-medium text-muted-foreground">Finish {q.target - q.progress} more task{q.target - q.progress === 1 ? "" : "s"} to claim</div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function YourQuests() {
  const qc = useQueryClient();
  const g = useGamification();
  const quests = g.data?.quests ?? [];
  const [showAll, setShowAll] = useState(false);
  const [detail, setDetail] = useState<NexusQuest | null>(null);
  const claim = useMutation({
    mutationFn: (key: string) => nexusApi.claimQuest(key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gamification", "me"] }),
  });
  return (
    <>
      <Section title="Your Quests" action={<button onClick={() => setShowAll(true)} className="rounded text-xs font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">See All</button>}>
        {g.isLoading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center rounded-2xl bg-muted/50 p-3">
                <Skeleton className="h-16 w-16 rounded-2xl" /><Skeleton className="mt-2 h-3.5 w-3/4" /><Skeleton className="mt-1.5 h-2.5 w-1/2" /><Skeleton className="mt-2 h-1.5 w-full rounded-full" /><Skeleton className="mt-2 h-6 w-full rounded-lg" />
              </div>
            ))}
          </div>
        )}
        {!g.isLoading && quests.length === 0 && <p className="text-sm text-muted-foreground">No active quests yet. Your XP still rolls in from tasks, streaks & attendance — check "XP Rules" below.</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {quests.slice(0, 4).map((q) => <QuestTile key={q.key} q={q} onClaim={claim.mutate} claiming={claim.isPending} onOpenDetail={() => setDetail(q)} />)}
        </div>
      </Section>
      {createPortal(
        <AnimatePresence>
          {showAll && (
            <div className="fixed inset-0 z-[90] grid place-items-center p-4">
              <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAll(false)} />
              <motion.div
                role="dialog"
                aria-modal="true"
                initial={{ opacity: 0, scale: 0.94, y: 14 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 10 }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-pop"
              >
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-black tracking-tight">All Quests</h2>
                  <button onClick={() => setShowAll(false)} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
                </div>
                {quests.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No active quests yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {quests.map((q) => <QuestTile key={q.key} q={q} onClaim={claim.mutate} claiming={claim.isPending} onOpenDetail={() => setDetail(q)} />)}
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
      {createPortal(
        <AnimatePresence>
          {detail && <QuestDetailModal q={detail} onClose={() => setDetail(null)} onClaim={claim.mutate} claiming={claim.isPending} />}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/* ---------- right rail: profile ---------- */
function ProfileCard({ userName, avatarUrl }: { userName: string; avatarUrl?: string | null }) {
  const g = useGamification();
  const totalXp = g.data?.xp?.totalXp ?? 0;
  const info = levelForXp(totalXp);
  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          <img src={avatarUrl} alt="Your avatar" className="h-20 w-20 shrink-0 rounded-2xl object-cover" />
        ) : (
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-success/10 dark:bg-success/15">
            <img src={learner} alt="Your avatar" className="h-[68px] w-[68px] object-contain" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-baseline justify-between gap-2"><span className="text-xs uppercase tracking-wide text-muted-foreground">Level</span><span className="text-sm font-bold">{info.level} · {info.name}</span></div>
          <div className="flex items-baseline justify-between gap-2"><span className="text-xs uppercase tracking-wide text-muted-foreground">Period points</span><span className="text-sm font-bold tabular-nums">{totalXp.toLocaleString()}</span></div>
        </div>
      </div>
      <Link to="/settings" className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl border border-primary/40 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <Pencil className="h-4 w-4" /> Edit Profile
      </Link>
      <p className="mt-2 text-center text-xs text-muted-foreground">{userName}</p>
    </section>
  );
}

function MessagesCard() {
  const convos = useQuery({ queryKey: ["conversations"], queryFn: () => nexusApi.conversations(), retry: false, staleTime: 30_000 });
  const rows = convos.data?.conversations ?? [];
  const unread = rows.reduce((n, c) => n + (c.unreadCount ?? 0), 0);
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  return (
    <>
      <motion.button
        type="button"
        layoutId={reduce ? undefined : "messages-card"}
        onClick={() => setOpen(true)}
        aria-label={`Messages: ${rows.length} conversations${unread ? `, ${unread} unread` : ""}. Open details`}
        whileHover={reduce ? undefined : { y: -2 }}
        whileTap={reduce ? undefined : { scale: 0.98 }}
        className="flex w-full cursor-pointer items-center gap-3 rounded-3xl border border-border bg-card p-4 text-left shadow-soft transition-shadow hover:border-primary/30 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><MessageCircle className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Messages</div>
          <div className="truncate text-xs text-muted-foreground">{rows.length === 0 ? "No conversations yet" : `${rows.length} conversation${rows.length === 1 ? "" : "s"}`}</div>
        </div>
        {unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{unread}</span>}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </motion.button>
      <MessagesModal open={open} onClose={() => setOpen(false)} rows={rows} unread={unread} loading={convos.isLoading} />
    </>
  );
}

function convoLabel(c: NexusConversation, myId?: string) {
  if (c.name) return c.name;
  const others = (c.members ?? []).map((m) => m.user).filter((u): u is NexusUser => !!u).filter((u) => u.id !== myId);
  if (others.length) return others.map((u) => u.name ?? "Member").join(", ");
  return c.type === "DM" ? "Direct message" : "Conversation";
}

function MessagesModal({ open, onClose, rows, unread, loading }: { open: boolean; onClose: () => void; rows: NexusConversation[]; unread: number; loading: boolean }) {
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
          <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            layoutId={reduce ? undefined : "messages-card"}
            role="dialog"
            aria-modal="true"
            aria-label="Messages"
            initial={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            animate={reduce ? { opacity: 1, scale: 1 } : undefined}
            exit={reduce ? { opacity: 0, scale: 0.95 } : undefined}
            className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-border bg-card text-card-foreground shadow-2xl"
          >
            <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X className="h-4 w-4" /></button>
            {/* header */}
            <div className="flex items-center gap-3 border-b border-border p-5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><MessageCircle className="h-6 w-6" /></span>
              <div>
                <div className="font-display text-xl font-bold tracking-tight">Messages</div>
                <div className="text-xs text-muted-foreground">{rows.length} conversation{rows.length === 1 ? "" : "s"}{unread > 0 ? ` · ${unread} unread` : ""}</div>
              </div>
            </div>
            {/* list */}
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.15, duration: 0.25 }}
              className="min-h-0 flex-1 overflow-y-auto p-2"
            >
              {loading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
              {!loading && rows.length === 0 && <p className="p-3 text-sm text-muted-foreground">No conversations yet.</p>}
              {rows.map((c) => {
                const label = convoLabel(c, myId);
                const initials = label.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
                return (
                  <Link key={c.id} to="/messages" onClick={onClose} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary ring-1 ring-border">{initials}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{label}</div>
                      <div className="truncate text-xs text-muted-foreground">{c.lastMessage?.content ?? "No messages yet"}</div>
                    </div>
                    {(c.unreadCount ?? 0) > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{c.unreadCount}</span>}
                  </Link>
                );
              })}
            </motion.div>
            {/* footer */}
            <div className="border-t border-border p-3">
              <Link to="/messages" onClick={onClose} className="flex h-10 items-center justify-center gap-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                Open Messages <ChevronRight className="h-4 w-4" />
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
  const me = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const myId = me.data?.user?.id;
  const lb = useQuery({ queryKey: ["gamification", "leaderboard"], queryFn: () => nexusApi.leaderboard(), retry: false, staleTime: 60_000 });
  // See All → go straight to the full leaderboard page for now. The "card mekar" expand modal
  // (LeaderboardExpandModal, parked below) is on hold until the open animation feels right.
  const rows = (lb.data?.rows ?? []).slice(0, 5);
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
    <Section title="Leaderboard" action={<SeeAll to="/leaderboard" />}>
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
      {!lb.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">No ranking yet.</p>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <motion.button layoutId={`xp-card-${r.userId}`} type="button" key={r.userId} onClick={() => openXp(r)} className={cn("flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left ring-1 ring-border transition-shadow hover:shadow-soft", r.userId === myId ? "bg-primary/10" : "bg-card")}>
            {/* Hide the row's content while IT is the one expanding so its avatar/name/XP don't
                crossfade ("kebawa") through the morph — only the card box morphs. */}
            <div className={cn("flex w-full items-center gap-3", morphingId === r.userId && "opacity-0")}>
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums", rankTone(i))}>
                {i === 0 ? <Crown className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <div className="shrink-0">
                {r.avatar ? (
                  <img src={r.avatar} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-border" />
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-1 ring-border">{(r.name ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.name ?? "Member"}{r.userId === myId ? " (you)" : ""}</div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><TierBadge level={r.level} size={14} rounded="rounded" /> {r.levelName ?? `Lv. ${r.level}`}</div>
              </div>
              <span className="shrink-0 text-xs font-bold">{r.totalXp.toLocaleString()} XP</span>
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
          <div className="min-w-0 flex-1"><div className="font-display text-lg font-bold tracking-tight">Leaderboard</div><div className="text-xs text-muted-foreground">Tap someone to see their XP log</div></div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </motion.div>
        <motion.div className="min-h-0 flex-1 overflow-y-auto p-2" variants={{ hide: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.022 } } }}>
          {rows.map((r, i) => (
            <motion.button variants={{ hide: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.24, ease: "easeOut" }} key={r.userId} onClick={() => onSelect(r)} className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent active:scale-[0.99]", r.userId === myId && "bg-primary/10")}>
              <span className="w-6 shrink-0 text-center text-xs font-bold tabular-nums text-muted-foreground">{i === 0 ? <Crown className="mx-auto h-4 w-4 text-amber-500" /> : i + 1}</span>
              {r.avatar ? <img src={r.avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border" /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary ring-1 ring-border">{(r.name ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}</span>}
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{r.name ?? "Member"}{r.userId === myId ? " (you)" : ""}</div><div className="flex items-center gap-1 text-[11px] text-muted-foreground"><TierBadge level={r.level} size={14} rounded="rounded" /> {r.levelName ?? `Lv. ${r.level}`}</div></div>
              <span className="shrink-0 text-xs font-bold tabular-nums">{r.totalXp.toLocaleString()} XP</span>
            </motion.button>
          ))}
        </motion.div>
        <motion.div variants={{ hide: { opacity: 0 }, show: { opacity: 1 } }} className="border-t border-border p-3"><Link to="/leaderboard" onClick={onClose} className="block w-full rounded-xl bg-primary py-2.5 text-center text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90">Full page →</Link></motion.div>
      </motion.div>
    </MorphPanel>
  );
}

/* ---------- right rail: calendar ---------- */
function CalendarCard() {
  const [anchor, setAnchor] = useState(() => new Date());
  const tasks = useMyTasks();
  // Days (in the visible month) that have at least one task due.
  const dueDays = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks.data ?? []) {
      if (!t.dueDate) continue;
      const d = new Date(t.dueDate);
      if (!Number.isNaN(d.getTime())) set.add(d.toISOString().slice(0, 10));
    }
    return set;
  }, [tasks.data]);

  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const monthStart = new Date(year, month, 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <Section title="Calendar" action={<SeeAll to="/master-calendar" />}>
      <div className="mb-3 flex items-center justify-center gap-3 text-sm font-medium">
        <button onClick={() => setAnchor(new Date(year, month - 1, 1))} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><ChevronLeft className="h-4 w-4" /></button>
        {anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        <button onClick={() => setAnchor(new Date(year, month + 1, 1))} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-y-1.5 text-center text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d} className="text-muted-foreground">{d.slice(0, 1)}</span>)}
        {days.map((d) => {
          const key = d.toISOString().slice(0, 10);
          const inMonth = d.getMonth() === month;
          const isToday = key === todayKey;
          const hasDue = dueDays.has(key);
          return (
            <div key={key} className="relative mx-auto grid h-7 w-7 place-items-center">
              <span className={cn("grid h-7 w-7 place-items-center rounded-full", isToday ? "bg-primary font-semibold text-primary-foreground" : !inMonth ? "text-muted-foreground/40" : "text-foreground/80 hover:bg-accent")}>{d.getDate()}</span>
              {hasDue && !isToday && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary" />}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ---------- right rail: schedule ---------- */
function ScheduleCard() {
  const tasks = useMyTasks();
  const items = useMemo(() => {
    return (tasks.data ?? [])
      .filter((t) => t.dueDate && (t.status ?? "").toUpperCase() !== "DONE" && (t.status ?? "").toUpperCase() !== "CANCELLED")
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
      .slice(0, 6);
  }, [tasks.data]);
  return (
    <Section title="Your Schedule" action={<SeeAll to="/my-tasks" />}>
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
      {!tasks.isLoading && items.length === 0 && <p className="text-sm text-muted-foreground">No upcoming tasks with due dates.</p>}
      <div className="space-y-2.5">
        {items.map((t) => (
          <Link key={t.id} to="/tasks/$taskId" params={{ taskId: t.id }} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span className="h-8 w-1 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{t.title}</div>
              <div className="truncate text-xs text-muted-foreground">{t.taskList?.name ?? "NEXUS"}</div>
            </div>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">{fmtDue(t.dueDate)}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}
