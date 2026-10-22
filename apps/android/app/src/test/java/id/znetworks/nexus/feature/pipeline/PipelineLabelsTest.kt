package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.ui.components.WordBoundaryLayout
import org.junit.Assert.*
import org.junit.Test

class PipelineLabelsTest {
    private val measure: (String) -> Float = { it.length * 6f }
    private val labels = listOf("Open pipeline", "Weighted forecast", "Won", "Receivable", "Real profit", "Critical", "Ready to start", "Deliverables on track")

    @Test fun tabletKeepsAllEightTilesWhenFullLabelsFitTwoLines() {
        assertEquals(8, WordBoundaryLayout.kpiColumns(labels, 1200f, 20f, measure))
        labels.forEach { assertTrue(it, WordBoundaryLayout.fits(it, 130f, 2, measure)) }
        assertEquals(listOf("Deliverables on", "track"), WordBoundaryLayout.wrap("Deliverables on track", 90f, measure))
    }

    @Test fun narrowOrFontScaledTabletsGiveLabelsRoomInsteadOfEllipsis() {
        assertEquals(4, WordBoundaryLayout.kpiColumns(labels, 576f, 20f, measure))
        val scaled: (String) -> Float = { measure(it) * 1.5f }
        assertEquals(4, WordBoundaryLayout.kpiColumns(labels, 1000f, 20f, scaled))
        val width = 1000f / 4 - 20f
        labels.forEach { assertTrue(it, WordBoundaryLayout.fits(it, width, 2, scaled)) }
    }

    @Test fun fractionalPixelBudgetUsesRoundedPaddingSidesAndSmallestWeightedTile() {
        // At density1.25 the two 10dp sides occupy13+13px, and970/8px gives some121px tiles.
        assertEquals(4, WordBoundaryLayout.kpiColumns(List(8) { "label" }, 970f, 26f) { 96f })
        assertEquals(4, WordBoundaryLayout.kpiColumns(List(8) { "label" }, 970f, 26f) { 95.2f })
    }

    @Test fun englishIndonesianStatusAndKpiWordsRemainWholeAndComplete() {
        (labels + listOf("Pipeline terbuka", "Weighted pipeline", "Deliverable sesuai rencana", "Belum dikerjakan", "Sedang dikerjakan", "Selesai")).forEach { value ->
            val lines = WordBoundaryLayout.wrap(value, 95f, measure)
            assertEquals(value, lines.joinToString(" "))
            assertTrue(value, lines.flatMap { it.split(' ') }.all { it in value.split(' ') })
        }
        // The three 48 dp controls in a narrow lane leave too little space for the full ID chip.
        assertFalse(WordBoundaryLayout.fits("Belum dikerjakan", 284f - 16f - 8f - 144f - 29f - 20f - 8f, 2, measure))
        assertTrue(WordBoundaryLayout.fits("Belum dikerjakan", 284f - 16f - 8f - 29f - 20f - 8f, 2, measure))
    }
}
