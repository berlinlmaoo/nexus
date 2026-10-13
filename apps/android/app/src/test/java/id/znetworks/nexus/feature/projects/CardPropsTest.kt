package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.util.Locale

/** Card / table properties like the web (lib/project-views.ts visibleProps + view-layouts.tsx PropValue), 14 Oct 2026. */
class CardPropsTest {
    private val today = LocalDate.of(2026, 10, 14)
    private val harga = CustomFieldDef("harga", "Harga", "NUMBER", 0, NexusJson.parseToJsonElement("""{"format":"currency-idr"}"""))
    private val tanggal = CustomFieldDef("tgl", "Tanggal Penggunaan", "DATE", 1)
    private val request = CustomFieldDef("req", "Request by", "CREATED", 2, NexusJson.parseToJsonElement("""{"editable":true}"""))
    private val kategori = CustomFieldDef("kat", "Kategori", "SELECT", 3,
        NexusJson.parseToJsonElement("""{"options":["PATS Socials","SBU","Nightlife"],"optionColors":{"SBU":"yellow","Nightlife":"green","PATS Socials":"orange"}}"""))
    private val fields = listOf(kategori, request, harga, tanggal)

    private fun cf(id: String, v: String) = CustomFieldValue(id, JsonPrimitive(v))

    @Test fun boardDefaultsFollowTheWebOrder() {
        // Fields by position, between tags and due (web defaultVisibleProps "board").
        assertEquals(listOf("priority", "tags", "cf:harga", "cf:tgl", "cf:req", "cf:kat", "due", "subtasks", "comments", "assignee"),
            CardProps.defaults("board", fields))
        assertEquals(listOf("assignee", "due", "priority", "status", "tags"), CardProps.defaults("table", fields))
    }

    @Test fun statusMeansTheOptionWithStatusOptions() {
        assertEquals(listOf("assignee", "due", "priority", "section", "tags"), CardProps.visible(null, "table", fields, statusOptions = true))
        assertEquals(listOf("assignee", "due", "priority", "status", "tags"), CardProps.visible(null, "table", fields, statusOptions = false))
        // A saved choice wins; a deleted field and "title" drop out; "status" + "section" become one.
        assertEquals(listOf("cf:harga", "section"), CardProps.visible(listOf("title", "cf:harga", "cf:gone", "status", "section"), "board", fields, statusOptions = true))
    }

    @Test fun rupiahLikeTheWeb() {
        assertEquals("Rp 350.000", CardProps.number("350000", "currency-idr"))
        // A legacy "369.000" is Rp 369.000, not 369.
        assertEquals("Rp 369.000", CardProps.number("369.000", "currency-idr"))
        assertEquals("1,234.5", CardProps.number("1234.5", null, Locale.US))
        assertNull(CardProps.number("", "currency-idr"))
    }

    @Test fun financeCardShowsWhatTheWebShows() {
        // "reimburse claude" on the dev server: Medium, Rp 350.000, ryan ceo pats (a CREATED field holding a name), SBU.
        val t = BoardTask("t1", "reimburse claude", status = "IN_PROGRESS", priority = "MEDIUM",
            customFieldValues = listOf(cf("harga", "350000"), cf("tgl", ""), cf("req", "ryan ceo pats"), cf("kat", "SBU")))
        val items = CardProps.items(t, CardProps.visible(null, "board", fields, true), fields, emptyList(), emptyMap(), today)
        assertEquals(listOf("priority", "cf:harga", "cf:req", "cf:kat"), items.map { it.key })
        assertEquals(CardProps.Item.Priority("priority", "MEDIUM"), items[0])
        assertEquals(CardProps.Item.Number("cf:harga", "Rp 350.000"), items[1])
        assertEquals(CardProps.Item.When("cf:req", null, "ryan ceo pats", false), items[2])
        assertEquals(CardProps.Item.Options("cf:kat", listOf("SBU" to "yellow"), 0), items[3])
    }

    @Test fun overdueOnlyForAnOpenTasksDueDate() {
        val open = BoardTask("a", dueDate = "2026-10-01T00:00:00.000Z", startDate = "2026-09-01")
        assertEquals(true, (CardProps.item(open, "due", fields, emptyList(), emptyMap(), today) as CardProps.Item.When).overdue)
        assertEquals(false, (CardProps.item(open, "start", fields, emptyList(), emptyMap(), today) as CardProps.Item.When).overdue)
        val done = open.copy(status = "DONE")
        assertEquals(false, (CardProps.item(done, "due", fields, emptyList(), emptyMap(), today) as CardProps.Item.When).overdue)
        assertNull(CardProps.item(BoardTask("b"), "due", fields, emptyList(), emptyMap(), today))
        assertNull(CardProps.item(BoardTask("b", priority = "NONE"), "priority", fields, emptyList(), emptyMap(), today))
    }

    @Test fun assigneesAndTheStatusOption() {
        val lanes = listOf(Lane("l1", "On Progress", taskStatus = "IN_PROGRESS"))
        val t = BoardTask("a", taskListId = "l1", assignees = listOf(Assignee("u1", UserRef("u1", "Geraldo Valentino"))))
        assertEquals(CardProps.Item.Section("section", "On Progress", "blue"), CardProps.item(t, "section", fields, lanes, emptyMap(), today))
        val people = CardProps.item(t, "assignee", fields, lanes, emptyMap(), today) as CardProps.Item.People
        assertEquals("Geraldo Valentino", people.people.single().first)
    }

    @Test fun linkedTasksFromTheProjectPayload() {
        // The shape of GET /api/projects/{id} on the dev server (Finance PATS, 14 Oct): the same task linked into two sections.
        val linked = """{"id":"x","position":0,"task":{"id":"k1","title":"PENGAJUAN DANA","status":"DONE","priority":"HIGH","tags":[],
            "taskList":{"id":"d","name":"Done","projectId":"sbu","project":{"id":"sbu","name":"SPECIAL BUSINESS UNIT"}}}}"""
        val open = """{"id":"y","task":{"id":"k2","title":"FOLLOW UP","status":"TODO","taskList":{"id":"d","projectId":"sbu","project":{"id":"sbu","name":"SPECIAL BUSINESS UNIT"}}}}"""
        val own = """{"id":"z","task":{"id":"k3","title":"mine","taskList":{"id":"q","projectId":"fin"}}}"""
        val lanes = NexusJson.decodeFromString(kotlinx.serialization.builtins.ListSerializer(Lane.serializer()),
            """[{"id":"a","name":"On Progress","taskProjects":[$linked,$own]},{"id":"b","name":"Done","taskProjects":[$linked,$open]}]""")
        val out = BoardLogic.linkedLanes(lanes, "fin")
        assertEquals(1, out.size)
        assertEquals("SPECIAL BUSINESS UNIT", out[0].name)
        // Each task once, open before done; the project's own task is not "linked".
        assertEquals(listOf("k2", "k1"), out[0].tasks.map { it.id })
        assertTrue(BoardLogic.linkedLanes(lanes, "fin") { it.status != "DONE" }.single().tasks.all { it.id == "k2" })
    }
}
