package id.znetworks.nexus.core.net

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ConcurrentEditsTest {
    @Test fun anAssigneeEditDoesNotRemoveAConcurrentAddition() {
        val delta = ConcurrentEdits.delta(listOf("a", "b"), listOf("b", "c"), "addAssigneeIds", "removeAssigneeIds")
        val held = mutableSetOf("a", "b", "someone-else")
        held += (delta["addAssigneeIds"] as JsonArray).map { it.jsonPrimitive.content }
        held -= (delta["removeAssigneeIds"] as JsonArray).map { it.jsonPrimitive.content }.toSet()
        assertEquals(setOf("b", "c", "someone-else"), held)
        assertFalse("assigneeIds" in delta)
    }

    @Test fun tagsAndMultiSelectUseTheSameSetSemantics() {
        for ((add, remove) in listOf("addTags" to "removeTags", "addValues" to "removeValues")) {
            val delta = ConcurrentEdits.delta(listOf("old"), listOf("old", "new", "new"), add, remove)
            assertEquals(JsonArray(listOf(JsonPrimitive("new"))), delta[add])
            assertEquals(JsonArray(emptyList()), delta[remove])
        }
    }

    @Test fun descriptionCarriesTheOriginalTextIncludingBlankLines() {
        val body = ConcurrentEdits.description("One\n\nTwo", "original")
        assertEquals(JsonPrimitive("original"), body["baseText"])
        val paragraphs = body["doc"]!!.jsonObject["content"]!!.jsonArray
        assertEquals(3, paragraphs.size)
        assertNull(paragraphs[1].jsonObject["content"])
    }

    @Test fun oldTaskEventsAreRejectedButUnknownTimestampsRefresh() {
        assertTrue(ConcurrentEdits.older("2026-10-16T01:00:00Z", "2026-10-16T02:00:00Z"))
        assertFalse(ConcurrentEdits.older("2026-10-16T02:00:00Z", "2026-10-16T02:00:00Z"))
        assertFalse(ConcurrentEdits.older(null, "2026-10-16T02:00:00Z"))
        assertFalse(ConcurrentEdits.older("invalid", "2026-10-16T02:00:00Z"))
    }
}
