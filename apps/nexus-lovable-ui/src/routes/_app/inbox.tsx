import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  activeNotifications,
  nexusApi,
  notificationGroup,
  type NexusNotification,
  type NotificationGroupId,
} from "@/lib/nexus-api";
import { NotificationFilterTabs } from "@/components/NotificationFilterTabs";
import { PageBody } from "@/components/PageLayout";
import { AtSign, UserPlus, MessageCircle, AlarmClock, Activity, Check, Trash2, Loader2, Inbox, Filter, Lock, CheckCircle2, CalendarCheck, Megaphone, LifeBuoy, FileText, Trophy, DoorOpen, Bell, type LucideIcon } from "lucide-react";
import { celebrate } from "@/components/Celebration";
import { Reveal } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/lib/lang";
import { toast } from "sonner";
import { notificationMessage, notificationTitle } from "@/lib/server-text";

export const Route = createFileRoute("/_app/inbox")({ component: InboxPage });

/**
 * The row's mark comes from what the notification is about (QA B13/S-27, 13 Oct 2026): it used to cycle
 * five icons by row position and draw a generic "N" for every sender. Notifications carry no actor id,
 * so the circle shows the kind of event, in that kind's colour.
 */
function notificationMark(type?: string | null): { Icon: LucideIcon; tone: string } {
  const t = (type ?? "").toLowerCase();
  if (t.includes("mention")) return { Icon: AtSign, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-400" };
  if (t === "task_assigned" || t === "project_invite" || t === "members_added") return { Icon: UserPlus, tone: "bg-primary/10 text-primary" };
  if (t === "task_completed") return { Icon: CheckCircle2, tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" };
  if (t.startsWith("comment") || t.startsWith("message") || t.startsWith("feed_") || t === "complaint_reply") return { Icon: MessageCircle, tone: "bg-violet-500/12 text-violet-600 dark:text-violet-400" };
  if (t.includes("due") || t.includes("reminder") || t === "booking_soon" || t === "streak_at_risk") return { Icon: AlarmClock, tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" };
  if (t.startsWith("attendance") || t.startsWith("offsite") || t.includes("dayoff") || t.includes("quota")) return { Icon: CalendarCheck, tone: "bg-teal-500/12 text-teal-700 dark:text-teal-400" };
  if (t.includes("announcement")) return { Icon: Megaphone, tone: "bg-orange-500/12 text-orange-700 dark:text-orange-400" };
  if (t.startsWith("complaint")) return { Icon: LifeBuoy, tone: "bg-rose-500/12 text-rose-600 dark:text-rose-400" };
  if (t === "submission_status" || t === "doc_mention") return { Icon: FileText, tone: "bg-slate-500/12 text-slate-700 dark:text-slate-300" };
  if (t.startsWith("quest")) return { Icon: Trophy, tone: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" };
  if (t.startsWith("member_") || t.startsWith("group_")) return { Icon: DoorOpen, tone: "bg-slate-500/12 text-slate-700 dark:text-slate-300" };
  if (t === "status_update") return { Icon: Activity, tone: "bg-primary/10 text-primary" };
  return { Icon: Bell, tone: "bg-muted text-muted-foreground" };
}

function InboxPage() {
  const { t, tn } = useLang();
  const qc = useQueryClient();
  const inbox = useQuery({ queryKey: ["nexus", "notifications"], queryFn: () => nexusApi.notifications(false), retry: false });
  const markAll = useMutation({
    mutationFn: nexusApi.markAllNotificationsRead,
    onSuccess: () => {
      celebrate(t("All caught up"));
      qc.invalidateQueries({ queryKey: ["nexus", "notifications"] });
    },
  });
  // Hide notifications read more than a week ago; unread always stay.
  const notifications = activeNotifications(inbox.data?.notifications ?? []);
  const [group, setGroup] = useState<NotificationGroupId>("all");
  const shown = useMemo(
    () => (group === "all" ? notifications : notifications.filter((n) => notificationGroup(n.type) === group)),
    [notifications, group],
  );

  return (
    <div>
      <PageHeader title={t("Notifications")} subtitle={t("Mentions, assignments, approvals and replies that need you.")} actions={
        <button onClick={() => markAll.mutate()} disabled={markAll.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors duration-150 hover:bg-accent active:scale-[0.98] disabled:opacity-60">
          {markAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t("Mark all as read")}
        </button>
      } tabs={!inbox.isLoading && !inbox.isError && notifications.length > 0
        ? <NotificationFilterTabs list={notifications} group={group} onChange={setGroup} />
        : undefined} />
      {/* Full width under the header like every list page (it was a centred 3xl column, UI sweep 12 Oct 2026). */}
      <PageBody>
        {/* Only when there is something unread (an empty inbox had a grey "0 unread" bar over the empty state). */}
        {(inbox.data?.unreadCount ?? 0) > 0 && (
          <div className="mb-3 text-sm font-medium text-muted-foreground">
            {tn(inbox.data?.unreadCount ?? 0, "{n} unread notification", "{n} unread notifications", { n: inbox.data?.unreadCount ?? 0 })}
          </div>
        )}
        <Reveal>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {inbox.isLoading && Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 p-4">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-2.5 w-24" /></div>
              </div>
            ))}
            {inbox.isError && <EmptyState icon={Lock} tone="muted" title={t("Couldn't load notifications")} message={t("Your session may have ended. Sign in again to see your notifications.")} compact />}
            {!inbox.isLoading && !inbox.isError && notifications.length === 0 && (
              <EmptyState icon={Inbox} tone="success" title={t("No notifications")} compact
                message={t("Requests to approve, replies to your tickets, mentions and announcements show up here the moment they happen. Nothing needs you right now.")} />
            )}
            {!inbox.isLoading && !inbox.isError && notifications.length > 0 && shown.length === 0 && (
              <EmptyState icon={Filter} tone="muted" title={t("Nothing of this kind")} compact
                message={t("This filter only shows one type of notification. Everything else is still in All.")}
                action={<EmptyAction onClick={() => setGroup("all")}>{t("Show all")}</EmptyAction>} />
            )}
            {!inbox.isLoading && shown.map((n) => <NotificationRow key={n.id} notification={n} />)}
          </div>
        </Reveal>
      </PageBody>
    </div>
  );
}

/** Where a notification should take you when clicked (link field first, then by type). */
function notificationTarget(n: NexusNotification): { to: string; params?: Record<string, string>; search?: Record<string, string> } | null {
  if (n.taskId) return { to: "/tasks/$taskId", params: { taskId: n.taskId } };
  if (n.projectId) return { to: "/projects/$projectId", params: { projectId: n.projectId } };
  // The link first, the type keywords only as a fallback. The server now puts the record's id in
  // the link (`/attendance?request=…`, `/complaints?id=…`, `/messages?c=…`); matching on the type
  // before reading it threw that id away and landed every attendance signal on the top of the page.
  // Integrity and Social Approvals were removed (12 Oct 2026); their old signals stay as plain,
  // read-only rows. The server already drops the link; this covers a cached response.
  const type = (n.type ?? "").toLowerCase();
  if (type.startsWith("peer_report") || type === "violation_announcement" || /^\/(peer-reports|social)(?:[/?#]|$)/.test(n.link ?? "")) return null;
  if (n.link && n.link.startsWith("/")) {
    // The router matches on the path alone — a link like `/submissions?id=abc` has to be split, or
    // the query string ends up part of the path and nothing matches.
    const [path, qs] = n.link.split("?");
    return { to: path, search: qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined };
  }
  const t = type;
  if (t.includes("checkout") || t.includes("offsite") || t.includes("attendance") || t.includes("late") || t.includes("absen")) return { to: "/attendance" };
  if (t.includes("message")) return { to: "/messages" };
  return null;
}

function NotificationRow({ notification }: { notification: NexusNotification }) {
  const { t, locale } = useLang();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { Icon, tone } = notificationMark(notification.type);
  const refresh = () => qc.invalidateQueries({ queryKey: ["nexus", "notifications"] });
  const markRead = useMutation({ mutationFn: () => nexusApi.markNotificationRead(notification.id), onSuccess: refresh, onError: () => toast.error(t("Couldn't mark it as read.")) });
  const remove = useMutation({ mutationFn: () => nexusApi.deleteNotification(notification.id), onSuccess: () => { refresh(); celebrate(t("Notification deleted")); }, onError: () => toast.error(t("Couldn't delete it.")) });
  const busy = markRead.isPending || remove.isPending;
  const target = notificationTarget(notification);

  const open = () => {
    if (!notification.read) markRead.mutate();
    // An external link (the App Store, for the "update NEXUS" reminder) opens in a new tab; the
    // router only knows in-app paths.
    if (notification.link && /^https?:\/\//.test(notification.link)) { window.open(notification.link, "_blank", "noopener"); return; }
    if (target) {
      // TanStack routes are strictly typed; the path is dynamic here so cast through the navigate call.
      (navigate as unknown as (opts: { to: string; params?: Record<string, string>; search?: Record<string, string> }) => Promise<void>)(target).catch(() => {});
    }
  };

  return (
    <div
      role={target ? "button" : undefined}
      tabIndex={target ? 0 : undefined}
      onClick={target ? open : undefined}
      onKeyDown={target ? (e) => { if (e.key === "Enter") open(); } : undefined}
      className={`flex items-start gap-3 p-4 transition ${target ? "cursor-pointer hover:bg-accent/60 active:scale-[0.995]" : "hover:bg-accent/40"} ${!notification.read ? "bg-primary/[0.03]" : ""}`}
    >
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone}`} data-notification-mark={notification.type ?? ""} aria-hidden>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="line-clamp-2 break-words text-sm font-semibold">{notificationTitle(notification)}</p>
        <p className="line-clamp-3 max-w-3xl break-words text-sm text-muted-foreground mt-0.5">{notificationMessage(notification) || t("New notification")}</p>
        <p className="text-xs text-muted-foreground mt-1">{fmtDay(notification.createdAt, locale)}</p>
        {(markRead.isError || remove.isError) && <p className="mt-1 text-xs font-semibold text-destructive">{t("That didn't work. Check your connection and try again.")}</p>}
      </div>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {/* Phone: icon-only, so the title keeps the row's width (QA B21). */}
        {!notification.read && <button disabled={busy} onClick={() => markRead.mutate()} aria-label={t("Mark as read")} title={t("Mark as read")} className="inline-flex min-h-8 min-w-8 items-center justify-center gap-1 rounded-md pointer-coarse:min-h-9 border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"><Check className="h-3 w-3 sm:hidden" /><span className="max-sm:hidden">{t("Mark as read")}</span></button>}
        <button disabled={busy} onClick={() => remove.mutate()} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md pointer-coarse:min-h-9 pointer-coarse:min-w-9 border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50" title={t("Delete notification")} aria-label={t("Delete notification")}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </button>
        {!notification.read && <span className="h-2 w-2 rounded-full bg-primary ml-1" />}
      </div>
    </div>
  );
}

function fmtDay(value: string | null | undefined, locale: string) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

