package id.znetworks.nexus.feature.inbox

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Notifications redesign (web inbox.tsx notificationMark, nexus-api notificationGroup / notificationFilterTabs). */
class InboxRulesTest {
    @Test fun marksFollowTheWeb() {
        assertEquals(InboxRules.Mark.MENTION, InboxRules.mark("feed_mention"))
        assertEquals(InboxRules.Mark.ASSIGNED, InboxRules.mark("task_assigned"))
        assertEquals(InboxRules.Mark.COMPLETED, InboxRules.mark("task_completed"))
        assertEquals(InboxRules.Mark.CONVERSATION, InboxRules.mark("complaint_reply"))
        assertEquals(InboxRules.Mark.DUE, InboxRules.mark("task_due_soon"))
        assertEquals(InboxRules.Mark.ATTENDANCE, InboxRules.mark("dayoff_bonus_granted"))
        assertEquals(InboxRules.Mark.ATTENDANCE, InboxRules.mark("attendance_outside_approver")) // web / iOS: teal calendar check (run 5)
        assertEquals(InboxRules.Mark.TICKET, InboxRules.mark("complaint_status"))
        assertEquals(InboxRules.Mark.DOCUMENT, InboxRules.mark("submission_status"))
        assertEquals(InboxRules.Mark.MEMBERSHIP, InboxRules.mark("group_removed"))
        assertEquals(InboxRules.Mark.BELL, InboxRules.mark("brand_new_kind"))
        assertEquals(InboxRules.Mark.BELL, InboxRules.mark(null))
    }

    @Test fun groupsAndTabs() {
        assertEquals(InboxGroup.MESSAGES, InboxRules.group("feed_like"))
        assertEquals(InboxGroup.TASKS, InboxRules.group("project_invite"))
        assertEquals(InboxGroup.OTHER, InboxRules.group("something_new")) // never invisible
        // All + only kinds with something in them, each with its count.
        assertEquals(listOf(InboxGroup.ALL to 4, InboxGroup.TASKS to 2, InboxGroup.ATTENDANCE to 1, InboxGroup.OTHER to 1),
            InboxRules.tabs(listOf("task_assigned", "comment_added", "attendance_request_reviewed", null)))
    }

    @Test fun actorIsReadAndOptional() {
        val r = NexusJson.decodeFromString(InboxResponse.serializer(), """{"notifications":[
            {"id":"a","type":"task_assigned","title":"T","actor":{"id":"u1","name":"Budi","avatar":null}},{"id":"b","title":"S"}],"unreadCount":1}""")
        assertEquals("Budi", r.notifications[0].actor?.name); assertNull(r.notifications[1].actor)
        assertEquals(listOf("a"), InboxRules.filter(r.notifications, InboxGroup.TASKS).map { it.id })
    }

    @Test fun readOnesOlderThanAWeekLeaveTheList() {
        val now = java.time.Instant.parse("2026-10-14T03:00:00Z")
        val items = listOf(
            InboxItem("old-read", read = true, createdAt = "2026-09-21T14:00:11.914Z"),
            InboxItem("old-unread", read = false, createdAt = "2026-09-21T14:00:11.914Z"),
            InboxItem("new-read", read = true, createdAt = "2026-10-12T17:15:43.059Z"),
            InboxItem("no-date-read", read = true),
        )
        org.junit.Assert.assertEquals(listOf("old-unread", "new-read"), InboxRules.active(items, now).map { it.id })
    }
}
