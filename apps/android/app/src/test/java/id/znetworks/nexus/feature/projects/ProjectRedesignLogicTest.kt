package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** Project page redesign (HANDOFF scope 2/3): access levels, status options, saved views. */
class ProjectRedesignLogicTest {
    private val today = LocalDate.of(2026, 10, 13)

    @Test fun accessLevels() {
        val none = ProjectAccess(null, null)
        assertTrue(none.canEdit && none.canComment && none.canManage && none.canDelete); assertNull(none.readOnlyChip) // older server: nothing gated
        val view = ProjectAccess(AccessLevel.of("VIEW"), false)
        assertFalse(view.canEdit); assertFalse(view.canComment); assertFalse(view.canManage); assertEquals(AccessLevel.VIEW, view.readOnlyChip)
        val comment = ProjectAccess(AccessLevel.of("comment"), false)
        assertFalse(comment.canEdit); assertTrue(comment.canComment)
        val edit = ProjectAccess(AccessLevel.EDIT, true)
        assertTrue(edit.canEdit && edit.canDelete); assertFalse(edit.canManage); assertNull(edit.readOnlyChip)
        assertTrue(ProjectAccess(AccessLevel.FULL, null).canManage)
        assertNull(AccessLevel.of("OWNER")) // unknown → not gated
        assertEquals(AccessLevel.FULL, AccessLevel.ofMember("LEAD", null))
        assertEquals(AccessLevel.EDIT, AccessLevel.ofMember("MEMBER", "FULL")) // never Full from accessLevel
        assertEquals(AccessLevel.COMMENT, AccessLevel.ofMember("GUEST", "EDIT"))
        assertEquals(AccessLevel.VIEW, AccessLevel.ofMember("MEMBER", "VIEW"))
    }

    private val lanes = listOf(
        Lane("d", "Done", 0, taskStatus = "DONE"), Lane("p", "On Progress", 1, taskStatus = "IN_PROGRESS"),
        Lane("t", "To Do", 2, taskStatus = "TODO"), Lane("r", "Review", 3, taskStatus = "IN_REVIEW", color = "amber"),
    )

    @Test fun statusOptions() {
        assertEquals(listOf("t", "p", "r", "d"), StatusOptions.ordered(lanes).map { it.id })
        assertEquals("t", StatusOptions.defaultOption(lanes)?.id)
        assertEquals("yellow", StatusOptions.colorKey("amber", "IN_REVIEW"))
        assertEquals("green", StatusOptions.colorKey(null, "DONE"))
        assertEquals("gray", StatusOptions.colorKey("weird", null))
        // Legacy: plain sections keep their position order.
        val legacy = listOf(Lane("b", "B", 2), Lane("a", "A", 1))
        assertFalse(StatusOptions.inUse(legacy)); assertEquals("a", StatusOptions.defaultOption(legacy)?.id)
        assertEquals("IN_REVIEW", StatusOptions.statusFor(StatusOptions.Group.IN_PROGRESS, "Revisi klien"))
        assertEquals("CANCELLED", StatusOptions.statusFor(StatusOptions.Group.COMPLETE, "Batal"))
        assertEquals("DONE", StatusOptions.statusFor(StatusOptions.Group.COMPLETE, "Shipped"))
    }

    @Test fun columnsMoveWithinTheirGroup() {
        // ordered: t (To-do) | p, r (In progress) | d (Complete)
        assertEquals("r", StatusOptions.neighbour(lanes, "p", 1)?.id)
        assertNull(StatusOptions.neighbour(lanes, "p", -1)) // would cross into To-do
        assertNull(StatusOptions.neighbour(lanes, "r", 1))  // would cross into Complete
        assertNull(StatusOptions.neighbour(lanes, "t", -1))
    }

    private fun field(name: String, type: String = "SELECT", options: String = """{"options":["A","B"],"optionColors":{"B":"rose"}}""") =
        CustomFieldDef("f1", name, type, options = NexusJson.parseToJsonElement(options))

    @Test fun kategori() {
        assertTrue(StatusOptions.isCategory(field("Kategori"))); assertTrue(StatusOptions.isCategory(field("category 2")))
        assertFalse(StatusOptions.isCategory(field("Kategori", type = "TEXT"))); assertFalse(StatusOptions.isCategory(field("Kategori lama")))
        assertEquals("red", StatusOptions.optionColor(field("Kategori"), "B"))
        assertEquals("orange", StatusOptions.optionColor(field("Kategori"), "A")) // palette minus gray/brown, by index
    }

    private fun task(id: String, lane: String, due: String? = null, prio: String? = null, who: String? = null, status: String = "TODO", cat: String? = null) =
        BoardTask(id, "Task $id", status = status, priority = prio, dueDate = due, taskListId = lane,
            assignees = listOfNotNull(who?.let { Assignee(it, UserRef(it, "Name $it")) }),
            customFieldValues = listOfNotNull(cat?.let { CustomFieldValue("f1", JsonPrimitive(it)) }))

    private val tasks = listOf(
        task("1", "t", due = "2026-10-10", prio = "HIGH", who = "me", cat = "A"),
        task("2", "p", due = "2026-10-13", prio = "LOW", who = "you"),
        task("3", "d", status = "DONE", cat = "Z"),
    )

    @Test fun viewConfigDefaultsAndDecoding() {
        val body = """{"views":[
            {"id":"v1","name":null,"layout":"list","builtin":"list","position":1,"shared":true,"config":{}},
            {"id":"v2","name":"Mine","layout":"board","builtin":null,"position":0,"shared":false,"ownerId":"me","config":{"filter":{"simple":[{"id":"r","prop":"assignee","op":"any_of","value":["__me__"]}],"advanced":null},"groupBy":"cf:f1","brandNew":1}},
            {"id":"v3","layout":"gallery","builtin":"board","position":2}],"canEditShared":true}"""
        val r = NexusJson.decodeFromString(ProjectViewsResponse.serializer(), body)
        assertTrue(r.canEditShared)
        assertEquals(listOf("v2", "v1"), ViewsLogic.visible(r.views, setOf("board")).map { it.id }) // a hidden built-in is left out
        val list = ViewsLogic.config(r.views[0])
        assertEquals("section", list.groupBy); assertEquals("done", list.calc); assertTrue(list.hideEmptyGroups)
        val mine = ViewsLogic.config(r.views[1])
        assertEquals("cf:f1", mine.groupBy); assertTrue(mine.filtered); assertEquals("count", mine.calc)
        assertEquals("gallery", ViewsLogic.layoutOf(r.views[2])) // unknown layout → board
        assertEquals(listOf("fallback:board", "fallback:table", "fallback:gallery"), ViewsLogic.fallbacks(setOf("list", "calendar", "timeline")).map { it.id })
    }

    @Test fun filterSortGroup() {
        val meRule = ViewRule("r", "assignee", "any_of", listOf(ViewsLogic.ME))
        assertEquals(listOf("1"), ViewsLogic.filter(tasks, ViewConfig(rules = listOf(meRule)), "me", today).map { it.id })
        assertEquals(listOf("1"), ViewsLogic.filter(tasks, ViewConfig(rules = listOf(ViewRule("o", "due", "overdue", emptyList()))), "me", today).map { it.id })
        assertEquals(listOf("3"), ViewsLogic.filter(tasks, ViewConfig(rules = listOf(ViewRule("e", "due", "empty", emptyList()))), "me", today).map { it.id })
        // An unknown op or prop never hides a task.
        assertEquals(3, ViewsLogic.filter(tasks, ViewConfig(rules = listOf(ViewRule("x", "mood", "is", listOf("happy")), ViewRule("y", "priority", "fancy", emptyList()))), "me", today).size)
        assertEquals(listOf("2", "1", "3"), ViewsLogic.sort(tasks, ViewConfig(sort = listOf(ViewSort("due", true)))).map { it.id }) // no date stays last either way
        assertEquals(listOf("1", "2", "3"), ViewsLogic.sort(tasks, ViewConfig(sort = listOf(ViewSort("due", false)))).map { it.id })
        assertEquals(listOf("1", "2", "3"), ViewsLogic.sort(tasks, ViewConfig(sort = listOf(ViewSort("priority", false)))).map { it.id })

        val bySection = ViewsLogic.group(tasks, lanes, "section", emptyList())
        assertEquals(listOf("t", "p", "r", "d"), bySection.map { it.key }) // every section, status order, empty ones too
        assertEquals(StatusOptions.Group.COMPLETE, bySection.last().statusGroup)
        assertEquals("1/1", ViewsLogic.calc(bySection.last(), "done"))
        val byCat = ViewsLogic.group(tasks, lanes, "cf:f1", listOf(field("Kategori")))
        assertEquals(listOf("A", "B", "Z", ViewsLogic.NONE), byCat.map { it.key }) // options, extra values, then No value
        assertEquals(listOf("2"), byCat.last().tasks.map { it.id })
        val byPrio = ViewsLogic.group(tasks, lanes, "priority", emptyList())
        assertEquals(TaskEnums.PRIORITIES, byPrio.map { it.key }); assertEquals(listOf("3"), byPrio.last().tasks.map { it.id })
    }

    @Test fun viewPermissionsAndPatch() {
        val edit = ProjectAccess(AccessLevel.EDIT, true)
        val shared = ProjectView("v", layout = "board", shared = true)
        val mine = ProjectView("m", layout = "board", shared = false)
        assertFalse(ViewsLogic.canEditView(shared, edit, canEditShared = false)); assertTrue(ViewsLogic.canEditView(mine, edit, false))
        assertFalse(ViewsLogic.canEditView(mine, ProjectAccess(AccessLevel.COMMENT, false), true)) // below Can edit: nothing saved
        assertFalse(ViewsLogic.canEditView(ProjectView("fallback:board"), edit, true))
        assertFalse(ViewsLogic.canDeleteView(ProjectView("c", builtin = "category", shared = false), edit, true))
        val adv = NexusJson.parseToJsonElement("""{"mode":"or","rules":[]}""")
        val p = ViewsLogic.patchFor(listOf(ViewRule("r", "priority", "any_of", listOf("HIGH"))), listOf(ViewSort("due", true)), "priority", adv)
        assertEquals(adv, p["filter"]!!.jsonObject["advanced"]) // a web-made advanced filter is kept
        assertEquals("HIGH", p["filter"]!!.jsonObject["simple"]!!.jsonArray[0].jsonObject["value"]!!.jsonArray[0].let { (it as JsonPrimitive).content })
        assertEquals("desc", (p["sort"]!!.jsonArray[0] as JsonObject)["dir"].let { (it as JsonPrimitive).content })
    }
}
