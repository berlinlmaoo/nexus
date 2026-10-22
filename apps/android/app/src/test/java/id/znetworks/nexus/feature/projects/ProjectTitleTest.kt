package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProjectTitleTest {
    // A deterministic font: measurement increases with both the word length and the requested font size.
    private val measure: (String, Float) -> Float = { text, size -> text.length * size }

    @Test fun shortNamesKeepTheNormalSize() {
        val title = ProjectTitleLayout.fit("Campaign", 200f, measure)
        assertEquals(listOf("Campaign"), title.lines)
        assertEquals(19f, title.fontSize, 0f)
        assertTrue(title.fits)
    }

    @Test fun fullNameShrinksToFitTwoWholeWordLines() {
        val title = ProjectTitleLayout.fit("Social Media Report", 185f, measure)
        assertEquals(listOf("Social Media", "Report"), title.lines)
        assertEquals(15f, title.fontSize, 0f)
        assertTrue(title.fits)
        assertTrue(title.lines.all { measure(it, title.fontSize) <= 185f })
        assertEquals("Social Media Report", title.lines.joinToString(" "))
    }

    @Test fun englishAndIndonesianNamesWrapOnlyBetweenWords() {
        listOf("Quarterly Outlet Sales Dashboard", "Laporan Penjualan Outlet Tahunan", "Semua Pipeline", "Legal Documents Archive").forEach { name ->
            val title = ProjectTitleLayout.fit(name, 300f, measure)
            assertTrue(name, title.fits)
            assertTrue(name, title.lines.size <= 2)
            assertEquals(name, title.lines.joinToString(" "))
            assertTrue(name, title.lines.all { measure(it, title.fontSize) <= 300f })
        }
    }

    @Test fun extremePhraseLeavesOnlyTheSecondLineForEllipsis() {
        val name = "One two three four five six seven eight nine ten eleven twelve"
        val title = ProjectTitleLayout.fit(name, 150f, measure)
        assertFalse(title.fits)
        assertEquals(14f, title.fontSize, 0f)
        assertEquals(2, title.lines.size)
        assertTrue(measure(title.lines.first(), title.fontSize) <= 150f)
        assertEquals(name, title.lines.joinToString(" "))
    }

    @Test fun oversizedSingleWordsNeverBecomeTwoWordFragments() {
        val name = "Supercalifragilisticexpialidocious"
        val title = ProjectTitleLayout.fit(name, 80f, measure)
        assertFalse(title.fits)
        assertEquals(listOf(name), title.lines)
        assertEquals(14f, title.fontSize, 0f)
    }

    @Test fun fontScaleCanReduceAvailableCapacityWithoutBreakingWords() {
        val name = "Pipeline Dashboard"
        val ordinary = ProjectTitleLayout.fit(name, 220f, measure)
        val scaled = ProjectTitleLayout.fit(name, 220f) { text, size -> measure(text, size) * 1.5f }
        assertTrue(ordinary.fits)
        assertTrue(scaled.fits)
        assertTrue(scaled.fontSize < ordinary.fontSize)
        assertEquals(name, scaled.lines.joinToString(" "))
    }

    @Test fun whitespaceAndZeroWidthHaveBoundedResults() {
        assertEquals(listOf(""), ProjectTitleLayout.fit("   ", 0f, measure).lines)
        val title = ProjectTitleLayout.fit("  Outlet\nSales\tBoard  ", 0f, measure)
        assertFalse(title.fits)
        assertEquals(listOf("Outlet", "Sales Board"), title.lines)
    }
}
