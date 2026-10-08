package id.znetworks.nexus.core.realtime

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.tasks.TaskDetail
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.coroutines.test.advanceUntilIdle
import java.io.File

/** ANDROID-REALTIME (Berlin, 8 Oct): Socket.IO pings, rooms, fallback pace, the creator line. */
class RealtimeTest {
    @Test fun pingsReadAsTheServerSendsThem() {
        val w = RealtimeEvents.parse("workspace-changed", """{"kind":"folders","folderId":"f1","actorId":"u"}""")
        assertEquals("folders", w.kind); assertEquals("f1", w.folderId)
        assertTrue(RealtimeEvents.isProjectsOrFolders(w)); assertFalse(RealtimeEvents.isAudit(w))
        assertTrue(RealtimeEvents.isAudit(RealtimeEvents.parse("audit-changed", """{"kind":"audit"}""")))
        assertTrue(RealtimeEvents.isAudit(RealtimeEvents.parse("workspace-changed", """{"kind":"audit"}""")))
        assertEquals("c1", RealtimeEvents.parse("conversation-updated", """{"conversationId":"c1","lastMessageAt":null,"reason":"read"}""").conversationId)
        assertEquals("c1", RealtimeEvents.parse("message-created", """{"id":"m9","conversationId":"c1","content":"hi"}""").conversationId)
        val upd = RealtimeEvents.parse("task-updated", """{"id":"t1","projectId":"p1","title":"x"}""")
        assertEquals("t1", upd.taskId); assertEquals("p1", upd.projectId)
        assertEquals("t1", RealtimeEvents.parse("comment-added", """{"taskId":"t1","comment":{"id":"k"}}""").taskId)
        assertEquals("t1", RealtimeEvents.parse("task-deleted", """{"taskId":"t1"}""").taskId)
        // No payload, or not an object: still the event, never a crash.
        assertNull(RealtimeEvents.parse("new-notification", null).taskId)
        assertEquals("audit-changed", RealtimeEvents.parse("audit-changed", "[1,2]").name)
    }

    @Test fun whatEachScreenListensTo() {
        val upd = RealtimeEvent("task-updated", taskId = "t1")
        assertTrue(RealtimeEvents.touchesTask(upd, "t1")); assertFalse(RealtimeEvents.touchesTask(upd, "t2"))
        assertFalse(RealtimeEvents.touchesTask(RealtimeEvent("task-created", taskId = "t1"), "t1"))
        assertTrue(RealtimeEvents.touchesProject(RealtimeEvent("task-created"), "p1"))
        assertTrue(RealtimeEvents.touchesProject(RealtimeEvent("workspace-changed", kind = "projects", projectId = "p1"), "p1"))
        assertFalse(RealtimeEvents.touchesProject(RealtimeEvent("workspace-changed", kind = "projects", projectId = "p2"), "p1"))
        assertFalse(RealtimeEvents.touchesProject(RealtimeEvent("workspace-changed", kind = "folders"), "p1"))
    }

    @Test fun refusedSessionStopsRetrying() {
        assertTrue(RealtimeEvents.isAuthError("Invalid session"))
        // The server's catch-all for an exception: retried, never final (8 Oct fix).
        assertFalse(RealtimeEvents.isAuthError("Authentication failed"))
        assertTrue(RealtimeEvents.isAuthError("""{"message":"Authentication required"}"""))
        assertFalse(RealtimeEvents.isAuthError("timeout"))
        assertFalse(RealtimeEvents.isAuthError(null))
    }

    @Test fun fallbackPace() {
        // Spec: audit 2 min / 15 s, projects 2 min / 30 s, chat thread 30 s / 5 s.
        assertEquals(120_000, RealtimeEvents.interval(true, 120_000, 15_000))
        assertEquals(15_000, RealtimeEvents.interval(false, 120_000, 15_000))
    }

    @Test fun roomsAreCountedPerScreen() {
        val rt = Realtime(OkHttpClient(), "https://example.invalid", session = { null })
        rt.join("project:p1"); rt.join("project:p1"); rt.join("conversation:c1")
        rt.leave("project:p1")
        assertEquals(setOf("project:p1", "conversation:c1"), rt.heldRooms())
        rt.leave("project:p1"); rt.leave("conversation:c1"); rt.leave("never-joined")
        assertTrue(rt.heldRooms().isEmpty())
        // Not signed in: start() does nothing.
        rt.start(); assertEquals(Realtime.State.OFF, rt.state.value)
    }

    @Test fun connectionLivesWithTheForeground() {
        val app = File("src/main/java/id/znetworks/nexus/NexusApplication.kt").readText()
        assertTrue(app.contains("container.realtime.start()")); assertTrue(app.contains("container.realtime.stop()"))
        val rt = File("src/main/java/id/znetworks/nexus/core/realtime/Realtime.kt").readText()
        // The app's own OkHttp (identity, LAN route, cookie guard) and the same session cookie.
        assertTrue(rt.contains("opts.webSocketFactory = http")); assertTrue(rt.contains("\"Cookie\" to listOf(\"\${s.cookieName}=\${s.token}\")"))
        assertTrue(rt.contains("setPath(\"/api/socket\")"))
    }

    @Test fun creatorWhoLeft() {
        val t = NexusJson.decodeFromString(TaskDetail.serializer(), """{"id":"t","title":"x","creator":{"id":"u","name":"Rina","deactivatedAt":"2026-10-08T09:00:00.000Z"}}""")
        assertEquals("Rina", t.creator?.name); assertEquals("2026-10-08T09:00:00.000Z", t.creator?.deactivatedAt)
        listOf("src/main/res/values/strings.xml" to "Created by %1\$s", "src/main/res/values-in/strings.xml" to "Dibuat oleh %1\$s").forEach { (f, text) ->
            val x = File(f).readText(); assertTrue(x.contains(text)); assertEquals(1, Regex("name=\"rt_line\"").findAll(x).count())
        }
    }

    private val me = id.znetworks.nexus.core.session.Session("tok", "__Secure-authjs.session-token", "u1", "Me", "me@example.invalid")

    @Test fun initBeforeEveryAttemptAndRetryUntilRefused() = kotlinx.coroutines.test.runTest {
        val calls = mutableListOf<String>()
        val outcomes = ArrayDeque(listOf<Realtime.Outcome>(
            Realtime.Outcome.Dropped(false), // "Authentication failed" or a network error before connecting
            Realtime.Outcome.Dropped(true),  // was up, then the server restarted
            Realtime.Outcome.Refused,        // "Invalid session"
        ))
        val rt = Realtime(OkHttpClient(), "https://example.invalid", session = { me },
            scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.test.StandardTestDispatcher(testScheduler)),
            bootstrap = { calls += "init" }, connect = { calls += "connect"; outcomes.removeFirst() }, jitter = { 0.5 })
        rt.start(); advanceUntilIdle()
        assertEquals(listOf("init", "connect", "init", "connect", "init", "connect"), calls)
        assertEquals(Realtime.State.OFF, rt.state.value); assertTrue(rt.isRefused())
        // Refused: another start while in front does nothing …
        rt.start(); advanceUntilIdle(); assertEquals(6, calls.size)
        // … but a return from the background tries once more (iOS af0000f), without a new sign-in.
        outcomes += Realtime.Outcome.Refused
        rt.stop(); rt.start(); advanceUntilIdle()
        assertEquals(listOf("init", "connect"), calls.drop(6))
        // A sign-out forgets the refusal too.
        rt.reset(); assertFalse(rt.isRefused())
    }

    @Test fun backoffDoublesToThirtySeconds() {
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L), (1..7).map { RealtimeEvents.backoffMs(it, 0.5) })
        assertEquals(500L, RealtimeEvents.backoffMs(1, 0.0)); assertEquals(1_500L, RealtimeEvents.backoffMs(1, 1.0))
    }

    @Test fun coldStartAndEveryForegroundStartIt() {
        val app = File("src/main/java/id/znetworks/nexus/NexusApplication.kt").readText()
        // The ProcessLifecycleOwner observer is added in onCreate, so the first ON_START of a fresh process
        // (an update, a cold start) reaches start(); the session is read synchronously by then.
        val onStart = app.substringAfter("override fun onStart(owner: LifecycleOwner)").substringBefore("override fun onStop")
        assertTrue(onStart.contains("container.realtime.start()"))
        val store = File("src/main/java/id/znetworks/nexus/core/session/SessionStore.kt").readText()
        assertTrue(store.contains("MutableStateFlow(load())"))
        val rt = File("src/main/java/id/znetworks/nexus/core/realtime/Realtime.kt").readText()
        assertTrue(rt.contains("/api/realtime-init")); assertTrue(rt.contains(".setReconnection(false)"))
    }
}
