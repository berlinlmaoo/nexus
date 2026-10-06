package id.znetworks.nexus.feature.calendar.widget

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance

/**
 * Division and project colours on a dark widget (Calendar audit 2 #10). /api/calendar/glance sends one
 * light-mode hex per task (`c`); at night the widget uses the Bagan's own `colorDark` for that colour when
 * it is a unit colour (from the Calendar's cached structure), and otherwise lightens it until it reaches
 * 3:1 on a dark surface. No owner data changes: this only picks how a colour is drawn. Pure, so it is tested.
 */
object WidgetHues {
    /** The darkest widget surface the night colours must stand on (NxDark.card, near the dynamic dark ones). */
    val DARK_SURFACE = Color(0xFF1C2130)
    private val NEUTRAL = Color(0xFF64748B)

    fun parse(hex: String?): Color? {
        val h = hex?.trim()?.removePrefix("#") ?: return null
        val v = h.toLongOrNull(16) ?: return null
        return when (h.length) { 6 -> Color(0xFF000000 or v); 8 -> Color(v); else -> null }
    }

    fun contrast(a: Color, b: Color): Double {
        val (hi, lo) = listOf(a.luminance(), b.luminance()).sortedDescending()
        return (hi + 0.05) / (lo + 0.05)
    }

    /** Light-mode hex → its colorDark, from the units of the cached structure (keys lower-cased). */
    fun darkMap(units: List<Pair<String?, String?>>): Map<String, String> =
        units.mapNotNull { (light, dark) -> if (light != null && dark != null) light.lowercase() to dark else null }.toMap()

    fun day(hex: String?): Color = parse(hex) ?: NEUTRAL

    fun night(hex: String?, darkOf: Map<String, String>): Color {
        darkOf[hex?.lowercase()]?.let { parse(it) }?.let { return it }
        val base = day(hex)
        if (contrast(base, DARK_SURFACE) >= 3.0) return base
        // Lighten towards white in small steps until it stands out on the dark surface.
        var t = 0.1f
        while (t < 1f) {
            val c = lerp(base, Color.White, t)
            if (contrast(c, DARK_SURFACE) >= 3.0) return c
            t += 0.1f
        }
        return Color.White
    }
}
