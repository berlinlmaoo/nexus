package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.ui.components.WholeWordAutoSizeLayout
import org.junit.Assert.*
import org.junit.Test

class FolderNameLayoutTest {
    private val names = listOf("[TEST] ZZ QA2 Regional Planning and Delivery", "[TEST] ZZ QA2 Perencanaan dan Pelaksanaan Wilayah")
    private val leading = 70 // caret24 + gap6 + icon30 + gap10
    private val controls = 178 // closed count24 + gap10 + unchanged3x48dp targets
    private fun measure(scale: Float): (String, Float) -> Float = { text, size -> text.length * size * .5f * scale }

    @Test fun normalFortyFourAndFortyNineCharacterNamesGetFullPhoneRowsBeforeEllipsis() {
        assertEquals(listOf(44, 49), names.map(String::length))
        for (width in listOf(272, 312, 363)) for (scale in listOf(1f, 1.3f)) for (name in names) {
            val space = FolderNameLayout.space(name, width, leading, controls, 16f, measure(scale))
            assertTrue("$width/$scale", space.stacked)
            assertEquals(width - leading, space.nameWidth)
            val result = WholeWordAutoSizeLayout.prepare(name, space.nameWidth.toFloat(), 16f, measure(scale))
            assertTrue("$name at $width/$scale", result.fits)
            assertEquals(name, result.text.replace('\n', ' '))
            assertTrue(result.text.split('\n').size <= 2)
        }
    }

    @Test fun shortNamesAndFullTabletNamesKeepTheirInlineControls() {
        assertFalse(FolderNameLayout.space("Finance", 363, leading, controls, 16f, measure(1.3f)).stacked)
        for (name in names) for (scale in listOf(1f, 1.3f)) {
            val space = FolderNameLayout.space(name, 720, leading, controls, 16f, measure(scale))
            assertFalse(space.stacked)
            assertEquals(720 - leading - controls, space.nameWidth)
        }
    }

    @Test fun deepestFolderOnTheQaPhoneStillGivesTheFullNamesAndControlsSeparateSpace() {
        // Four levels currently contribute0+12+24+36dp indentation on the411dp phone.
        for (name in names) {
            val width = 363 - 72
            val space = FolderNameLayout.space(name, width, leading, controls, 16f, measure(1.3f))
            assertTrue(space.stacked)
            assertTrue(WholeWordAutoSizeLayout.prepare(name, space.nameWidth.toFloat(), 16f, measure(1.3f)).fits)
            val position = FolderNameLayout.positions(width, leading, 30, 48, controls, 48, true, 4)
            assertEquals(width - controls, position.controlsX)
            assertTrue(position.controlsX >= 0)
            assertEquals(52, position.controlsY)
            assertEquals(100, position.height)
        }
    }

    @Test fun geometryKeepsAllFortyEightDpTargetsUnscaledAndOutsideTheNameRows() {
        val stacked = FolderNameLayout.positions(363, leading, 30, 48, controls, 48, true, 4)
        assertEquals(48, stacked.topHeight)
        assertEquals(52, stacked.controlsY)
        assertEquals(48, stacked.height - stacked.controlsY)
        assertEquals(363, stacked.controlsX + controls)
        val inline = FolderNameLayout.positions(720, leading, 30, 24, controls, 48, false, 4)
        assertEquals(48, inline.height)
        assertEquals(0, inline.controlsY)
        assertEquals(720, inline.controlsX + controls)
    }
}
