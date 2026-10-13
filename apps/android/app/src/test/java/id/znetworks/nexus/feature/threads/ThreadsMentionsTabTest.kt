package id.znetworks.nexus.feature.threads

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Threads All | Mentions (web threads.tsx, iOS 427fea6): Mentions reads `mentions=me` and has no composer. */
class ThreadsMentionsTabTest {
    @Test fun mentionsTab() {
        val api = File("src/main/java/id/znetworks/nexus/feature/threads/ThreadsApi.kt").readText()
        assertTrue(api.contains("if (mentionsMe) add(\"mentions=me\")"))
        val ui = File("src/main/java/id/znetworks/nexus/feature/threads/ThreadsScreen.kt").readText()
        assertTrue(ui.contains("api.page(null, mentionsMe = mentions)") && ui.contains("api.page(s.cursor, mentionsMe = s.mentionsOnly)"))
        assertTrue(ui.contains("if (!s.mentionsOnly) item(key = \"composer\")"))
        assertTrue(ui.contains("R.string.th_tab_mentions") && ui.contains("R.string.th_no_mentions"))
    }
}
