package id.znetworks.nexus.feature.outlet

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class OutletCustomTest {
    private fun obj(s: String) = NexusJson.parseToJsonElement(s) as JsonObject
    @Test fun customFieldsIncludeUsedArchivedItemsAndRetainCommunityTotals() {
        val d = OutletMonth(obj("""{"config":{"rsvp":[{"id":"vip","label":"VIP"},{"id":"old","label":"Old","archived":true},{"id":"unused","label":"Unused","archived":true}],"hosting":[],"communities":[{"id":"club","name":"Club","mode":"breakdown","items":[{"id":"team","label":"Team"}]}]}}"""))
        val e = OutletEvent(obj("""{"values":{"old":0,"club":4,"team":2},"communityTotals":{"club":6}}"""))
        val fields = d.reportForm(e, "archived", "Total only").fields.map { it.key }
        assertTrue(fields.containsAll(listOf("value:vip", "value:old", "value:club", "value:team")))
        assertFalse(fields.contains("value:unused"))
        assertEquals(0.0, e.number("value:old")!!, 0.0)
        assertEquals(6.0, e.number("community:club")!!, 0.0)
        assertFalse(d.reportForm(null, "archived", "Total only").fields.any { it.key == "value:old" })
    }
    @Test fun editsUseNestedValuesAndNeverResendUnchangedItems() {
        val form = OutletForm(listOf(OutletSection("rsvp", OutletText("RSVP", "RSVP"), "rsvpTotal", listOf(
            OutletField("value:vip", "count", OutletText("VIP", "VIP"), false, null, null),
            OutletField("value:team", "count", OutletText("Team", "Team"), false, null, null)))))
        val original = mapOf("value:vip" to "10", "value:team" to "5")
        assertEquals(obj("""{"values":{"vip":null}}"""), outletValues(OutletDraft.changes(form, original, original + ("value:vip" to ""))))
        assertEquals(obj("""{"name":"Night","values":{"vip":0}}"""), outletValues(obj("""{"name":"Night","value:vip":0}""")))
    }
    @Test fun newIdsAreMintedByServerAndExistingIdsNeverChange() {
        val config = obj("""{"version":1,"rsvp":[{"id":"rsvpTeam","label":"Team"},{"id":"local_a","_local":true,"label":"VIP"}],"communities":[{"id":"local_c","_local":true,"name":"Club","mode":"breakdown","items":[{"id":"local_i","_local":true,"label":"Members"}]}]}""")
        val clean = outletConfigForSave(config)
        assertEquals(obj("""{"version":1,"rsvp":[{"id":"rsvpTeam","label":"Team"},{"label":"VIP"}],"communities":[{"name":"Club","mode":"breakdown","items":[{"label":"Members"}]}]}"""), clean)
    }
}
