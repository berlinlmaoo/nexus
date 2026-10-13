package id.znetworks.nexus.feature.calendar

import androidx.lifecycle.SavedStateHandle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Audit P0: a Calendar link with `task=` opened the task again every time the Calendar came back, so
 * Back could never leave it. The link is applied once per back-stack entry (CalendarLinkGate in the
 * entry's SavedStateHandle); a new link carries a new nonce.
 *
 * Audit P1: dots and "no tasks" only for the range the items were loaded for.
 */
class CalendarLinkTest {
    /** The nav back stack as SignedInShell drives it: Calendar applies its link; an Edit opens task/{id} (single top). */
    private class Nav(handle: SavedStateHandle) {
        val stack = mutableListOf("calendar")
        private val gate = CalendarLinkGate(handle)
        /** CalendarScreen entering composition (first show, return from the task, rotation). */
        fun showCalendar(task: String?, nonce: String?) {
            if (gate.take(CalendarLinkGate.key("2026-10-08", null, null, null, null, task, nonce)) && task != null) openTask(task)
        }
        fun openTask(id: String) { if (stack.last() != "task/$id") stack += "task/$id" }
        fun back() { stack.removeAt(stack.lastIndex) }
    }

    @Test fun deepLinkTaskThenBackLeavesTheCalendarOnTop() {
        val handle = SavedStateHandle()
        val nav = Nav(handle)
        nav.showCalendar("t1", "n1")
        assertEquals(listOf("calendar", "task/t1"), nav.stack)
        nav.back()
        nav.showCalendar("t1", "n1") // the same entry composes again
        assertEquals(listOf("calendar"), nav.stack)
        // Rotation / process restore: a new gate over the same saved state.
        Nav(handle).apply { showCalendar("t1", "n1"); assertEquals(listOf("calendar"), stack) }
    }

    @Test fun theSameLinkTappedAgainCarriesANewNonceAndOpensAgain() {
        val nav = Nav(SavedStateHandle())
        nav.showCalendar("t1", "n1"); nav.back(); nav.showCalendar("t1", "n1")
        nav.showCalendar("t1", "n2")
        assertEquals(listOf("calendar", "task/t1"), nav.stack)
    }

    @Test fun gateKeysDifferPerArgument() {
        val gate = CalendarLinkGate(SavedStateHandle())
        assertTrue(gate.take(CalendarLinkGate.key("2026-10-08", null, null, null, null, null, null)))
        assertFalse(gate.take(CalendarLinkGate.key("2026-10-08", null, null, null, null, null, null)))
        assertTrue(gate.take(CalendarLinkGate.key("2026-10-09", null, null, null, null, null, null)))
        // null and "" in different places are not the same link.
        assertTrue(CalendarLinkGate.key("a", null) != CalendarLinkGate.key(null, "a"))
    }

    @Test fun navigationAppliesOnceAndOpensTasksSingleTop() {
        val root = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "app/src/main").isDirectory }
        val shell = File(root, "app/src/main/java/id/znetworks/nexus/ui/shell/SignedInShell.kt").readText()
        val screen = File(root, "app/src/main/java/id/znetworks/nexus/feature/calendar/CalendarScreen.kt").readText()
        val vm = File(root, "app/src/main/java/id/znetworks/nexus/feature/calendar/CalendarViewModel.kt").readText()
        // Every Calendar → task navigation is single top.
        val opens = Regex("""onOpenTask = \{ nav\.navigate\("task/\$\{enc\(it\)\}"\)([^}]*)\}""").findAll(shell).toList()
        assertTrue(opens.size >= 2)
        opens.forEach { assertTrue(it.value, "launchSingleTop = true" in it.value) }
        assertTrue("&n={n}" in shell)
        assertTrue("vm.applyLink(date, view, lens, focus, scope, task, nonce)" in screen)
        assertTrue("if (!linkGate.take(" in vm)
    }

    @Test fun onlyTheLoadedRangeCountsAsLoaded() {
        val items = CalItems(today = "2026-10-05")
        val oct = CalState(items = items, day = "2026-10-08", itemsRange = CalendarCore.gridRange("2026-10-08"))
        assertTrue(oct.current)
        assertFalse(oct.copy(day = "2026-11-10").current) // November on screen, October held
        assertFalse(oct.copy(view = CalView.PEOPLE).current) // a week is another range
        assertFalse(CalState(items = null, day = "2026-10-08").current)
    }
}
