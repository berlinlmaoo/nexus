package id.znetworks.nexus.core.nav

import org.junit.Assert.assertEquals
import org.junit.Test

class LinksTest {
    @Test fun attendanceFocusLinks() {
        assertEquals(Target.Attendance(requestId = "r1"), Links.parse("/attendance?request=r1"))
        assertEquals(Target.Attendance(offsiteId = "rec9"), Links.parse("/attendance?offsite=rec9"))
        assertEquals(Target.Attendance(permitToday = true), Links.parse("/attendance?permit=today"))
        assertEquals(Target.Attendance(), Links.parse("/attendance?reminder=checkin&date=2026-09-24&t=15"))
        assertEquals(Target.Attendance(requestId = "r1"), Links.parse("https://nexus.znetworks.id/attendance?request=r1"))
        assertEquals(Target.Attendance(permitToday = true), Links.parse("nexus://attendance?permit=today"))
    }

    @Test fun otherScreensOpenOnTheWeb() {
        assertEquals(Target.Web("/peer-reports?x=1"), Links.parse("/peer-reports?x=1"))
        assertEquals(Target.Announcement("a1"), Links.parse("/dashboard?announcement=a1"))
        assertEquals(Target.Tab("home"), Links.parse("/dashboard"))
        assertEquals(Target.Profile("u1"), Links.parse("/people/u1"))
        assertEquals(Target.Folder("f1"), Links.parse("https://nexus.znetworks.id/folders/f1"))
        assertEquals(Target.Inbox, Links.parse("/inbox"))
        assertEquals(Target.Settings, Links.parse("nexus://settings"))
    }

    @Test fun projectAndTaskLinks() {
        assertEquals(Target.Task("T1"), Links.parse("/projects/P1/tasks/T1"))
        assertEquals(Target.Task("T1"), Links.parse("/tasks/T1?reminder=due_1d&due=2026-09-30"))
        assertEquals(Target.Project("P1"), Links.parse("https://nexus.znetworks.id/projects/P1"))
        assertEquals(Target.Tab("projects"), Links.parse("/projects"))
        assertEquals(Target.Tab("tasks"), Links.parse("/my-tasks"))
    }

    @Test fun externalStaysExternal() {
        assertEquals(Target.External("https://apps.apple.com/x"), Links.parse("https://apps.apple.com/x"))
        // A look-alike host is not NEXUS.
        assertEquals(Target.External("https://nexus.znetworks.id.evil.com/attendance"), Links.parse("https://nexus.znetworks.id.evil.com/attendance"))
    }

    @Test fun notificationPrecedence() {
        assertEquals(Target.Task("t"), Links.forNotification("comment_added", "/attendance", "t", "p"))
        assertEquals(Target.Project("p"), Links.forNotification("project_invite", null, null, "p"))
        assertEquals(Target.Attendance(requestId = "x"), Links.forNotification("attendance_request_pending", "/attendance?request=x", null, null))
        assertEquals(Target.Attendance(), Links.forNotification("attendance_auto_offsite_checkout", null, null, null))
        // Unknown type, no link: Inbox, never a crash.
        assertEquals(Target.Inbox, Links.forNotification("brand_new_type", null, null, null))
    }

    @Test fun routerHoldsUntilClaimed() {
        val r = Router()
        val t = Target.Attendance(requestId = "r")
        r.open(t)
        assertEquals(t, r.pending.value)
        r.consumed(Target.Inbox) // someone else's claim does not clear it
        assertEquals(t, r.pending.value)
        r.consumed(t)
        assertEquals(null, r.pending.value)
    }

    @Test fun inviteAndSignupLinksReachTheSignedOutScreens() {
        assertEquals(Target.ResetPassword("a@b.id", invited = true), Links.parse("nexus://forgot-password?email=a%40b.id&invited=1"))
        assertEquals(Target.ResetPassword(null), Links.parse("https://nexus.znetworks.id/forgot-password"))
        assertEquals(Target.Register("ZNET-12"), Links.parse("/register?code=ZNET-12"))
    }

    @Test fun ticketLinks() {
        assertEquals(Target.Tickets("t1"), Links.parse("/complaints?id=t1"))
        assertEquals(Target.Tickets(null), Links.forNotification("complaint_reply", null, null, null))
        assertEquals(Target.Tab("home"), Links.forNotification("announcement", null, null, null)) // never the browser
    }

    @Test fun inviteLinkSetsAPassword() {
        assertEquals(Target.ResetPassword("a@z.id", invited = true), Links.parse("/forgot-password?email=a@z.id&invited=1"))
        assertEquals(Target.ResetPassword("a@z.id", invited = false), Links.parse("/forgot-password?email=a@z.id"))
    }

    // Calendar phase 3: /calendar carries the web's state; /master-calendar is the old page (booking → Room booking).
    @Test fun calendarLinks() {
        assertEquals(Target.Calendar("2026-10-03", null, "person", null, null, null), Links.parse("/calendar?date=2026-10-03&lens=person"))
        assertEquals(Target.Calendar(task = "cmx1", view = "people"), Links.parse("https://nexus.znetworks.id/calendar?view=people&task=cmx1"))
        assertEquals(Target.Calendar(), Links.parse("/calendar"))
        assertEquals(Target.Calendar("2026-10-05"), Links.parse("/master-calendar?date=2026-10-05"))
        assertEquals(Target.RoomBooking, Links.parse("/master-calendar?booking=b1"))
    }
}
