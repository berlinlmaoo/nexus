package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate

/** GIDEON redesign (HANDOFF scope 6; dev web GideonPanel / lib/gideon.ts, iOS QAInteractKit + GideonChatTitle). */
class GideonRedesignTest {
    private val decode = { s: String -> runCatching { NexusJson.parseToJsonElement(s).jsonObject }.getOrNull() as JsonObject? }

    @Test fun streamContract() {
        val raw = """
            data: {"type":"chat","id":"c1","title":"What's overdue for me?"}

            data: {"type":"run","id":"r1"}

            data: {"type":"delta","content":"Let me look"}

            data: {"type":"step","step":{"id":"s1","tool":"search_tasks","arg":"overdue","label":"search_tasks","status":"running"}}

            data: {"type":"reset"}

            data: not json

            data: {"type":"delta","content":"Two tasks"}

            data: {"type":"final","content":"**Two** tasks are overdue."}

            data: {"type":"done"}

            data: {"type":"delta","content":"ignored after done"}
        """.trimIndent()
        val r = GideonRules.parse(raw, decode)
        assertEquals("**Two** tasks are overdue.", r.text)
        assertEquals("c1", r.chatId); assertEquals("What's overdue for me?", r.chatTitle)
        assertEquals(1, r.steps.size); assertEquals("done", r.steps[0].status) // nothing left running after the run
        assertNull(r.error)
        // The old contract (text + done) still reads; the empty placeholder is no answer.
        assertEquals("Hi", GideonRules.parse("data: {\"type\":\"text\",\"content\":\"Hi\"}\ndata: {\"type\":\"done\"}", decode).text)
        assertEquals("", GideonRules.parse("data: {\"type\":\"final\",\"content\":\"(Gideon balas kosong — coba ulang.)\"}", decode).text)
        assertEquals("Gideon error (503).", GideonRules.parse("data: {\"type\":\"error\",\"content\":\"Gideon error (503).\"}", decode).error)
    }

    @Test fun problemsInWords() {
        assertEquals(GideonProblem.Kind.BUSY, GideonProblem.http(429, null, null).kind)
        assertEquals(GideonProblem.Kind.UNREACHABLE, GideonProblem.http(502, null, null).kind)
        assertEquals(GideonProblem.Kind.NOT_CONNECTED, GideonProblem.http(503, "not_configured", null).kind)
        assertEquals(GideonProblem.Kind.NOT_CONNECTED, GideonProblem.http(503, "GIDEON_UNAVAILABLE", null).kind)
        assertEquals(GideonProblem.Kind.NOT_CONNECTED, GideonProblem.http(503, null, "GIDEON is not connected on this server").kind)
        assertEquals(GideonProblem.Kind.UNREACHABLE, GideonProblem.http(503, null, "upstream down").kind)
        assertEquals(GideonProblem.Kind.TOO_LARGE, GideonProblem.http(413, null, "File terlalu besar").kind)
        assertEquals(GideonProblem.Kind.UNSUPPORTED, GideonProblem.http(415, null, null).kind)
        assertFalse(GideonProblem.http(415, null, null).retryable)
        assertEquals(GideonProblem.Kind.RATE_LIMITED, GideonProblem.http(400, "rate_limited", null).kind)
        assertEquals(GideonProblem.Kind.UNREACHABLE, GideonProblem.from(ApiError.Transport(java.io.IOException("reset"))).kind)
        // Stream errors: never the raw "Gideon error (NNN)." or the Indonesian-only lines.
        assertEquals(GideonProblem.Kind.UNREACHABLE, GideonProblem.stream("Gideon error (503).").kind)
        assertEquals(GideonProblem.Kind.BUSY, GideonProblem.stream("Gideon error (429).").kind)
        assertEquals(GideonProblem.Kind.UNREACHABLE, GideonProblem.stream("Gideon lagi gak bisa dihubungi, coba lagi nanti.").kind)
        assertEquals(GideonProblem.Kind.NO_DOCUMENTS, GideonProblem.stream("Dokumen belum bisa dibaca di server ini.").kind)
        assertEquals(GideonProblem.Kind.FAILED, GideonProblem.stream("").kind)
        val other = GideonProblem.stream("You asked for a project you can't open.")
        assertEquals(GideonProblem.Kind.OTHER, other.kind); assertEquals("You asked for a project you can't open.", other.raw)
    }

    @Test fun stepsNeverShowToolNames() {
        fun t(tool: String, arg: String? = null, label: String? = null) = GideonSteps.text(GStep("x", tool, arg, label))
        assertEquals(GideonSteps.Text(GideonSteps.Kind.SEARCH_TASKS, "overdue"), t("search_tasks", "overdue"))
        assertEquals(GideonSteps.Text(GideonSteps.Kind.LIST_PROJECTS, null), t("list_projects", "ignored"))
        assertEquals(GideonSteps.Kind.READ_PROJECT, t("read_context").kind)
        assertEquals(GideonSteps.Kind.READ_NAMED, t("read_context", "Atlas").kind)
        assertEquals(GideonSteps.Kind.LOOK_IMAGE, t("vision").kind)
        // Unknown tools: a worded label is shown, a tool-like one never.
        assertEquals(GideonSteps.Text(GideonSteps.Kind.LABEL, "Checking the calendar"), t("calendar_peek", label = "Checking the calendar"))
        assertEquals(GideonSteps.Kind.WORKING, t("calendar_peek", label = "calendar_peek").kind)
        assertEquals(GideonSteps.Kind.WORKING, t("mcp.fetch", label = "mcpFetch").kind)
        assertEquals(GideonSteps.Kind.WORKING, t("x_tool").kind)
        assertEquals(60, t("search_docs", "a".repeat(200)).arg!!.length)
    }

    @Test fun chipTitlesFollowTheLanguage() {
        assertEquals("Apa saja task-ku yang terlambat?", GideonChatTitle.text("What's overdue for me?", indonesian = true))
        assertEquals("What's overdue for me?", GideonChatTitle.text(" Apa saja task-ku yang terlambat? ", indonesian = false))
        assertEquals("Budget Q4", GideonChatTitle.text("Budget Q4", indonesian = true))
        assertNull(GideonChatTitle.text(null, indonesian = true))
    }

    @Test fun chatListGroups() {
        val today = LocalDate.of(2026, 10, 13)
        assertEquals(GideonChatGroups.Bucket.TODAY, GideonChatGroups.bucket("2026-10-12T18:00:00Z", today)) // 01:00 WIB on the 13th
        assertEquals(GideonChatGroups.Bucket.YESTERDAY, GideonChatGroups.bucket("2026-10-12T03:00:00Z", today))
        assertEquals(GideonChatGroups.Bucket.WEEK, GideonChatGroups.bucket("2026-10-07T03:00:00Z", today))
        assertEquals(GideonChatGroups.Bucket.OLDER, GideonChatGroups.bucket("2026-09-01T03:00:00Z", today))
        assertEquals(GideonChatGroups.Bucket.OLDER, GideonChatGroups.bucket(null, today))
        val rows = NexusJson.decodeFromString(GChats.serializer(), """{"chats":[
            {"id":"a","title":"x","createdAt":"2026-10-13T01:00:00Z","updatedAt":"2026-10-13T01:00:00Z","messages":4,"match":null,"extra":true},
            {"id":"b","title":null,"updatedAt":"2026-09-01T01:00:00Z"}]}""").chats
        assertEquals(listOf(GideonChatGroups.Bucket.TODAY to listOf("a"), GideonChatGroups.Bucket.OLDER to listOf("b")), GideonChatGroups.group(rows, today).map { it.first to it.second.map { r -> r.id } })
    }

    @Test fun markdown() {
        val b = GideonMd.parse("""
            # Overdue
            You have **2** tasks, see [the board](/projects/p1).

            - First *one* with `code`
            - Second
              continued
            1. Step one
            2. Step two
            - [x] Done item

            > A quote

            ```
            val x = 1
            ```
            ---
            snake_case_name stays as is
        """.trimIndent())
        assertEquals(GideonMd.Block.Heading(1, listOf(GideonMd.Span("Overdue"))), b[0])
        val p = b[1] as GideonMd.Block.Paragraph
        assertTrue(p.spans.any { it.bold && it.text == "2" })
        assertEquals("/projects/p1", p.spans.first { it.url != null }.url)
        val bullets = b[2] as GideonMd.Block.ListBlock
        assertFalse(bullets.ordered); assertEquals(2, bullets.items.size)
        assertTrue(bullets.items[0].spans.any { it.italic && it.text == "one" }); assertTrue(bullets.items[0].spans.any { it.code && it.text == "code" })
        assertEquals("Second continued", bullets.items[1].spans.joinToString("") { it.text })
        val numbered = b[3] as GideonMd.Block.ListBlock
        assertTrue(numbered.ordered); assertEquals(1, numbered.start); assertEquals(2, numbered.items.size)
        assertEquals(true, (b[4] as GideonMd.Block.ListBlock).items[0].checked)
        assertEquals(GideonMd.Block.Quote(listOf(GideonMd.Span("A quote"))), b[5])
        assertEquals(GideonMd.Block.Code("val x = 1"), b[6])
        assertEquals(GideonMd.Block.Rule, b[7])
        assertEquals(listOf(GideonMd.Span("snake_case_name stays as is")), (b[8] as GideonMd.Block.Paragraph).spans)
        assertEquals(listOf(GideonMd.Span("a "), GideonMd.Span("b", strike = true), GideonMd.Span(" *c")), GideonMd.inline("a ~~b~~ *c"))
        assertTrue(GideonMd.plain(b).startsWith("Overdue\n\nYou have 2 tasks"))
    }

    @Test fun freshChatOnEveryOpenAndStrings() {
        val screen = File("src/main/java/id/znetworks/nexus/feature/gideon/GideonScreen.kt").readText()
        assertTrue(screen.contains("if (!started) { started = true; chat.startNew() }"))
        val api = File("src/main/java/id/znetworks/nexus/feature/gideon/Gideon.kt").readText()
        assertTrue(api.contains("put(\"newChat\", true)") && api.contains("put(\"stream\", true)") && api.contains("/api/gideon/chats"))
        val names = { v: String -> Regex("<string name=\"([^\"]+)\"").findAll(File("src/main/res/$v/strings_gideon.xml").readText()).map { it.groupValues[1] }.toSet() }
        assertEquals(names("values"), names("values-in"))
    }
}
