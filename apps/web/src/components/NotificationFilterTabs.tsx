import { PageTabs } from "@/components/PageLayout";
import { useLang } from "@/lib/lang";
import { notificationFilterTabs, type NexusNotification, type NotificationGroupId } from "@/lib/nexus-api";

/**
 * Filter a notification list by kind.
 *
 * Same tabs as the Ticket queues (`PageTabs`, a count on each) rather than a new control: this is the
 * app's existing "narrow this list" gesture. The tabs are the human-facing
 * buckets from `notificationFilterTabs`, not the ~30 raw `type` strings — nobody scanning their
 * inbox thinks in `attendance_request_reviewed`.
 */
export function NotificationFilterTabs({ list, group, onChange, compact }: {
  list: NexusNotification[];
  group: NotificationGroupId;
  onChange: (g: NotificationGroupId) => void;
  /** Kept for callers; the tabs no longer animate a shared pill. */
  layoutId?: string;
  compact?: boolean;
}) {
  const { t } = useLang();
  const label = t("Filter notifications");
  const tabs = notificationFilterTabs(list);
  // The bell panel holds only the latest notifications: "All 50" beside "280 unread" read as a wrong count
  // (visual QA 24 Oct 2026), so its All tab carries no number; the buckets still count what is listed.
  // Only "All" plus a single bucket — there is nothing to choose between.
  if (tabs.length <= 2) return null;
  // The shared light underline tabs (UI sweep 12 Oct 2026); the black sliding pill is gone.
  return (
    <div className="overflow-x-auto">
      <PageTabs label={label} value={group} onChange={onChange} className={compact ? "gap-3 text-xs" : undefined}
        tabs={tabs.map((tab) => ({ key: tab.id, label: t(tab.label), count: compact && tab.id === "all" ? undefined : tab.count }))} />
    </div>
  );
}
