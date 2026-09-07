import { motion } from "framer-motion";
import { notificationFilterTabs, type NexusNotification, type NotificationGroupId } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

/**
 * Filter a notification list by kind.
 *
 * Same segmented-tab idiom as the Ticket list (sliding `layoutId` pill, count badge) rather than a
 * new control: this is the app's existing "narrow this list" gesture. The tabs are the human-facing
 * buckets from `notificationFilterTabs`, not the ~30 raw `type` strings — nobody scanning their
 * inbox thinks in `attendance_request_reviewed`.
 *
 * `layoutId` must be unique per instance on screen, otherwise the pill animates between the two.
 */
export function NotificationFilterTabs({ list, group, onChange, layoutId, compact }: {
  list: NexusNotification[];
  group: NotificationGroupId;
  onChange: (g: NotificationGroupId) => void;
  layoutId: string;
  compact?: boolean;
}) {
  const tabs = notificationFilterTabs(list);
  // Only "All" plus a single bucket — there is nothing to choose between.
  if (tabs.length <= 2) return null;
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          aria-pressed={group === t.id}
          className={cn("relative shrink-0 rounded-lg font-bold transition", compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm")}
        >
          {group === t.id && (
            <motion.span layoutId={layoutId} className="absolute inset-0 rounded-lg bg-primary" transition={{ type: "spring", stiffness: 400, damping: 32 }} />
          )}
          <span className={cn("relative flex items-center gap-1.5", group === t.id ? "text-primary-foreground" : "text-muted-foreground")}>
            {t.label}
            <span className={cn("rounded-full px-1.5 text-[10px] font-black tabular-nums", group === t.id ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground")}>{t.count}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
