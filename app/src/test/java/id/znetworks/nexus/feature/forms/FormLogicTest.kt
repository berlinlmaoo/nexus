package id.znetworks.nexus.feature.forms

import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FormLogicTest {
    private fun cond(op: String, v: String = "") = FormCondition("a", op, v)

    @Test fun absentIsEmptyStringButEmptiedMultiIsNot() {
        assertTrue(FormLogic.evaluate(cond("equals", ""), emptyMap()))
        assertFalse(FormLogic.evaluate(cond("equals", ""), mapOf("a" to FormValue.Choices(emptyList()))))
        assertTrue(FormLogic.evaluate(cond("is_empty"), mapOf("a" to FormValue.Choices(emptyList()))))
    }

    @Test fun operators() {
        val v = mapOf("a" to FormValue.Choices(listOf("Jakarta", "Bandung")))
        assertTrue(FormLogic.evaluate(cond("equals", "Bandung"), v))
        assertTrue(FormLogic.evaluate(cond("not_equals", "Bali"), v))
        assertTrue(FormLogic.evaluate(cond("contains", "band"), v))
        assertTrue(FormLogic.evaluate(cond("contains", ""), v)) // JS includes("")
        assertTrue(FormLogic.evaluate(cond("is_not_empty"), v))
        assertTrue(FormLogic.evaluate(cond("weird"), v))       // unknown shows the field
        assertTrue(FormLogic.evaluate(cond("equals", "true"), mapOf("a" to FormValue.Flag(true))))
    }

    @Test fun requiredCheckboxMustBeTickedAndHiddenFieldsAreSkipped() {
        val fields = listOf(
            FormField("a", label = "Agree", type = "checkbox", required = true),
            FormField("b", label = "Why", type = "text", required = true, showIf = FormCondition("a", "equals", "true")),
            FormField("h", label = "Head", type = "section", required = true),
        )
        val vals = mapOf<String, FormValue>("a" to FormValue.Flag(false))
        val vis = FormLogic.visible(fields, vals)
        assertEquals(listOf("a", "h"), vis.map { it.id })
        assertEquals(listOf("Agree"), FormLogic.missingRequired(vis, vals))
    }

    @Test fun dataPartShapes() {
        val u = FormUpload("file:f", "a.pdf", "application/pdf", 10, "content://x")
        val fields = listOf(FormField("t"), FormField("m", type = "multi_select"), FormField("c", type = "checkbox"), FormField("f", type = "file"))
        val d = FormLogic.data(fields, mapOf("t" to FormValue.Text("x"), "m" to FormValue.Choices(listOf("1", "2")), "c" to FormValue.Flag(true),
            "f" to FormValue.Files(listOf(u, u.copy(filename = "b.pdf")))), mapOf("t" to u.copy(partName = "attachment:t", filename = "extra.jpg")))
        assertEquals("x", d["t"]); assertEquals(listOf("1", "2"), d["m"]); assertEquals(true, d["c"]); assertEquals("a.pdf,b.pdf", d["f"])
        assertEquals("extra.jpg", d["attachment:t"])
    }

    @Test fun decodesFieldsLeniently() {
        val f = NexusJson.decodeFromString(FormDef.serializer(), """{"id":"x","name":"Reimburse","fields":[{"id":"a","label":"Kota","type":"dropdown",
            "options":{"choices":["A",true,3]},"required":true,"showIf":{"fieldId":"b","operator":"equals","value":"y"},"extra":1}]}""")
        assertEquals(listOf("A", "true", "3"), f.fields.single().choices)
        assertEquals("equals", f.fields.single().showIf?.operator)
    }

    @Test fun formLinks() {
        assertEquals(Target.Form("reimburse-2026"), Links.parse("https://nexus.znetworks.id/f/reimburse-2026"))
        assertEquals(Target.Submissions("s1"), Links.parse("/submissions?id=s1"))
    }
}
