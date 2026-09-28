package id.znetworks.nexus.feature.push

import org.junit.Assert.assertEquals
import org.junit.Test

class ChannelTest {
    @Test fun serverChannelWinsWhenKnown() {
        assertEquals("approvals", PushManager.channelFor("whatever", "approvals"))
        // Today's server ids are created too, so they are honoured.
        assertEquals("attendance", PushManager.channelFor("attendance_checkin_reminder", "attendance"))
        // An unknown id falls back to the type.
        assertEquals("messages", PushManager.channelFor("MESSAGE", "nope"))
    }

    @Test fun byTypeWhenNoChannel() {
        // Extra day off granted (UPDATES 28 Sep §5): an attendance reminder.
        assertEquals("attendance_reminders", PushManager.channelFor("dayoff_bonus_granted", null))
        assertEquals("approvals", PushManager.channelFor("attendance_request_pending", null))
        assertEquals("approvals", PushManager.channelFor("offsite_checkout_reviewed", null))
        assertEquals("attendance_location", PushManager.channelFor("attendance_auto_offsite_checkout", null))
        assertEquals("attendance_reminders", PushManager.channelFor("attendance_absent_recorded", null))
        assertEquals("tickets", PushManager.channelFor("complaint_reply", null))
        assertEquals("announcements", PushManager.channelFor("announcement", null))
        assertEquals("system", PushManager.channelFor("brand_new", null))
        assertEquals("system", PushManager.channelFor("app_update", "system"))
    }
}
