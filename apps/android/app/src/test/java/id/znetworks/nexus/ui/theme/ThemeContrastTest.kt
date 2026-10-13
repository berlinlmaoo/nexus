package id.znetworks.nexus.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The tokens the M3 roles are built from (audit 2 #2, #8): text-bearing roles reach WCAG AA (4.5:1),
 * important boundaries 3:1, in both themes. A palette change that breaks this fails here.
 */
class ThemeContrastTest {
    private fun ratio(a: Color, b: Color): Double {
        val (hi, lo) = listOf(a.luminance(), b.luminance()).sortedDescending()
        return (hi + 0.05) / (lo + 0.05)
    }
    private fun atLeast(min: Double, a: Color, b: Color, what: String) = assertTrue("$what = ${"%.2f".format(ratio(a, b))}", ratio(a, b) >= min)

    @Test fun lightRoles() = check(NxLight, onPrimary = Color.White)
    @Test fun darkRoles() = check(NxDark, onPrimary = NxDark.background)

    private fun check(c: NxColors, onPrimary: Color) {
        // primary as text (TextButton) on the background and the card; its on-colour on it (filled Button).
        atLeast(4.5, c.violetText, c.background, "primary text on background")
        atLeast(4.5, c.violetText, c.card, "primary text on card")
        atLeast(4.5, onPrimary, c.violetText, "onPrimary on primary")
        // error role (badge) and danger text.
        atLeast(4.5, c.onDanger, c.dangerText, "onError on error")
        atLeast(4.5, c.dangerText, c.card, "danger text on card")
        // outline: switch handles, text-field and segmented borders.
        atLeast(3.0, c.boundary, c.background, "outline on background")
        atLeast(3.0, c.boundary, c.card, "outline on card")
        atLeast(3.0, c.boundary, c.muted, "outline on the switch track")
        // navy (today, selection) and its ink; text in the selected segment.
        atLeast(3.0, c.navy, c.card, "navy on card")
        atLeast(4.5, c.onNavy, c.navy, "onNavy on navy")
        atLeast(4.5, c.foreground, c.segmentActive, "label on the selected segment")
    }
}
