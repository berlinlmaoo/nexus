package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AdminMoreTest {
    @Test fun announcementRepeatKeysOnlyWhenRepeating() {
        assertFalse("repeatDays" in AnnounceRules.body("T", "B", "info", 0, "09:00"))
        val b = AnnounceRules.body(" T ", "B", "info", 3, "08:30")
        assertEquals("3", b["repeatDays"].toString()); assertEquals("\"08:30\"", b["repeatAtTime"].toString()); assertEquals("\"T\"", b["title"].toString())
    }

    @Test fun inviteEmailFailsOnlyOnExplicitFalse() {
        fun o(s: String) = NexusJson.decodeFromString(kotlinx.serialization.json.JsonObject.serializer(), s)
        assertTrue(InviteResult.emailFailed(o("""{"emailSent":false}""")))
        assertFalse(InviteResult.emailFailed(o("""{"member":{"email":"a@z.id"}}""")))
        assertEquals("a@z.id", InviteResult.email(o("""{"member":{"email":"a@z.id"}}"""), " typed@z.id "))
        assertEquals("typed@z.id", InviteResult.email(o("{}"), " typed@z.id "))
    }

    @Test fun installsSplitByPlatformAndOldRowsAreIos() {
        val x = NexusJson.decodeFromString(AppInstalls.serializer(), """{"installs":[{"id":"d","platform":"android","appVersion":"0.1.6","user":{"name":"A"}}],
            "notInstalled":[],"totals":{"people":1,"devices":1,"members":2,"notInstalled":1,"versions":[{"version":"0.1.6","count":1}],
            "platforms":{"ios":0,"android":1},"versionsByPlatform":{"android":[{"version":"0.1.6","count":1}]}}}""")
        assertEquals(1, x.totals.platforms["android"]); assertEquals("0.1.6", x.totals.versionsByPlatform["android"]!!.single().version)
        assertEquals("Android", AppInstallsLogic.platformName(x.installs.single().platform)); assertEquals("iOS", AppInstallsLogic.platformName(null))
    }

    @Test fun notUsingTheAppSaysWebOnlyOrNever() {
        assertEquals(null, AppInstallsLogic.activity(null))
        assertEquals(true, AppInstallsLogic.activity("2026-09-24T02:00:00Z")!!.startsWith("24"))
    }

    // 29 Sep (server, iOS 7920142): every device per person, newest first; older servers fall back to the row.
    @Test fun installsListEveryDevice() {
        val x = id.znetworks.nexus.core.net.NexusJson.decodeFromString(AppInstalls.serializer(), """{"installs":[
          {"id":"i1","platform":"ios","appVersion":"0.1.5","buildNumber":"12","user":{"name":"Ana"},
           "devices":[{"id":"d2","platform":"android","appVersion":"0.1.6","buildNumber":"8","osVersion":"Android 14"},
                      {"id":"d1","platform":"ios","appVersion":null,"osVersion":"iOS 18.6"}]},
          {"id":"i2","platform":"android","appVersion":"0.1.6","buildNumber":"7","osVersion":"Android 13"}]}""")
        val ana = AppInstallsLogic.devices(x.installs[0])
        org.junit.Assert.assertEquals(listOf("android", "ios"), ana.map { it.platform })
        org.junit.Assert.assertEquals("0.1.6 (8)", AppInstallsLogic.versionLabel(ana[0]))
        org.junit.Assert.assertNull(AppInstallsLogic.versionLabel(ana[1]))
        val old = AppInstallsLogic.devices(x.installs[1]).single()
        org.junit.Assert.assertEquals("Android 13", old.osVersion); org.junit.Assert.assertEquals("0.1.6 (7)", AppInstallsLogic.versionLabel(old))
    }
}
