package id.znetworks.nexus.feature.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Settings (HANDOFF scope 6): phone number rules, session device labels (web lib/device-label.ts), EN/ID strings. */
class SettingsLogicTest {
    @Test fun phoneDisplayMatchesWebGroupingAndPreservesOtherCountries() {
        assertEquals("+62 812-0000-0000", PhoneRules.display("+6281200000000"))
        assertEquals("+62 812-3456-7890", PhoneRules.display("081234567890"))
        assertEquals("+65 9123 4567", PhoneRules.display("+65 9123 4567"))
        assertEquals("call office", PhoneRules.display("call office"))
        assertEquals("", PhoneRules.display(null))
    }
    private fun ok(raw: String) = (PhoneRules.check(raw) as PhoneRules.Result.Ok).value

    @Test fun phoneNumbers() {
        assertEquals(null, ok("   ")) // blank clears it
        assertEquals("0812-3456-7890", ok(" 0812-3456-7890 "))
        assertEquals("+65 9123 4567", ok("+65 9123 4567"))
        assertEquals("6281234567890", ok("6281234567890"))
        // Never stricter than the server: anything typed goes up as typed (web).
        assertEquals("12345", ok("12345"))
    }

    @Test fun deviceLabels() {
        assertEquals(DeviceLabel.App("android", "0.1.6", "13", DeviceLabel.Kind.PHONE), DeviceLabel.describe("NEXUS-Android/0.1.6", "android/0.1.6/13"))
        assertEquals(DeviceLabel.App("ios", "0.1.6", "12", DeviceLabel.Kind.TABLET), DeviceLabel.describe("NEXUS (iPad; iOS 18)", "ios/0.1.6/12"))
        assertEquals(DeviceLabel.App("ios", null, "9", DeviceLabel.Kind.PHONE), DeviceLabel.describe("NEXUS/9 CFNetwork/1490 Darwin/23", null))
        assertEquals(DeviceLabel.App("android", null, null, DeviceLabel.Kind.PHONE), DeviceLabel.describe("okhttp/5.1.0", null))
        val chromeWin = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
        assertEquals(DeviceLabel.Browser("Chrome", "Windows", DeviceLabel.Kind.DESKTOP), DeviceLabel.describe(chromeWin, "web/1"))
        val safariIphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
        assertEquals(DeviceLabel.Browser("Safari", "iOS", DeviceLabel.Kind.PHONE), DeviceLabel.describe(safariIphone, null))
        val tab = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
        assertEquals(DeviceLabel.Kind.TABLET, DeviceLabel.describe(tab, null).kind)
        assertEquals(DeviceLabel.Unknown, DeviceLabel.describe(null, null))
        assertEquals(DeviceLabel.Unknown, DeviceLabel.describe("curl/8.0", null))
    }

    @Test fun activeNow() {
        assertTrue(SessionTime.activeNow(1_000_000, 1_000_000 + 4 * 60_000))
        assertTrue(!SessionTime.activeNow(1_000_000, 1_000_000 + 6 * 60_000))
    }

    @Test fun settingsStringsHaveIndonesian() {
        val names = { v: String -> Regex("<string name=\"([^\"]+)\"").findAll(File("src/main/res/$v/strings_settings.xml").readText()).map { it.groupValues[1] }.toSet() }
        val en = names("values"); val id = names("values-in")
        assertTrue(en.size > 40)
        assertEquals(emptySet<String>(), en - id); assertEquals(emptySet<String>(), id - en)
    }
}
