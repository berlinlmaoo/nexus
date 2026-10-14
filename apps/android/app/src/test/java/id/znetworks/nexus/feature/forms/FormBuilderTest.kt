package id.znetworks.nexus.feature.forms

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** FORM-BUILDER (owner, 9 Oct): fields are untyped JSON — what the builder doesn't change goes back exactly as stored. */
class FormBuilderTest {
    private fun obj(s: String) = NexusJson.parseToJsonElement(s).jsonObject

    @Test fun unchangedFieldGoesBackExactly() {
        val raw = obj("""{"id":"f1","name":"Amount","label":"Amount","type":"number","required":true,"numberFormat":"currency-idr","futureKey":{"x":1},
            "routingRules":[{"id":"r1","operator":"equals","value":"5","action":"assign_user","targetUserIds":["a","b"]}],"mapping":{"target":"task_title","extra":true}}""")
        assertEquals(raw, BuilderField.of(raw).json())
    }

    @Test fun loadsLikeTheWeb() {
        val f = BuilderField.of(obj("""{"id":"x","label":"Pick","type":"select","options":{"choices":["A","B"]}}"""))
        assertEquals("dropdown", f.type); assertEquals("Pick", f.name); assertEquals(listOf("A", "B"), f.options)
        // The old { choices } shape stays unless the options are edited…
        assertEquals(obj("""{"choices":["A","B"]}"""), f.json()["options"])
        // …then it becomes a clean list.
        assertEquals(JsonArray(listOf(JsonPrimitive("A"), JsonPrimitive("C"))), f.copy(options = listOf(" A ", "", "C")).json()["options"])
        // Editing the name writes both keys.
        val j = f.named("Choose").json(); assertEquals(JsonPrimitive("Choose"), j["name"]); assertEquals(JsonPrimitive("Choose"), j["label"])
    }

    @Test fun noneRemovesTheKey() {
        val f = BuilderField.of(obj("""{"id":"x","name":"By","type":"text","autofill":"name"}"""))
        assertFalse("autofill" in f.copy(autofill = "").json())
        assertEquals(JsonPrimitive("email"), f.copy(autofill = "email").json()["autofill"])
        assertEquals(JsonNull, BuilderField.of(obj("""{"id":"x","type":"text","showIf":{"fieldId":"a","operator":"equals","value":"1"}}""")).copy(showIf = null).json()["showIf"])
    }

    @Test fun newFieldAndRuleAreTheWebs() {
        val f = BuilderField.fresh()
        assertTrue(f.id.startsWith("field_")); assertEquals("text", f.type); assertFalse(f.required)
        val r = BuilderRule.fresh(); assertEquals("equals", r.op); assertEquals("", r.value); assertEquals("assign_user", r.action)
        // A rule keeps targetUserIds and drops an emptied single target.
        val stored = BuilderRule.of(obj("""{"id":"r","operator":"equals","value":"x","action":"set_task_list","targetTaskListId":"s1","targetUserIds":["u"]}"""))
        val j = stored.copy(targetTaskListId = "").json()
        assertFalse("targetTaskListId" in j); assertTrue("targetUserIds" in j)
    }

    @Test fun duplicateDropsWhatBelongsToThisProject() {
        val f = BuilderField.of(obj("""{"id":"x","type":"dropdown","options":["A"],"routingRules":[{"id":"r","operator":"equals","value":"A","action":"assign_user","targetUserId":"u"}],
            "mapping":{"target":"custom_field","customFieldId":"cf1"}}"""))
        val d = f.duplicateJson()
        assertFalse("routingRules" in d); assertEquals(obj("""{"target":"custom_field"}"""), d["mapping"])
        assertEquals(JsonNull, BuilderField.of(obj("""{"id":"y","type":"text"}""")).duplicateJson()["mapping"])
    }

    @Test fun scheduleIsNormalisedAndSentWhole() {
        val s = BuilderSchedule.of(obj("""{"enabled":true,"daysOfWeek":[5,1,1,9,"3"],"startTime":"8:00","endTime":"17:30","override":"weird"}"""))
        assertEquals(listOf(1, 3, 5), s.days); assertEquals("00:00", s.start); assertEquals("17:30", s.end); assertEquals("Asia/Jakarta", s.timezone); assertEquals("", s.override)
        val off = BuilderSchedule.of(null)
        assertEquals(listOf(1, 2, 3, 4, 5), off.switched(true).days)
        val j = off.copy(override = "closed").json()
        assertEquals(setOf("enabled", "daysOfWeek", "startTime", "endTime", "timezone", "override"), j.keys)
        assertNull(BuilderSchedule.validTime("24:00"))
    }

    @Test fun formRowAndLink() {
        val f = BuilderForm(obj("""{"id":"f9","name":"Reimburse","slug":"reimburse","isPublic":true,"_count":{"submissions":3},"fields":[{"id":"a"},{"id":"b"}]}"""))
        assertEquals(3, f.submissions); assertEquals(2, f.fields.size)
        assertEquals("https://nexus.znetworks.id/f/reimburse", f.link)
        assertEquals("https://nexus.znetworks.id/f/f9", FormLink.url(null, "f9"))
    }
}
