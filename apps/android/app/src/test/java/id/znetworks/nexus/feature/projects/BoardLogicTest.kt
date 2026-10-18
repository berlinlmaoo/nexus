package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BoardLogicTest {
    @Test fun manualOrderBreaksTiesByCreationThenId() {
        val a = BoardTask("a", position = 0, createdAt = "2026-10-18T01:00:00Z")
        val b = a.copy(id = "b")
        val older = a.copy(id = "z", createdAt = "2026-10-17T01:00:00Z")
        val laterPosition = older.copy(id = "p", position = 1)
        val shuffled = listOf(b, laterPosition, a, older)
        val result = BoardLogic.mergeSubtasks(listOf(Lane("lane", tasks = shuffled)), emptyList())
        assertEquals(listOf("z", "a", "b", "p"), result.single().tasks.map { it.id })
    }
    private fun t(id: String, title: String = id, lane: String = "L1", parent: String? = null, who: String? = null) =
        BoardTask(id, title, taskListId = lane, parentId = parent, assignees = listOfNotNull(who?.let { Assignee(user = UserRef(name = it)) }))

    @Test fun subtasksSitUnderTheirParentOrphansAtTheEnd() {
        val lanes = listOf(Lane("L1", "Todo", tasks = listOf(t("A"), t("B"))), Lane("L2", "Done", tasks = listOf(t("C", lane = "L2"))))
        val all = listOf(t("a1", "sub of A", parent = "A"), t("c1", "sub of C in L1", parent = "C"), t("b1", "sub of B", parent = "B"))
        val merged = BoardLogic.mergeSubtasks(lanes, all)
        assertEquals(listOf("A", "a1", "B", "b1", "c1"), merged[0].tasks.map { it.id })
        assertEquals("A", merged[0].tasks[1].parentTitle)
        assertEquals("C", merged[0].tasks[4].parentTitle)
        assertEquals(listOf("C"), merged[1].tasks.map { it.id })
    }

    @Test fun everyWordMustMatchInAnyOrder() {
        val task = t("x", "Kirim invoice klien", who = "Budi Santoso")
        assertTrue(BoardLogic.matches(task, "Doing", BoardLogic.tokens("budi invoice")))
        assertTrue(BoardLogic.matches(task, "Doing", BoardLogic.tokens("INVOICE doing")))
        assertFalse(BoardLogic.matches(task, "Doing", BoardLogic.tokens("budi kontrak")))
    }

    @Test fun moveIsLocalAndIdempotent() {
        val lanes = listOf(Lane("L1", tasks = listOf(t("A"))), Lane("L2", tasks = emptyList()))
        val moved = BoardLogic.move(lanes, "A", "L2")
        assertEquals(emptyList<String>(), moved[0].tasks.map { it.id })
        assertEquals("L2", moved[1].tasks.single().taskListId)
        assertEquals(moved, BoardLogic.move(moved, "A", "L2"))
    }

    @Test fun projectDetailDecodesWithUnknownFields() {
        val json = """{"id":"p","name":"Konten","taskLists":[{"id":"L1","name":"Todo","position":0,"tasks":[
          {"id":"t1","title":"Shoot","status":"TODO","priority":"HIGH","assignees":[{"user":{"id":"u","name":"Ana","avatar":null}}],
           "subtasks":[{"id":"s","status":"DONE"}],"_count":{"comments":2},"customFieldValues":[{"customFieldId":"f","value":["a","b"],"customField":{"name":"Tags","type":"MULTI_SELECT","options":{"options":["a","b"]}}}],
           "quests":[{"id":"q","title":"Q","xpReward":10}],"newThing":{"x":1}}],"taskProjects":[]}],
          "members":[{"userId":"u","role":"LEAD","user":{"id":"u","name":"Ana"}}],"customFields":[],"tableColumns":null}"""
        val d = NexusJson.decodeFromString(ProjectDetail.serializer(), json)
        val card = d.taskLists.single().tasks.single()
        assertEquals(1, card.doneSubs); assertEquals(2, card.count?.comments); assertEquals(10, card.questXp)
        assertEquals("a, b", valueText(card.customFieldValues.single().value))
        assertEquals(listOf("a", "b"), optionList(card.customFieldValues.single().customField?.options))
        val list = NexusJson.decodeFromString(ListSerializer(BoardTask.serializer()),
            """[{"id":"t","title":"x","taskList":{"id":"L","name":"Todo","projectId":"p","project":{"id":"p","name":"Konten"}},"parentId":null}]""")
        assertEquals("p", list.single().projectId)
    }
}
