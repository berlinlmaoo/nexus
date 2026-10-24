package id.znetworks.nexus.ui.components

import androidx.compose.ui.text.style.TextOverflow
import org.junit.Assert.*
import org.junit.Test

class WholeWordAutoSizeTextTest {
    private fun measure(scale: Float): (String, Float) -> Float = { value, size -> value.length * size * .6f * scale }
    private fun prepare(value: String, width: Float, size: Float = 15f, scale: Float = 1f) =
        WholeWordAutoSizeLayout.prepare(value, width, size, measure(scale))

    private fun assertWholeWords(value: String, result: WholeWordAutoSizeLayout.Prepared) {
        assertTrue(result.text.split('\n').size <= 2)
        assertEquals(value.trim().split(Regex("\\s+")).joinToString(" "), result.text.replace('\n', ' '))
        assertTrue(result.text.split(Regex("\\s+")).all { it in value.trim().split(Regex("\\s+")) })
    }

    @Test fun leaderboardNamesUseTwoCompleteWordLinesAtPhoneAndTabletBudgets() {
        // The existing avatar/rank/score chrome leaves about100dp on a narrow phone and more on tablet.
        for (width in listOf(100f, 160f, 260f)) for (scale in listOf(1f, 1.3f)) {
            for (name in listOf("Bagas Putro", "Alexander Montgomery", "Dewi Lestari")) {
                val result = prepare(name, width, scale = scale)
                assertTrue("$name at $width / $scale", result.fits)
                assertWholeWords(name, result)
                assertTrue(result.text.split('\n').all { measure(scale)(it, result.fontSize) <= width })
            }
        }
    }

    @Test fun fontScalingShrinksBeforeNamesNeedAnEllipsis() {
        val name = "Alexander Montgomery"
        val ordinary = prepare(name, 100f)
        val scaled = prepare(name, 100f, scale = 1.3f)
        assertTrue(ordinary.fits)
        assertTrue(scaled.fits)
        assertTrue(scaled.fontSize < ordinary.fontSize)
        assertTrue(scaled.fontSize >= 15f * .75f)
        assertWholeWords(name, scaled)
    }

    @Test fun podiumTiesKeepTheirCommaAndUseTwoLinesBeforeLastResortEllipsis() {
        // Three weighted steps,20dp inner padding and16dp gaps; names reserve minLines2 in the UI.
        val phoneWidth = (360f - 32f - 20f - 16f) / 3f
        val shortTie = "Budi, Ani Putri"
        assertTrue(prepare(shortTie, phoneWidth, 13f, 1.3f).fits)
        val longTie = "Alexander Montgomery, Christopher Wellington"
        val phone = prepare(longTie, phoneWidth, 13f, 1.3f)
        assertFalse(phone.fits)
        assertEquals(13f * .75f, phone.fontSize, 0f)
        assertWholeWords(longTie, phone)
        val tablet = prepare(longTie, 240f, 13f, 1.3f)
        assertTrue(tablet.fits)
        assertWholeWords(longTie, tablet)
    }

    @Test fun englishAndIndonesianFolderNamesWrapBetweenWordsWhenRoomRemains() {
        for (name in listOf("Regional Sales Planning", "Perencanaan Penjualan Wilayah", "Legal Documents")) {
            val result = prepare(name, 220f, 16f, 1.3f)
            assertTrue(name, result.fits)
            assertWholeWords(name, result)
        }
    }

    @Test fun deepFolderChromeLeavesABoundedWholeWordFallbackWithoutShrinkingItsControls() {
        val name = "Pengembangan Penjualan Regional"
        // Existing Calendar/Menu/Drag targets retain48dp each; indentation/count can leave very little width.
        for (remaining in listOf(0f, 24f, 50f)) {
            val result = prepare(name, remaining, 16f, 1.3f)
            assertFalse(result.fits)
            assertEquals(12f, result.fontSize, 0f)
            assertWholeWords(name, result)
            assertEquals(2, result.text.split('\n').size)
        }
    }

    @Test fun oversizedSingleWordsAndUnicodeNamesNeverBecomeBrokenWordFragments() {
        for (name in listOf("Supercalifragilisticexpialidocious", "Bagas😀Putro")) {
            val result = prepare(name, 20f, 15f, 1.3f)
            assertFalse(result.fits)
            assertEquals(15f * .75f, result.fontSize, 0f)
            assertEquals(name, result.text)
            assertWholeWords(name, result)
        }
    }

    @Test fun existingNormalSizesAndWhitespacePreparationStayStable() {
        for (size in listOf(13f, 15f, 16f)) assertEquals(size, prepare("Budi", 200f, size).fontSize, 0f)
        assertEquals("", prepare("  ", 0f).text)
        val value = "  Bagas\nPutro\tPrasetyo  "
        assertWholeWords(value, prepare(value, 120f))
    }

    @Test fun realComposeRendererRetainsTwoLinesForFittedAndOversizedNamePlans() {
        val companion = TextOverflow.Companion
        val ellipsis = companion.javaClass.declaredMethods.single {
            // Kotlin also emits a zero-argument, void-returning $annotations method with this prefix.
            it.name.startsWith("getEllipsis-") && it.parameterCount == 0 && it.returnType == Integer.TYPE
        }.invoke(companion) as Int
        val finalMaxLines = Class.forName("androidx.compose.foundation.text.modifiers.LayoutUtilsKt").declaredMethods.single {
            it.name.startsWith("finalMaxLines-") && it.returnType == Integer.TYPE &&
                it.parameterTypes.contentEquals(arrayOf(java.lang.Boolean.TYPE, Integer.TYPE, Integer.TYPE))
        }
        fun effective(slot: WholeWordAutoSizeLayout.Slot) = finalMaxLines.invoke(null, slot.softWrap, ellipsis, slot.maxLines) as Int

        // Exercise the real dependency, whose softWrap=false/Ellipsis behavior caused the original bug.
        assertEquals(1, effective(WholeWordAutoSizeLayout.Slot("first\nsecond", false, 2, 2)))
        val fitted = prepare("Alexander Montgomery", 100f)
        assertTrue(fitted.fits)
        assertEquals(2, fitted.text.split('\n').size)
        assertEquals(2, fitted.slots(2).sumOf(::effective))
        assertEquals(2, fitted.slots(2).sumOf { it.minLines })

        val extreme = prepare("Supercalifragilisticexpialidocious Wellington", 30f, 13f, 1.3f)
        assertFalse(extreme.fits)
        val slots = extreme.slots(2)
        assertEquals(2, slots.size)
        assertEquals(2, slots.sumOf(::effective))
        assertTrue(slots.all { !it.softWrap && it.maxLines == 1 })
        assertEquals(2, prepare("Supercalifragilisticexpialidocious", 20f).slots(2).sumOf { it.minLines })
    }

    @Test fun autoSizeGridIncludesExactNormalMinimumAndEveryPreparedSize() {
        for (normal in listOf(13f, 15f, 16f)) for (width in listOf(40f, 80f, 100f, 220f)) {
            val result = prepare("Alexander Montgomery", width, normal, 1.3f)
            assertEquals(normal * .75f, result.minFontSize, 0f)
            // StepBased anchors candidates at its minimum; quarter-sp includes both integer normals
            // and the fitter's half/quarter-sp endpoints instead of silently reducing13sp to12.75sp.
            val normalSteps = (normal - result.minFontSize) / result.stepSize
            val fittedSteps = (result.fontSize - result.minFontSize) / result.stepSize
            assertEquals(normalSteps.toInt().toFloat(), normalSteps, 0f)
            assertEquals(fittedSteps.toInt().toFloat(), fittedSteps, 0f)
            assertTrue(result.fontSize >= result.minFontSize && result.fontSize <= normal)
        }
    }
}
