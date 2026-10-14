package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** @ pages (context.refs) and Review before writing (approvalMode + proposals): web GideonPanel / lib/gideon.ts, iOS Gideon.swift. */
class GideonContextTest {
    private val decode = { s: String -> runCatching { NexusJson.parseToJsonElement(s).jsonObject }.getOrNull() as JsonObject? }

    @Test fun mentionQueryFollowsTheWebRegex() {
        assertEquals("", GideonMention.query("@"))
        assertEquals("atl", GideonMention.query("look at @atl"))
        assertEquals("Budget", GideonMention.query("line one\n@Budget"))
        // An @ inside a word (an email) is not a mention; a finished word (space after) closes the picker.
        assertNull(GideonMention.query("mail budi@znetworks"))
        assertNull(GideonMention.query("@atlas "))
        assertNull(GideonMention.query("no mention"))
        assertNull(GideonMention.query("@" + "a".repeat(41)))
        assertEquals("a".repeat(40), GideonMention.query("@" + "a".repeat(40)))
    }

    @Test fun stripAndStart() {
        assertEquals("summarize ", GideonMention.strip("summarize @atl"))
        assertEquals("", GideonMention.strip("@"))
        assertEquals("plain", GideonMention.strip("plain"))
        assertEquals("@", GideonMention.start(""))
        assertEquals("hi @", GideonMention.start("hi"))
        assertEquals("hi @", GideonMention.start("hi "))
        assertEquals("hi\n@", GideonMention.start("hi\n"))
    }

    @Test fun refsAreUniqueAndCapped() {
        val a = GRef("project", "p1", "Atlas")
        var refs = GideonMention.add(emptyList(), a)
        assertEquals(refs, GideonMention.add(refs, a.copy(title = "Atlas again")))
        // Same id, other kind: a different page.
        refs = GideonMention.add(refs, GRef("task", "p1", "Task p1"))
        assertEquals(2, refs.size)
        repeat(20) { refs = GideonMention.add(refs, GRef("doc", "d$it", "Doc $it")) }
        assertEquals(GideonMention.MAX_REFS, refs.size)
    }

    @Test fun pickerHitsRankAndFilter() {
        val r = NexusJson.decodeFromString(GMentionSearch.serializer(), """{
            "projects":[{"id":"p1","name":"Big Atlas","color":"#fff"},{"id":"p2","name":"Atlas"},{"id":"p3","name":"c"},{"id":"p4","name":"d"},{"id":"p5","name":"e"}],
            "docs":[{"id":"d1","title":"Untitled","project":{"name":"Atlas"}},{"id":"d2","title":"Atlas notes","project":{"name":"Atlas"}},{"id":"d3","title":""}],
            "tasks":[{"id":"t1","title":"atlas","taskList":{"projectId":"p2","project":{"name":"Atlas"}}},{"id":"t2","title":"Other"}],
            "forms":[],"members":[{"id":"u1"}]}""")
        val hits = GideonMention.hits(r, "Atlas", untitled = "Tanpa judul")
        // Exact titles first (project before task at the same score), then prefix, then contains; at most 4 projects.
        assertEquals(listOf("project:p2", "task:t1", "doc:d2", "project:p1", "project:p3", "project:p4", "task:t2"), hits.map { "${it.ref.kind}:${it.ref.id}" })
        assertEquals("Atlas", hits.first { it.ref.id == "d2" }.sub)
        assertEquals("Atlas", hits.first { it.ref.id == "t1" }.sub)
        assertNull(hits.first { it.ref.id == "p2" }.sub)
        // "Untitled" pages only when that is what was typed, shown in the app's word.
        val untitled = GideonMention.hits(r, "unt", untitled = "Tanpa judul")
        assertEquals("Tanpa judul", untitled.first { it.ref.kind == "doc" }.ref.title)
        assertTrue(GideonMention.hits(r, "tanpa", untitled = "Tanpa judul").any { it.ref.id == "d1" })
        assertTrue(GideonMention.hits(r, "  ").isEmpty())
    }

    @Test fun contextBodyMatchesWeb() {
        assertNull(GideonMention.context(null, emptyList()))
        assertEquals("""{"projectId":"p1"}""", GideonMention.context("p1", emptyList()).toString())
        // Titles stay on the phone: refs go as {kind,id} only.
        assertEquals("""{"projectId":"p1","refs":[{"kind":"doc","id":"d1"},{"kind":"task","id":"t1"}]}""",
            GideonMention.context("p1", listOf(GRef("doc", "d1", "Notes"), GRef("task", "t1", "Fix", "p9"))).toString())
        assertEquals("""{"refs":[{"kind":"project","id":"p2"}]}""", GideonMention.context(null, listOf(GRef("project", "p2", "Atlas"))).toString())
    }

    @Test fun approvalModes() {
        assertEquals(GideonApprovalMode.REVIEW, GideonApprovalMode.fallback)
        assertEquals(GideonApprovalMode.DONT_ASK, GideonApprovalMode.of("dont_ask"))
        assertEquals(GideonApprovalMode.ALWAYS_ASK, GideonApprovalMode.of("always_ask"))
        assertEquals(GideonApprovalMode.REVIEW, GideonApprovalMode.of(null))
        assertEquals(GideonApprovalMode.REVIEW, GideonApprovalMode.of("something_new"))
        assertEquals(listOf("always_ask", "review", "dont_ask"), GideonApprovalMode.entries.map { it.key })
        assertEquals("""{"decision":"apply"}""", GideonReview.body(true).toString())
        assertEquals("""{"decision":"discard"}""", GideonReview.body(false).toString())
        assertTrue(GideonReview.carriesProposal(200)); assertTrue(GideonReview.carriesProposal(409))
        assertTrue(GideonReview.carriesProposal(410)); assertTrue(GideonReview.carriesProposal(422))
        assertFalse(GideonReview.carriesProposal(404)); assertFalse(GideonReview.carriesProposal(500))
    }

    @Test fun streamCarriesProposalsAndCards() {
        val raw = """
            data: {"type":"chat","id":"c1","title":"Make a task"}

            data: {"type":"step","step":{"id":"s1","tool":"create_task","arg":"Ship","status":"running"}}

            data: {"type":"proposal","proposal":{"id":"pr1","action":"update_task","summary":"Move Ship to Done","diff":[{"field":"Status","from":"TODO","to":"DONE"},{"field":"Due","from":null,"to":3}],"status":"PENDING","projectId":"p1","taskId":"t1","createdAt":"2026-10-14T01:00:00Z","card":null,"error":null}}

            data: {"type":"card","card":{"kind":"task","action":"created","id":"t2","title":"Ship","projectName":"Atlas","status":"TODO","url":"/x","extra":1}}

            data: {"type":"proposal","proposal":{"id":"pr1","summary":"Move Ship to Done","status":"APPLIED","diff":[]}}

            data: {"type":"proposal","proposal":{"bad":true}}

            data: {"type":"done"}
        """.trimIndent()
        val r = GideonRules.parse(raw, decode)
        assertEquals("", r.text)
        assertTrue(r.answered) // a proposal with no words is still an answer, not "GIDEON didn't answer"
        assertEquals(1, r.proposals.size); assertEquals("APPLIED", r.proposals[0].status) // same id: the later frame wins
        assertEquals(listOf("t2"), r.cards.map { it.id }); assertEquals("Atlas", r.cards[0].projectName)
        val first = GideonRules.parse(raw.substringBefore("data: {\"type\":\"card\""), decode).proposals.single()
        assertTrue(first.isPending)
        assertEquals("TODO", first.diff[0].fromText); assertEquals("DONE", first.diff[0].toText)
        assertNull(first.diff[1].fromText); assertEquals("3", first.diff[1].toText)
        assertFalse(GideonRules.parse("data: {\"type\":\"final\",\"content\":\"\"}", decode).answered)
    }

    @Test fun historyAndReplace() {
        val h = NexusJson.decodeFromString(GHistory.serializer(), """{"chat":{"id":"c1"},"messages":[
            {"role":"user","content":"make it"},
            {"role":"assistant","content":"","meta":{"steps":[],"cards":[{"kind":"doc","action":"created","id":"d1","title":"Notes"}],
              "proposals":[{"id":"pr1","action":"create_task","summary":"Create Ship","status":"PENDING","diff":[{"field":"Title","to":"Ship"}]},{"id":"pr2","status":"DISCARDED"}]}},
            {"role":"assistant","content":"old","meta":null}]}""")
        val m = h.messages[1]
        assertEquals(2, m.proposals.size); assertEquals("Notes", m.cards.single().title)
        assertTrue(h.messages[2].proposals.isEmpty())
        val applied = m.proposals[0].copy(status = "APPLIED", card = GCard("task", "created", "t9", "Ship"))
        val next = GideonReview.replace(h.messages, applied)
        assertEquals("APPLIED", next[1].proposals[0].status); assertEquals("t9", next[1].proposals[0].card?.id)
        assertEquals("DISCARDED", next[1].proposals[1].status)
        assertEquals(h.messages[0], next[0]); assertEquals(h.messages[2], next[2])
        assertEquals(GideonReview.Status.APPLIED, GideonReview.status(applied))
        assertEquals(GideonReview.Status.FAILED, GideonReview.status(applied.copy(status = "FAILED")))
        assertEquals(GideonReview.Status.OTHER, GideonReview.status(applied.copy(status = "WHATEVER")))
    }

    @Test fun looseDiffValues() {
        assertEquals("12", GideonReview.loose(JsonPrimitive(12.0)))
        assertEquals("1.5", GideonReview.loose(JsonPrimitive(1.5)))
        assertEquals("true", GideonReview.loose(JsonPrimitive(true)))
        assertEquals("007", GideonReview.loose(JsonPrimitive("007")))
        assertNull(GideonReview.loose(null))
        assertNull(GideonReview.loose(kotlinx.serialization.json.JsonNull))
    }

    @Test fun requestCarriesApprovalAndContext() {
        val api = File("src/main/java/id/znetworks/nexus/feature/gideon/Gideon.kt").readText()
        assertTrue(api.contains("put(\"approvalMode\", out.approval.key)"))
        assertTrue(api.contains("GideonMention.context(_state.value.project?.first, out.refs)"))
        assertTrue(api.contains("\"/api/gideon/proposals/\""))
        val screen = File("src/main/java/id/znetworks/nexus/feature/gideon/GideonScreen.kt").readText()
        assertTrue(screen.contains("GideonMention.query(draft)") && screen.contains("DecisionDialog("))
        val en = File("src/main/res/values/strings_gideon.xml").readText()
        assertTrue(en.contains(">Ask anything. Type @ to add a page<") && en.contains(">Review before writing<"))
    }
}
