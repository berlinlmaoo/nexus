package id.znetworks.nexus.core.config

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.admin.ControlRoomTabs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class RemoteConfigTest {
    // The live answer of 28 Sep 2026, plus a key the app does not know.
    private val live = NexusJson.decodeFromString(ConfigBody.serializer(), """{"flags":{"requireAlwaysLocation":true,"blockSignOutDuringWorkday":true,"fakeGpsReview":true,"newThing":1},
        "values":{"outsideHourAlertMinutes":60},"texts":{"en":{"signout.blocked.title":"Check out first"},"id":{"signout.blocked.title":"Check out dulu"}},
        "banner":null,"updatedAt":null}""")

    @Test fun defaultsEqualTheServersWhenNothingWasHeard() {
        val none = ConfigBody()
        assertTrue(none.requireAlwaysLocation); assertTrue(none.blockSignOutDuringWorkday); assertTrue(none.fakeGpsReview)
        assertEquals(60, none.outsideHourAlertMinutes)
        assertNull(none.text("signout.blocked.title", "id"))
    }

    @Test fun flagsValuesAndTextsPerLanguage() {
        assertTrue(live.blockSignOutDuringWorkday)
        assertEquals("Check out dulu", live.text("signout.blocked.title", "id"))
        assertEquals("Check out first", live.text("signout.blocked.title", "en"))
        assertNull(live.text("missing.key", "id"))
        // A language the server has nothing for falls back to its English; a key it lacks to the app's copy.
        assertEquals("Check out first", ConfigBody(texts = mapOf("en" to mapOf("k" to "Check out first"))).text("k", "id"))
        assertEquals("id", ConfigBody.lang(Locale.forLanguageTag("in"))); assertEquals("id", ConfigBody.lang(Locale.forLanguageTag("id")))
        assertEquals("en", ConfigBody.lang(Locale.ENGLISH))
        assertEquals(60, ConfigBody(values = ConfigValues(outsideHourAlertMinutes = 0)).outsideHourAlertMinutes) // nonsense ignored
        assertEquals(45, ConfigBody(values = ConfigValues(outsideHourAlertMinutes = 45)).outsideHourAlertMinutes)
    }

    @Test fun fakeGpsTabFollowsTheFlag() {
        assertTrue("suspects" in ControlRoomTabs.forRole(isBoD = true, fakeGps = true))
        assertFalse("suspects" in ControlRoomTabs.forRole(isBoD = true, fakeGps = false))
    }
}
