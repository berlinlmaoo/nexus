package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.YearMonth

class ProjectTabsTest {
    private val today = LocalDate.of(2026, 9, 28)
    private fun d(s: String) = LocalDate.parse(s)

    @Test fun timelineWindowFallsBackLikeTheWeb() {
        assertEquals(BoardLogic.Window(d("2026-10-01"), d("2026-10-05")), BoardLogic.window(BoardTask("a", startDate = "2026-10-01", dueDate = "2026-10-05"), today))
        assertEquals(BoardLogic.Window(d("2026-10-01"), d("2026-10-04")), BoardLogic.window(BoardTask("b", startDate = "2026-10-01"), today))
        assertEquals(BoardLogic.Window(d("2026-10-02"), d("2026-10-05")), BoardLogic.window(BoardTask("c", dueDate = "2026-10-05T00:00:00.000Z"), today))
        assertEquals(BoardLogic.Window(today, today.plusDays(3)), BoardLogic.window(BoardTask("d"), today))
        // Due before start: a one-day bar at the start, never a negative width.
        assertEquals(BoardLogic.Window(d("2026-10-05"), d("2026-10-05")), BoardLogic.window(BoardTask("e", startDate = "2026-10-05", dueDate = "2026-10-01"), today))
    }

    @Test fun calendarBucketsOnlyTheShownMonth() {
        val m = BoardLogic.byDay(listOf(BoardTask("a", dueDate = "2026-09-28"), BoardTask("b", dueDate = "2026-10-01"), BoardTask("c")), YearMonth.of(2026, 9))
        assertEquals(setOf(28), m.keys)
    }

    @Test fun sprintProgressAndNextStatus() {
        val s = NexusJson.decodeFromString(Sprint.serializer(), """{"id":"s","name":"W1","status":"ACTIVE","tasks":[{"task":{"id":"1","status":"DONE"}},{"task":{"id":"2","status":"TODO"}},{}]}""")
        assertEquals(1, s.done); assertEquals(0.5f, s.progress, 0.001f); assertEquals("COMPLETED", s.next)
        assertNull(s.copy(status = "COMPLETED").next)
        assertEquals("ACTIVE", s.copy(status = null).next)
    }

    @Test fun completingWithOpenCardsIsDetected() {
        val r = NexusJson.decodeFromString(SprintPatchReply.serializer(), """{"incompleteTasks":[{"id":"2","title":"x"}],"requiresAction":true}""")
        assertEquals(true, r.requiresAction); assertEquals(1, r.incompleteTasks.size)
        assertNull(NexusJson.decodeFromString(SprintPatchReply.serializer(), """{"sprint":{"id":"s"}}""").requiresAction)
    }

    @Test fun ruleTextAndRupiah() {
        assertEquals("Status changed · Priority = HIGH", Rule("STATUS_CHANGED", "priority", kotlinx.serialization.json.JsonPrimitive("HIGH")).text())
        assertEquals("Rp1.250.000", idr(1_250_000.0))
    }
}
