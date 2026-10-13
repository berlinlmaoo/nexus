package id.znetworks.nexus.feature.forms

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.feature.projects.CustomFieldDef
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Forms: Kategori mapping (web c1afb95, iOS 0ed8600) and Responses (iOS a30d094). */
class FormKategoriResponsesTest {
    private fun sel(id: String, name: String, vararg opts: String) =
        CustomFieldDef(id, name, "SELECT", options = NexusJson.parseToJsonElement(opts.joinToString(",", "[", "]") { "\"$it\"" }))
    private val kategori = sel("k", "Kategori", "Design", "Video", "Copy")
    private val other = sel("o", "Channel", "IG", "TikTok")
    private val sections = listOf("To Do", "On Progress", "Done")

    @Test fun categoryQuestionFindsItsField() {
        assertEquals("k", FormCategory.projectField(listOf(other, kategori))?.id)
        // A Section dropdown whose options are categories belongs to Kategori…
        assertEquals("k", FormCategory.fieldForSectionQuestion("dropdown", "task_list", listOf("Design", " video "), listOf(other, kategori), sections)?.id)
        // …or to any select whose options cover them; none = the category field.
        assertEquals("o", FormCategory.fieldForSectionQuestion("dropdown", "task_list", listOf("IG"), listOf(other, kategori), sections)?.id)
        assertEquals("k", FormCategory.fieldForSectionQuestion("select", "task_list", emptyList(), listOf(other, kategori), sections)?.id)
        // Section names, another target, or a text question: not one.
        assertNull(FormCategory.fieldForSectionQuestion("dropdown", "task_list", listOf("Done"), listOf(kategori), sections))
        assertNull(FormCategory.fieldForSectionQuestion("dropdown", "custom_field", listOf("Design"), listOf(kategori), sections))
        assertNull(FormCategory.fieldForSectionQuestion("text", "task_list", listOf("Design"), listOf(kategori), sections))
    }

    @Test fun adoptingOptions() {
        assertTrue(FormCategory.shouldAdopt(listOf("To Do", "Done"), sections, kategori.choices))
        assertTrue(FormCategory.shouldAdopt(listOf(" "), sections, kategori.choices))
        assertFalse(FormCategory.shouldAdopt(listOf("Design", "Mine"), sections, kategori.choices))
        assertEquals(listOf("Mine"), FormCategory.extraOptions(listOf("design", "Mine", ""), kategori.choices))
        assertTrue(FormCategory.sameOptions(listOf("copy", "Video", "Design"), kategori.choices))
        assertFalse(FormCategory.sameOptions(listOf("Design"), kategori.choices))
    }

    @Test fun responsesDecodeAndGoLive() {
        val r = NexusJson.decodeFromString(FormResponses.serializer(), """{"total":2,"projectId":"p","responses":[
            {"id":"s1","createdAt":"2026-10-13T03:00:00.000Z","submitter":{"id":"u","name":"Budi","avatar":null},"task":{"id":"t1","title":"Logo","status":"TODO","section":"To Do"},"extra":1},
            {"id":"s2","task":null}]}""")
        assertEquals(2, r.total); assertEquals("To Do", r.responses[0].task?.section); assertNull(r.responses[1].task)
        val e = RealtimeEvents.parse(RealtimeEvents.FORM_RESPONSES_CHANGED, """{"projectId":"p","formId":"f1"}""")
        assertTrue(RealtimeEvents.formResponses(e, "f1")); assertFalse(RealtimeEvents.formResponses(e, "f2"))
    }
}
