package id.znetworks.nexus.feature.sheets

import org.junit.Assert.*
import org.junit.Test

class SheetZoomMathTest {
    @Test fun defaultsAndBounds() {
        assertEquals(.8f, SheetZoomMath.default(true))
        assertEquals(1f, SheetZoomMath.default(false))
        assertEquals(.5f, SheetZoomMath.clamp(.1f))
        assertEquals(2f, SheetZoomMath.clamp(5f))
        assertEquals(.8f, SheetZoomMath.clamp(Float.NaN, .8f))
    }
    @Test fun pinchPreservesTheLogicalPointWithFrozenHeadersAndPan() {
        val logical = SheetZoomMath.logical(360f, 240f, 80f, .8f)
        for (scale in listOf(.5f, 1f, 2f)) {
            val scroll = SheetZoomMath.scroll(logical, 270f, 80f, scale)
            assertEquals(logical, SheetZoomMath.logical(scroll, 270f, 80f, scale), .001f)
        }
    }
    @Test fun variableHeightRowsLocateTheSamePositionAfterZoom() {
        val heights = listOf(34f, 60f, 34f, 80f)
        assertEquals(1 to 16f, SheetZoomMath.row(heights, 50f))
        assertEquals(2 to 0f, SheetZoomMath.row(heights, 94f))
        assertEquals(0 to 0f, SheetZoomMath.row(heights, -10f))
        assertEquals(3 to 80f, SheetZoomMath.row(heights, 1000f))
        assertEquals(0 to 0f, SheetZoomMath.row(emptyList(), 100f))
    }
}
