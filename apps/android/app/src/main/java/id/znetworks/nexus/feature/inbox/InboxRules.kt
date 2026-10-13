package id.znetworks.nexus.feature.inbox

/**
 * Notification kinds and filter tabs (dev web routes/_app/inbox.tsx notificationMark, lib/nexus-api.ts
 * notificationGroup / notificationFilterTabs). Pure, so the JVM tests hold them to the web's rules.
 */
object InboxRules {
    /** The kind's mark: an icon and a tone (drawn in InboxUi). */
    enum class Mark { MENTION, ASSIGNED, COMPLETED, CONVERSATION, DUE, ATTENDANCE, OUTSIDE, ANNOUNCEMENT, TICKET, DOCUMENT, QUEST, MEMBERSHIP, STATUS, BELL }

    fun mark(type: String?): Mark {
        val t = type.orEmpty().lowercase()
        return when {
            // Someone outside the office (attendance_outside_approver) is an attendance signal like the web and iOS
            // (teal calendar check, run 5, 14 Oct 2026); it had its own walking-person mark.
            "mention" in t -> Mark.MENTION
            t == "task_assigned" || t == "project_invite" || t == "members_added" -> Mark.ASSIGNED
            t == "task_completed" -> Mark.COMPLETED
            t.startsWith("comment") || t.startsWith("message") || t.startsWith("feed_") || t == "complaint_reply" -> Mark.CONVERSATION
            "due" in t || "reminder" in t || t == "booking_soon" || t == "streak_at_risk" -> Mark.DUE
            t.startsWith("attendance") || t.startsWith("offsite") || "dayoff" in t || "quota" in t -> Mark.ATTENDANCE
            "announcement" in t -> Mark.ANNOUNCEMENT
            t.startsWith("complaint") -> Mark.TICKET
            t == "submission_status" || t == "doc_mention" -> Mark.DOCUMENT
            t.startsWith("quest") -> Mark.QUEST
            t.startsWith("member_") || t.startsWith("group_") -> Mark.MEMBERSHIP
            t == "status_update" -> Mark.STATUS
            else -> Mark.BELL
        }
    }

    /** Which bucket a raw type belongs to; unknown types land in Other, never invisible (web notificationGroup). */
    fun group(type: String?): InboxGroup {
        val t = type.orEmpty().lowercase()
        return when {
            t.startsWith("attendance") || t.startsWith("offsite") || t == "dayoff_quota_low" || t == "dayoff_bonus_granted" || t == "red_date_quota_low" -> InboxGroup.ATTENDANCE
            t == "submission_status" -> InboxGroup.SUBMISSIONS
            t.startsWith("complaint") -> InboxGroup.TICKETS
            "announcement" in t -> InboxGroup.ANNOUNCEMENTS
            t.startsWith("message") || t.startsWith("feed_") -> InboxGroup.MESSAGES
            t.startsWith("task") || t.startsWith("comment") || t.startsWith("quest") || t == "project_invite" || t == "status_update" || t == "streak_at_risk" -> InboxGroup.TASKS
            else -> InboxGroup.OTHER
        }
    }

    /** Tabs worth drawing for this list: All plus only the buckets with something in them, each with its count. */
    fun tabs(types: List<String?>): List<Pair<InboxGroup, Int>> {
        val counts = types.groupingBy { group(it) }.eachCount()
        return InboxGroup.entries.filter { it == InboxGroup.ALL || (counts[it] ?: 0) > 0 }
            .map { it to if (it == InboxGroup.ALL) types.size else counts[it] ?: 0 }
    }

    /**
     * What the inbox lists (web `activeNotifications`): every unread one, and read ones from the last [maxDays] days
     * (createdAt stands in for the read time). The dev server held 50 rows; the web listed 19.
     */
    fun active(items: List<InboxItem>, now: java.time.Instant = java.time.Instant.now(), maxDays: Long = 7): List<InboxItem> = items.filter { n ->
        if (!n.read) return@filter true
        val at = n.createdAt?.let { runCatching { java.time.OffsetDateTime.parse(it).toInstant() }.getOrNull() } ?: return@filter false
        java.time.Duration.between(at, now) <= java.time.Duration.ofDays(maxDays)
    }

    fun filter(items: List<InboxItem>, g: InboxGroup) = if (g == InboxGroup.ALL) items else items.filter { group(it.type) == g }
}
