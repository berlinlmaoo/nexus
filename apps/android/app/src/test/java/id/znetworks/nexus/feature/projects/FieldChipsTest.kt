package id.znetworks.nexus.feature.projects

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FieldChipsTest {
    private fun v(type: String, value: kotlinx.serialization.json.JsonElement?, options: kotlinx.serialization.json.JsonElement? = null) =
        CustomFieldValue("f", value, FieldRef("F", type, options))

    @Test fun eachTypeAsTheWeb() {
        assertEquals(FieldChip.Tone.SUCCESS, FieldChips.chip(v("STATUS", JsonPrimitive("Done")))!!.tone)
        assertEquals(FieldChip.Tone.WARNING, FieldChips.statusTone("on_progress"))
        assertEquals(FieldChip.Tone.DANGER, FieldChips.statusTone("Terhambat"))
        assertEquals(FieldChip.Tone.INFO, FieldChips.statusTone("Review"))
        assertEquals("a, b", FieldChips.chip(v("MULTI_SELECT", JsonArray(listOf(JsonPrimitive("a"), JsonPrimitive("b")))))!!.label)
        assertEquals("a, b", FieldChips.chip(v("MULTI_SELECT", JsonPrimitive("[\"a\",\"b\"]")))!!.label) // stored as text
        assertEquals("Kantor", FieldChips.chip(v("PLACE", buildJsonObject { put("label", "Kantor"); put("mapUrl", "") }))!!.label)
        assertNull(FieldChips.chip(v("PLACE", buildJsonObject { put("label", "") })))
        assertEquals("12", FieldChips.chip(v("NUMBER", JsonPrimitive("12")))!!.label)
        val idr = FieldChips.chip(v("NUMBER", JsonPrimitive("1500000"), buildJsonObject { put("format", "currency-idr") }))!!.label
        assertTrue(idr, idr.contains("1.500.000"))
        assertNull(FieldChips.chip(v("TEXT", JsonPrimitive("  "))))
        assertNull(FieldChips.chip(v("NUMBER", JsonPrimitive("abc"))))
    }
}
