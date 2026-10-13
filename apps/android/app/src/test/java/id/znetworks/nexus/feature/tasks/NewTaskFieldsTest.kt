package id.znetworks.nexus.feature.tasks

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NewTaskFieldsTest {
    @Test fun onlyFilledValuesAreSent() {
        assertFalse(FieldValues.filled(null)); assertFalse(FieldValues.filled(JsonPrimitive(" ")))
        assertFalse(FieldValues.filled(JsonArray(emptyList()))); assertFalse(FieldValues.filled(FieldValues.placeValue("", " ")))
        assertTrue(FieldValues.filled(JsonPrimitive("12"))); assertTrue(FieldValues.filled(JsonArray(listOf(JsonPrimitive("a")))))
        assertTrue(FieldValues.filled(FieldValues.placeValue("Kantor", "")))
    }
}
