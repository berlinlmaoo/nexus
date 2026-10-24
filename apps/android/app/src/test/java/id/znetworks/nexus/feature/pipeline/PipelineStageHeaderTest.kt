package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.feature.projects.ProjectTitleLayout
import org.junit.Assert.*
import org.junit.Test

class PipelineStageHeaderTest {
    private val normal = 13f
    private val minimum = normal * .75f
    private val english = PipelineVocab.STAGES
    private val indonesian = english.map { when (it) {
        "Negotiation" -> "Negosiasi"
        "Won – Contract Pending" -> "Won — Kontrak Pending"
        "Won – In Execution" -> "Won — Eksekusi"
        else -> it
    } }
    private fun measure(scale: Float): (String, Float) -> Float = { value, size -> value.length * size * .6f * scale }
    private fun fit(label: String, width: Float, scale: Float = 1f) =
        ProjectTitleLayout.fit(label, width, minimum, measure(scale), normalFontSize = normal)

    @Test fun phoneAndTabletStageBudgetsKeepEveryEnglishAndIndonesianNameComplete() {
        // Phone content: 320/360/412dp minus 24dp padding. Tablet's 280dp column has 8dp per side.
        for (header in listOf(296f, 336f, 388f, 264f)) for (scale in listOf(1f, 1.3f)) {
            // Dot+gap, count gap, a six-digit count at this font scale, and the unchanged 48dp Add target.
            val labelWidth = header - 14f - 6f - measure(scale)("999999", 12f) - 48f
            for (label in english + indonesian) {
                val result = fit(label, labelWidth, scale)
                assertTrue("$label at $header / $scale", result.fits)
                assertTrue(result.lines.size <= 2)
                assertEquals(label, result.lines.joinToString(" "))
                assertTrue(result.lines.all { measure(scale)(it, result.fontSize) <= labelWidth })
            }
        }
    }

    @Test fun stageFontStartsAtThirteenAndUsesItsExactSeventyFivePercentFloor() {
        assertEquals(normal, fit("Incoming", 200f).fontSize, 0f)
        val label = "Quotation"
        val exact = fit(label, measure(1f)(label, minimum))
        assertTrue(exact.fits)
        assertEquals(minimum, exact.fontSize, 0f)
        val smaller = fit(label, measure(1f)(label, minimum) - 1f)
        assertFalse(smaller.fits)
        assertEquals(minimum, smaller.fontSize, 0f)
        assertEquals(listOf(label), smaller.lines)
    }

    @Test fun longTotalsNeedTheirOwnRowToLeaveTheCompleteTabletStageNameReadable() {
        val scale = 1.3f
        val headerWidth = 264f
        val labelWidth = headerWidth - 14f - 6f - measure(scale)("999999", 12f) - 48f
        for (id in listOf(false, true)) {
            val total = PipelineFormat.idr(9_999_000_000_000.0, id)
            val oldSingleRowWidth = labelWidth - measure(scale)(" · $total", 12f)
            val label = if (id) "Won — Kontrak Pending" else "Won – Contract Pending"
            assertFalse(fit(label, oldSingleRowWidth, scale).fits)
            val result = fit(label, labelWidth, scale)
            assertTrue(result.fits)
            assertEquals(label, result.lines.joinToString(" "))
            assertTrue(measure(scale)(total, 12f) <= headerWidth - 14f)
        }
    }

    @Test fun fontScalingCanShrinkBeforeEllipsisWithoutSplittingWords() {
        val ordinary = fit("Won – Contract Pending", 130f)
        val scaled = fit("Won – Contract Pending", 130f, 1.3f)
        assertTrue(ordinary.fits)
        assertTrue(scaled.fits)
        assertTrue(scaled.fontSize < ordinary.fontSize)
        assertEquals("Won – Contract Pending", scaled.lines.joinToString(" "))
        assertTrue(scaled.lines.size <= 2)
    }

    @Test fun anExtremeCustomStageOnlyEllipsizesAfterTryingTheMinimumAndTwoWordLines() {
        val label = "A very long custom pipeline stage with many more words than the standard stages"
        val result = fit(label, 100f, 1.3f)
        assertFalse(result.fits)
        assertEquals(minimum, result.fontSize, 0f)
        assertEquals(2, result.lines.size)
        assertEquals(label, result.lines.joinToString(" "))
        assertTrue(result.lines.flatMap { it.split(' ') }.all { it in label.split(' ') })
    }

    @Test fun reuseLeavesExistingProjectTitleDefaultsUnchanged() {
        val result = ProjectTitleLayout.fit("Campaign", 200f, measure(1f))
        assertTrue(result.fits)
        assertEquals(19f, result.fontSize, 0f)
    }
}
