package id.znetworks.nexus.feature.forms

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class FormCoeditTest {
    private fun obj(s: String) = NexusJson.parseToJsonElement(s).jsonObject
    private val base = obj("""{"name":"Base","description":"","settings":{"a":1,"b":2},"fields":[{"id":"a","label":"A","required":false},{"id":"b","label":"B"},{"id":"c","label":"C"}]}""")
    @Test fun independentScalarQuestionAndSettingsKeysSurvive() {
        val ours = obj("""{"name":"Mine","description":"","settings":{"a":3,"b":2},"fields":[{"id":"a","label":"Mine","required":false},{"id":"b","label":"B"},{"id":"c","label":"C"}]}""")
        val theirs = obj("""{"name":"Base","description":"Remote","settings":{"a":1,"b":4},"fields":[{"id":"a","label":"A","required":true},{"id":"b","label":"Remote B"},{"id":"c","label":"C"}]}""")
        val merged = FormCoedit.rebase(base, ours, theirs)
        assertEquals(JsonPrimitive("Mine"), merged["name"]); assertEquals(JsonPrimitive("Remote"), merged["description"])
        assertEquals(obj("""{"a":3,"b":4}"""), merged["settings"])
        assertEquals(obj("""{"id":"a","label":"Mine","required":true}"""), merged["fields"]!!.jsonArray[0])
        val ops = FormCoedit.diff(theirs, merged)
        assertEquals(listOf("set_title", "set_settings", "update_question"), ops.map { it["op"]!!.jsonPrimitive.content })
        assertEquals(obj("""{"a":3}"""), ops[1]["settings"])
        assertEquals(obj("""{"label":"Mine"}"""), ops[2]["fields"])
    }
    @Test fun deletionWinsInBothDirectionsAndDropsBrokenCondition() {
        val ours = obj("""{"fields":[{"id":"a","label":"Edit"},{"id":"c","showIf":{"fieldId":"b"}}]}""")
        val theirs = obj("""{"fields":[{"id":"b","label":"Edit"},{"id":"c"}]}""")
        assertEquals(JsonArray(listOf(obj("""{"id":"c"}"""))), FormCoedit.rebase(base, ours, theirs)["fields"])
    }
    @Test fun unilateralAdditionsStayAfterTheirPredecessors() {
        val ours = obj("""{"fields":[{"id":"a","label":"A","required":false},{"id":"x"},{"id":"b","label":"B"},{"id":"c","label":"C"}]}""")
        val theirs = obj("""{"fields":[{"id":"a","label":"A","required":false},{"id":"b","label":"B"},{"id":"y"},{"id":"c","label":"C"}]}""")
        assertEquals(listOf("a", "x", "b", "y", "c"), FormCoedit.rebase(base, ours, theirs)["fields"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content })
    }
    @Test fun movingOneQuestionKeepsTheLongestOrderedRun() {
        val draft = JsonObject(base + ("fields" to JsonArray(listOf(base["fields"]!!.jsonArray[2], base["fields"]!!.jsonArray[0], base["fields"]!!.jsonArray[1]))))
        val moves = FormCoedit.diff(base, draft)
        assertEquals(1, moves.size); assertEquals("move_question", moves.single()["op"]!!.jsonPrimitive.content)
        assertEquals(JsonPrimitive("c"), moves.single()["id"]); assertEquals(JsonNull, moves.single()["afterId"])
        assertEquals(draft["fields"], FormCoedit.rebase(base, draft, base)["fields"])
    }
    @Test fun unsetIsDifferentFromAnExplicitNullAndNoChangeSendsNothing() {
        val b = obj("""{"fields":[{"id":"a","description":"old","future":true}]}""")
        val d = obj("""{"fields":[{"id":"a","future":null}]}""")
        val op = FormCoedit.diff(b, d).single()
        assertEquals(JsonArray(listOf(JsonPrimitive("description"))), op["unset"])
        assertEquals(obj("""{"future":null}"""), op["fields"])
        assertTrue(FormCoedit.diff(b, b).isEmpty())
    }
    @Test fun everyReorderingReplaysToItsTargetWithOnlyMinimalMoves() {
        fun permutations(ids: List<String>): List<List<String>> = if (ids.isEmpty()) listOf(emptyList()) else ids.flatMap { id -> permutations(ids - id).map { listOf(id) + it } }
        val ids = listOf("a", "b", "c", "d", "e")
        fun doc(order: List<String>) = obj("""{"fields":[${order.joinToString(",") { "{\"id\":\"$it\"}" }}]}""")
        for (target in permutations(ids)) {
            val working = ids.toMutableList()
            val ops = FormCoedit.diff(doc(ids), doc(target))
            ops.forEach { op -> val id = op["id"]!!.jsonPrimitive.content; working.remove(id); val prev = op["afterId"]!!.jsonPrimitive.contentOrNull; working.add(if (prev == null) 0 else working.indexOf(prev) + 1, id) }
            assertEquals(target, working)
            assertEquals(target, FormCoedit.rebase(doc(ids), doc(target), doc(ids))["fields"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content })
        }
    }
}
