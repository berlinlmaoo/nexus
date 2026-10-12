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
import { AtSign, UserPlus, MessageCircle, AlarmClock, Activity, Check, Trash2, Loader2, Inbox, Filter, Lock } from "lucide-react";
import { celebrate } from "@/components/Celebration";
import { Reveal } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/lib/lang";

export const Route = createFileRoute("/_app/inbox")({ component: InboxPage });

const iconMap = [AtSign, UserPlus, MessageCircle, AlarmClock, Activity];

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
        <button onClick={() => markAll.mutate()} disabled={markAll.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors duration-150 hover:bg-accent active:scale-[0.98] active:scale-95 transition disabled:opacity-60">
          {markAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t("Mark all as read")}
        </button>
      } />
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <div className="mb-3 rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary">
          {tn(inbox.data?.unreadCount ?? 0, "{n} unread notification", "{n} unread notifications", { n: inbox.data?.unreadCount ?? 0 })}
        </div>
        {!inbox.isLoading && !inbox.isError && notifications.length > 0 && (
          <div className="mb-3">
            <NotificationFilterTabs list={notifications} group={group} onChange={setGroup} layoutId="inbox-filter-tab" />
          </div>
        )}
        <Reveal>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
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
            {!inbox.isLoading && shown.map((n, idx) => <NotificationRow key={n.id} notification={n} idx={idx} />)}
          </div>
        </Reveal>
      </div>
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

function NotificationRow({ notification, idx }: { notification: NexusNotification; idx: number }) {
  const { t, locale } = useLang();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const Icon = iconMap[idx % iconMap.length];
  const refresh = () => qc.invalidateQueries({ queryKey: ["nexus", "notifications"] });
  const markRead = useMutation({ mutationFn: () => nexusApi.markNotificationRead(notification.id), onSuccess: refresh, onError: (e: unknown) => alert(e instanceof Error ? e.message : t("Couldn't mark it as read.")), });
  const remove = useMutation({ mutationFn: () => nexusApi.deleteNotification(notification.id), onSuccess: () => { refresh(); celebrate(t("Notification deleted")); }, onError: (e: unknown) => alert(e instanceof Error ? e.message : t("Couldn't delete it.")), });
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
      <div className="relative">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary font-black">N</div>
        <span className="absolute -bottom-1 -right-1 grid place-items-center h-4 w-4 rounded-full bg-card border border-border">
          <Icon className="h-2.5 w-2.5 text-muted-foreground" />
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{notification.title || t(typeTitle(notification))}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{notification.message || t("New notification")}</p>
        <p className="text-xs text-muted-foreground mt-1">{fmtDay(notification.createdAt, locale)}</p>
        {(markRead.isError || remove.isError) && <p className="mt-1 text-xs font-semibold text-destructive">{t("That didn't work. Check your connection and try again.")}</p>}
      </div>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {!notification.read && <button disabled={busy} onClick={() => markRead.mutate()} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">{t("Mark as read")}</button>}
        <button disabled={busy} onClick={() => remove.mutate()} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50" title={t("Delete notification")} aria-label={t("Delete notification")}>
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

/** A notification with no title: its type in plain words ("task_assigned" → "Task assigned"). */
function typeTitle(notification: NexusNotification) {
  const type = (notification.type || "notification").toLowerCase().replace(/_/g, " ");
  return type.charAt(0).toUpperCase() + type.slice(1);
}
