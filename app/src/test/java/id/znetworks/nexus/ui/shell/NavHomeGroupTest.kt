package id.znetworks.nexus.ui.shell

import id.znetworks.nexus.feature.attendance.history.BoardModel
import id.znetworks.nexus.feature.chat.ChatRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate

/** NAV-HOME-GROUP (Berlin, 9 Oct): Chat tab, Home tiles, group of two, the board on today. */
class NavHomeGroupTest {
    private val shell = File("src/main/java/id/znetworks/nexus/ui/shell/SignedInShell.kt").readText()

    @Test fun chatTakesTheTasksSlot() {
        assertEquals("messages", ShellTabs.routes(true)[1]); assertFalse("tasks" in ShellTabs.routes(true))
        assertTrue(ShellMotion.betweenTabs("messages", "home")); assertFalse(ShellMotion.betweenTabs("tasks", "home")) // Tasks is pushed now
        // Its badge is the chat total; More's is Inbox's only; Tasks sits in More where Messages was.
        assertTrue(shell.contains("t == Tab.CHAT -> Badges.label(chatUnread)"))
        assertTrue(shell.contains("MoreItem(R.string.tab_tasks, Icons.Filled.Checklist, c.blue) { open(\"tasks\") }"))
        assertFalse(shell.contains("MoreItem(R.string.mt_messages"))
        // A chat push opens the Chat tab, then the chat.
        assertTrue(shell.contains("goTab(Tab.CHAT); t.conversationId?.let { nav.navigate(\"chat/"))
    }

    @Test fun homeTiles() {
        val home = File("src/main/java/id/znetworks/nexus/feature/home/HomeScreen.kt").readText()
        assertTrue(home.contains("Triple(R.string.mt_vault, Icons.Filled.Storage, c.violetText) to { onOpenWeb(\"/vault\") }).takeIf { showThreads }"))
        assertTrue(home.contains("Triple(R.string.mt_ticket, Icons.Filled.ConfirmationNumber, c.blue) to { onOpenWeb(\"/tickets\") }"))
        assertFalse(home.contains("R.string.home_q_chat, Icons.Filled.Chat"))
    }

    @Test fun groupOfTwo() {
        assertEquals("DM", ChatRules.newChatType(1, makeGroup = false))
        assertEquals("GROUP", ChatRules.newChatType(1, makeGroup = true))
        assertEquals("GROUP", ChatRules.newChatType(2, makeGroup = false))
    }

    @Test fun boardStartsOnToday() {
        val days = (0 until 30).map { LocalDate.of(2026, 9, 28).plusDays(it.toLong()) }
        assertEquals(8, BoardModel.startColumn(days, LocalDate.of(2026, 10, 9)))
        assertEquals(0, BoardModel.startColumn(days, LocalDate.of(2026, 9, 29)))
        assertEquals(0, BoardModel.startColumn(days, LocalDate.of(2026, 11, 9))) // a past period: its first day
        val ui = File("src/main/java/id/znetworks/nexus/feature/attendance/history/BoardUi.kt").readText()
        // Set before the first frame, per period; a reload never swaps the grid for a spinner.
        assertTrue(ui.contains("remember(days) { ScrollState(")); assertFalse(ui.contains("hScroll.scrollTo("))
        assertTrue(ui.contains("s.loading && rows.isEmpty() ->"))
    }
}
