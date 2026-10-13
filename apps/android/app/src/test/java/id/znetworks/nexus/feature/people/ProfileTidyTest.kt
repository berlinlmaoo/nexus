package id.znetworks.nexus.feature.people

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** PROFILE-TIDY (Berlin, 9 Oct): guards on the member profile and the photo viewer. */
class ProfileTidyTest {
    private val screen = File("src/main/java/id/znetworks/nexus/feature/people/PeopleScreens.kt").readText()
    private val viewer = File("src/main/java/id/znetworks/nexus/ui/components/PhotoViewer.kt").readText()

    @Test fun messageIsACompactTonalButton() {
        // No longer a full-width outlined button; hidden for yourself and for someone who left.
        assertFalse(screen.contains("{ Text(stringResource(R.string.pf_message)) }"))
        assertTrue(screen.contains("if (!isMe && r?.person?.leftAt == null)"))
        assertTrue(screen.contains("minimumInteractiveComponentSize()")); assertTrue(screen.contains("color = c.accentBg"))
    }

    @Test fun avatarOpensOnlyALoadedPhoto() {
        assertTrue(screen.contains("ZoomableAvatar(r?.person?.avatar ?: boardRow?.avatar, name, 72.dp)"))
        // Initials or a failed load: the plain avatar, not clickable.
        assertTrue(viewer.contains("if (i == null) { Avatar(name, url, size); return }"))
        // Page size, not the 300 px tile.
        assertTrue(viewer.contains("RemoteImages.load(context, url, 2048)"))
        assertTrue(viewer.contains("coerceIn(1f, 6f)")); assertTrue(viewer.contains("scale = 2.5f"))
    }

    @Test fun levelCardAndPeriodCard() {
        assertTrue(screen.contains("R.string.pp_total_xp")); assertFalse(screen.contains("\"%,d XP\""))
        assertTrue(screen.contains("R.string.pp_allowance")); assertTrue(screen.contains("R.plurals.pp_late_value"))
        assertTrue(screen.contains(".chunked(3)"))
    }

    @Test fun stringsBothLanguages() {
        val en = File("src/main/res/values/strings.xml").readText(); val id = File("src/main/res/values-in/strings.xml").readText()
        listOf("pp_view_photo", "pp_allowance", "pp_late_value", "pp_score_note").forEach { k ->
            assertEquals(k, 1, Regex("name=\"$k\"").findAll(en).count()); assertEquals(k, 1, Regex("name=\"$k\"").findAll(id).count())
        }
        assertTrue(id.contains(">Jatah day off<")); assertFalse(id.contains(">Never late this period<"))
    }
}
