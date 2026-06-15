import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { activeNotifications, fmtDate, nexusApi, type NexusNotification } from "@/lib/nexus-api";
import { AtSign, UserPlus, MessageCircle, AlarmClock, Activity, Check, Trash2, Loader2 } from "lucide-react";
import { celebrate } from "@/components/Celebration";
import { Reveal } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/inbox")({ component: InboxPage });

const iconMap = [AtSign, UserPlus, MessageCircle, AlarmClock, Activity];

function InboxPage() {
  const qc = useQueryClient();
  const inbox = useQuery({ queryKey: ["nexus", "notifications"], queryFn: () => nexusApi.notifications(false), retry: false });
  const markAll = useMutation({
    mutationFn: nexusApi.markAllNotificationsRead,
    onSuccess: () => {
      celebrate("Inbox Zero! 📭✨");
      qc.invalidateQueries({ queryKey: ["nexus", "notifications"] });
    },
  });
  // Hide notifications read more than a week ago; unread always stay.
  const notifications = activeNotifications(inbox.data?.notifications ?? []);

  return (
    <div>
      <PageHeader title="Signal Inbox" subtitle="Live mentions, assignments, pings, and the stuff that needs your magic." actions={
        <button onClick={() => markAll.mutate()} disabled={markAll.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors duration-150 hover:bg-accent active:scale-[0.98] active:scale-95 transition disabled:opacity-60">
          {markAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Mark all read
        </button>
      } />
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <div className="mb-3 rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary">
          {inbox.data?.unreadCount ?? 0} unread signal(s) waiting for you.
        </div>
        <Reveal>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            {inbox.isLoading && Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 p-4">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-2.5 w-24" /></div>
              </div>
            ))}
            {inbox.isError && <Empty title="Signal locked" message="Login/session diperlukan untuk buka live inbox." />}
            {!inbox.isLoading && !inbox.isError && notifications.length === 0 && <Empty title="Inbox clean" message="No pings. Enjoy the rare silence." />}
            {!inbox.isLoading && notifications.map((n, idx) => <NotificationRow key={n.id} notification={n} idx={idx} />)}
          </div>
        </Reveal>
      </div>
    </div>
  );
}

/** Where a notification should take you when clicked (link field first, then by type). */
function notificationTarget(n: NexusNotification): { to: string; params?: Record<string, string> } | null {
  if (n.taskId) return { to: "/tasks/$taskId", params: { taskId: n.taskId } };
  if (n.projectId) return { to: "/projects/$projectId", params: { projectId: n.projectId } };
  const t = (n.type ?? "").toLowerCase();
  if (t.includes("checkout") || t.includes("offsite") || t.includes("attendance") || t.includes("late") || t.includes("absen")) return { to: "/attendance" };
  if (t.includes("message")) return { to: "/messages" };
  if (n.link && n.link.startsWith("/")) return { to: n.link };
  return null;
}

function NotificationRow({ notification, idx }: { notification: NexusNotification; idx: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const Icon = iconMap[idx % iconMap.length];
  const refresh = () => qc.invalidateQueries({ queryKey: ["nexus", "notifications"] });
  const markRead = useMutation({ mutationFn: () => nexusApi.markNotificationRead(notification.id), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => nexusApi.deleteNotification(notification.id), onSuccess: () => { refresh(); celebrate("Signal archived 🧹"); } });
  const busy = markRead.isPending || remove.isPending;
  const target = notificationTarget(notification);

  const open = () => {
    if (!notification.read) markRead.mutate();
    if (target) {
      // TanStack routes are strictly typed; the path is dynamic here so cast through the navigate call.
      (navigate as unknown as (opts: { to: string; params?: Record<string, string> }) => Promise<void>)(target).catch(() => {});
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
        <p className="text-sm font-semibold">{notification.title || signalTitle(notification)}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{notification.message || "New NEXUS signal arrived."}</p>
        <p className="text-xs text-muted-foreground mt-1">{fmtDate(notification.createdAt)} · {notification.type || "signal"}{target ? " · ketuk buka" : ""}</p>
        {(markRead.isError || remove.isError) && <p className="mt-1 text-xs font-semibold text-destructive">Action failed. Check permission/session.</p>}
      </div>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {!notification.read && <button disabled={busy} onClick={() => markRead.mutate()} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">Read</button>}
        <button disabled={busy} onClick={() => remove.mutate()} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50" title="Delete notification">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </button>
        {!notification.read && <span className="h-2 w-2 rounded-full bg-primary ml-1" />}
      </div>
    </div>
  );
}

function Empty({ title, message }: { title: string; message: string }) {
  return <div className="p-8 text-center"><div className="text-lg font-black">{title}</div><p className="mt-2 text-sm text-muted-foreground">{message}</p></div>;
}

function signalTitle(notification: NexusNotification) {
  const type = (notification.type || "signal").toLowerCase().replace(/_/g, " ");
  return type.charAt(0).toUpperCase() + type.slice(1);
}
