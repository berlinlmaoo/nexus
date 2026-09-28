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
}
