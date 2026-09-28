package id.znetworks.nexus.feature.tasks

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.projects.CustomFieldsResponse
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class FieldValuesTest {
    @Test fun decodesEveryValueShape() {
        val r = NexusJson.decodeFromString(CustomFieldsResponse.serializer(), """{"fields":[
            {"id":"a","name":"Stage","type":"SELECT","options":{"options":["Lead","Won"]},"value":"Won","position":1},
            {"id":"b","name":"Tags","type":"MULTI_SELECT","options":["x","y"],"value":["y"],"position":0},
            {"id":"c","name":"Venue","type":"PLACE","value":{"label":"GBK","mapUrl":"https://maps.app/x"}},
            {"id":"d","name":"Budget","type":"number","value":null}],"libraryFields":[]}""")
        val f = r.fields.associateBy { it.id }
        assertEquals(listOf("Lead", "Won"), f["a"]!!.choices)
        assertEquals("Won", FieldValues.text(f["a"]!!.value))
        assertEquals(listOf("y"), FieldValues.list(f["b"]!!.value))
        assertEquals("GBK" to "https://maps.app/x", FieldValues.place(f["c"]!!.value))
        assertEquals("NUMBER", f["d"]!!.kind)
        assertEquals("", FieldValues.text(f["d"]!!.value))
    }

    @Test fun multiSelectTogglesAndPlaceBuildsTheObject() {
        assertEquals(listOf("x", "y"), FieldValues.toggled(listOf("x"), "y"))
        assertEquals(listOf("x"), FieldValues.toggled(listOf("x", "y"), "y"))
        val p = FieldValues.placeValue(" GBK ", "https://m")
        assertEquals(JsonObject(mapOf("label" to JsonPrimitive("GBK"), "mapUrl" to JsonPrimitive("https://m"))), p)
        assertEquals(JsonArray(emptyList()), JsonArray(FieldValues.toggled(listOf("x"), "x").map { JsonPrimitive(it) }))
    }
}
