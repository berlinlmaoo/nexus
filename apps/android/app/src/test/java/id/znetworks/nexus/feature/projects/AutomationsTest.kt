package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.RealtimeEvents
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** DEV-REDESIGN.md §2 (12 Oct 2026): automations read in plain words, toggled by leads, run log, Run now, live. */
class AutomationsTest {
    // The app's English strings, so the sentences below are what a person reads.
    private val texts = Regex("<string name=\"([a-z0-9_]+)\">(.*?)</string>").findAll(File("src/main/res/values/strings.xml").readText())
        .associate { it.groupValues[1] to it.groupValues[2].replace("\\'", "'") }
    private val names = R.string::class.java.fields.associate { it.getInt(null) to it.name }
    private val say: Say = { id, args -> String.format(texts.getValue(names.getValue(id)), *args) }
    private val project = AutomationNames(sections = mapOf("l1" to "Published"), people = mapOf("u1" to "Ayu"), fields = mapOf("f1" to "Platform"))

    // The server's lists (lib/automation-rules.ts TRIGGER_TYPES / ACTION_TYPES, nexus-dev ef89b80).
    private val triggers = listOf("TASK_CREATED", "TASK_UPDATED", "STATUS_CHANGED", "TASK_COMPLETED", "ASSIGNEE_CHANGED", "FIELD_CHANGED",
        "DUE_DATE_APPROACHING", "DUE_DATE_REACHED", "COMMENT_ADDED", "FORM_SUBMITTED", "SCHEDULED", "WEBHOOK_RECEIVED" /* removed 12 Oct 2026, still labelled */)
    private val actions = listOf("SET_STATUS", "MARK_COMPLETE", "SET_PRIORITY", "ASSIGN_TO", "UNASSIGN", "SET_FIELD", "MOVE_TO_SECTION", "ADD_TAG",
        "REMOVE_TAG", "ADD_COMMENT", "SEND_NOTIFICATION", "CREATE_TASK", "CREATE_SUBTASK", "DUPLICATE_TASK", "ARCHIVE_TASK")

    private fun rule(json: String) = NexusJson.decodeFromString(Rule.serializer(), json)

    @Test fun everyTypeHasALabel() {
        assertEquals(triggers.toSet(), AutomationText.TRIGGERS.keys)
        assertEquals(actions.toSet(), AutomationText.ACTIONS.keys)
        assertEquals(setOf("is", "is_not", "contains", "not_contains", "is_empty", "is_not_empty", "gt", "lt", "overdue", "within_days"), AutomationText.OPS.keys)
        assertEquals(setOf("SUCCESS", "PARTIAL", "FAILED", "SKIPPED", "RUNNING"), AutomationText.RUN_STATUS.keys)
        // Unknown types show as sent, never crash.
        assertEquals("NEW_THING", AutomationText.trigger(rule("""{"type":"NEW_THING"}"""), project, say))
    }

    @Test fun triggersInPlainWords() {
        assertEquals("Status changed to Done", AutomationText.trigger(rule("""{"type":"STATUS_CHANGED","value":"DONE"}"""), project, say))
        assertEquals("Status changed from To do to Done", AutomationText.trigger(rule("""{"type":"STATUS_CHANGED","value":"DONE","config":{"from":"TODO"}}"""), project, say))
        assertEquals("Ayu assigned", AutomationText.trigger(rule("""{"type":"ASSIGNEE_CHANGED","value":"u1"}"""), project, say))
        assertEquals("Platform changed", AutomationText.trigger(rule("""{"type":"FIELD_CHANGED","field":"cf:f1"}"""), project, say))
        assertEquals("Priority changed to High", AutomationText.trigger(rule("""{"type":"FIELD_CHANGED","field":"priority","value":"HIGH"}"""), project, say))
        assertEquals("48h before due", AutomationText.trigger(rule("""{"type":"DUE_DATE_APPROACHING","value":"48"}"""), project, say))
        assertEquals("24h before due", AutomationText.trigger(rule("""{"type":"DUE_DATE_APPROACHING"}"""), project, say))
        assertEquals("Weekly Mon, Thu 09:00 WIB", AutomationText.trigger(rule("""{"type":"SCHEDULED","config":{"frequency":"weekly","time":"09:00","days":[4,1]}}"""), project, say))
        assertEquals("Monthly on day 5 08:30 WIB", AutomationText.trigger(rule("""{"type":"SCHEDULED","config":{"frequency":"monthly","time":"08:30","dayOfMonth":5}}"""), project, say))
        assertEquals("Task completed", AutomationText.trigger(rule("""{"type":"TASK_COMPLETED"}"""), project, say))
    }

    @Test fun actionsAndConditions() {
        assertEquals("Move to section: Published", AutomationText.action(rule("""{"type":"MOVE_TO_SECTION","value":"l1"}"""), project, say))
        assertEquals("Assign to: Assignees, Ayu", AutomationText.action(rule("""{"type":"ASSIGN_TO","value":"@assignees,u1"}"""), project, say))
        assertEquals("Set priority: High", AutomationText.action(rule("""{"type":"SET_PRIORITY","value":"HIGH"}"""), project, say))
        assertEquals("Set a field: Platform = TikTok", AutomationText.action(rule("""{"type":"SET_FIELD","field":"cf:f1","value":"TikTok"}"""), project, say))
        assertEquals("Send notification: Project leads", AutomationText.action(rule("""{"type":"SEND_NOTIFICATION","config":{"to":["@leads"]}}"""), project, say))
        assertEquals("Mark complete", AutomationText.action(rule("""{"type":"MARK_COMPLETE"}"""), project, say))
        fun cond(json: String) = AutomationText.condition(NexusJson.decodeFromString(ConditionRule.serializer(), json), project, say)
        assertEquals("Priority is High", cond("""{"field":"priority","op":"is","value":"HIGH"}"""))
        assertEquals("Due date is overdue", cond("""{"field":"dueDate","op":"overdue"}"""))
        assertEquals("Due date is within the next 3 days", cond("""{"field":"dueDate","op":"within_days","value":"3"}"""))
        assertEquals("Assignee is empty", cond("""{"field":"assignee","op":"is_empty"}"""))
        assertEquals("Section is not Published", cond("""{"field":"section","op":"is_not","value":"l1"}"""))
    }

    @Test fun theListAnswerAndItsSummary() {
        val r = NexusJson.decodeFromString(AutomationsResponse.serializer(), """{"canEdit":false,"automations":[{"id":"a","name":"Ping lead","enabled":true,
            "trigger":{"type":"STATUS_CHANGED","value":"DONE"},"action":{"type":"ADD_COMMENT","value":"Done!"},
            "actions":[{"type":"ADD_COMMENT","value":"Done!"},{"type":"SEND_NOTIFICATION","config":{"to":["@leads"]}}],
            "conditions":{"match":"all","rules":[{"field":"priority","op":"is","value":"HIGH"},{"field":"assignee","op":"is_not_empty"}]},
            "lastRunAt":"2026-10-12T02:00:00.000Z","lastRunStatus":"SUCCESS","runCount":3,"nextRunAt":null}]}""")
        assertFalse(r.canEdit)
        val a = r.automations.single()
        assertEquals(2, a.steps.size)
        assertEquals("When Status changed to Done · 2 conditions → Add comment: “Done!”, Send notification: Project leads", AutomationText.summary(a, project, say))
        // An old row: only `action`.
        val old = NexusJson.decodeFromString(Automation.serializer(), """{"id":"b","trigger":{"type":"TASK_CREATED"},"action":{"type":"MARK_COMPLETE"}}""")
        assertEquals("When Task created → Mark complete", AutomationText.summary(old, project, say))
        val runs = NexusJson.decodeFromString(AutomationRunsResponse.serializer(), """{"hasMore":true,"runs":[{"id":"r","createdAt":"2026-10-12T02:00:00.000Z",
            "event":"manual","status":"PARTIAL","steps":[{"type":"ADD_COMMENT","ok":true,"message":"Comment added"},{"type":"CALL_WEBHOOK","ok":false,"message":"timeout"}],
            "durationMs":120,"taskId":"t","task":null,"actor":{"id":"u1","name":"Ayu"}}]}""")
        assertTrue(runs.hasMore); assertEquals(listOf(true, false), runs.runs.single().steps.map { it.ok }); assertNull(runs.runs.single().task)
        assertNull(NexusJson.decodeFromString(RunNowResponse.serializer(), """{"run":null,"skipped":true,"reason":"x"}""").run)
    }

    @Test fun liveAndTheSystemActor() {
        assertTrue(RealtimeEvents.AUTOMATIONS_CHANGED in RealtimeEvents.LISTENED)
        val e = RealtimeEvents.parse("automations-changed", """{"projectId":"p","automationId":"a","actorId":"u"}""")
        assertEquals("p", e.projectId); assertEquals("a", e.taskId)
        assertTrue(SystemActors.isAutomation(UserRef(id = "x", name = "Automation", avatar = "/api/system-avatars/automation.png")))
        assertTrue(SystemActors.isAutomation(UserRef(id = "x", email = "automation@nexus.invalid")))
        assertFalse(SystemActors.isAutomation(UserRef(id = "x", name = "Automation")))
        assertFalse(SystemActors.isAutomation(null))
    }

    @Test fun wiring() {
        val dir = "src/main/java/id/znetworks/nexus/feature/projects"
        val tab = File("$dir/AutomationsTab.kt").readText()
        assertTrue(tab.contains("Switch(on, onToggle, enabled = canEdit)"))
        assertTrue(tab.contains("if (canEdit) RunNowBar("))
        assertTrue(tab.contains("it.name == RealtimeEvents.AUTOMATIONS_CHANGED && it.projectId == projectId"))
        val api = File("$dir/ProjectsApi.kt").readText()
        assertTrue(api.contains("/api/automations/runs?automationId=")); assertTrue(api.contains("post(\"/api/automations/run\""))
        assertTrue(File("$dir/ProjectDetailScreen.kt").readText().contains("AutomationsTab(vm.projectId, s.lanes, s.detail!!.members)"))
        val task = File("src/main/java/id/znetworks/nexus/feature/tasks/TaskDetailScreen.kt").readText()
        assertEquals(4, Regex("authorName\\(").findAll(task).count())
        val keys = Regex("R\\.string\\.(au_[a-z0-9_]+)").findAll(File("$dir/AutomationText.kt").readText() + File("$dir/AutomationsTab.kt").readText())
            .map { it.groupValues[1] }.toSet()
        listOf("values", "values-in").forEach { v ->
            val s = File("src/main/res/$v/strings.xml").readText()
            keys.forEach { assertEquals("$v $it", 1, Regex("name=\"$it\"").findAll(s).count()) }
        }
    }
}
