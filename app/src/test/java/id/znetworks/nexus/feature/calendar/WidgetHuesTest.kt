package id.znetworks.nexus.feature.calendar

import androidx.compose.ui.graphics.Color
import id.znetworks.nexus.feature.calendar.widget.WidgetHues
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Audit 2 #10: on a dark widget every task colour stands out (≥ 3:1), and Bagan colours use their own colorDark. */
class WidgetHuesTest {
    private fun res(name: String) = javaClass.classLoader!!.getResource("calendar/$name")!!.readText()
    private val structure = id.znetworks.nexus.core.net.NexusJson.decodeFromString(CalStructure.serializer(), res("structure.json"))
    private val map = WidgetHues.darkMap(structure.units.map { it.color to it.colorDark })

    @Test fun bagenColoursUseTheirDarkVariant() {
        val u = structure.units.first { it.color != null && it.colorDark != null }
        assertEquals(WidgetHues.parse(u.colorDark), WidgetHues.night(u.color, map))
        assertEquals(WidgetHues.parse(u.colorDark), WidgetHues.night(u.color!!.uppercase(), map))
    }

    @Test fun everyColourStandsOutAtNight() {
        val all = structure.units.mapNotNull { it.color } + listOf("#0f2742", "#5B4BD6", "#8D5B3B", "#B03A86", "#10B981", "#000000", "nonsense")
        all.forEach { hex ->
            // Without the map too: project colours have no colorDark.
            listOf(map, emptyMap()).forEach { m ->
                val n = WidgetHues.night(hex, m)
                if (m.isEmpty() || hex.lowercase() !in m) assertTrue("$hex → $n", WidgetHues.contrast(n, WidgetHues.DARK_SURFACE) >= 3.0)
            }
        }
        // Light colours keep their own day colour.
        assertEquals(Color(0xFF10B981), WidgetHues.day("#10B981"))
    }
}
