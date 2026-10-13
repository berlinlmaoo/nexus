package id.znetworks.nexus.feature.forms

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.projects.CustomFieldDef
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** The form studio (web FormStudio, iOS FormStudioViews / FormBuilderView): its pure rules and the autosave. */
class FormStudioTest {
    private fun obj(s: String) = NexusJson.parseToJsonElement(s).jsonObject
    private fun field(s: String) = BuilderField.of(obj(s))

    @Test fun kindsAreAViewOverTypeAndFormat() {
        assertEquals(FormQuestionKind.RUPIAH, field("""{"id":"a","type":"number","numberFormat":"currency-idr"}""").questionKind)
        assertEquals(FormQuestionKind.DROPDOWN, field("""{"id":"a","type":"select"}""").questionKind)
        assertEquals(FormQuestionKind.TEXT, field("""{"id":"a","type":"section"}""").questionKind)
        assertEquals(FormQuestionKind.PHONE, field("""{"id":"a","type":"phone"}""").questionKind)
        // withKind keeps what still applies.
        val t = field("""{"id":"a","type":"text","autofill":"name","attachmentEnabled":true}""")
        val choice = t.withKind(FormQuestionKind.DROPDOWN)
        assertEquals("dropdown", choice.type); assertEquals(listOf(""), choice.options); assertEquals("", choice.autofill)
        assertEquals("number", t.withKind(FormQuestionKind.RUPIAH).type); assertEquals("currency-idr", t.withKind(FormQuestionKind.RUPIAH).numberFormat)
        assertFalse(t.withKind(FormQuestionKind.FILE).attachmentEnabled)
        assertEquals("", field("""{"id":"a","type":"dropdown","display":"list"}""").withKind(FormQuestionKind.MULTI_SELECT).display)
        val fresh = BuilderField.fresh(FormQuestionKind.MULTI_SELECT)
        assertEquals("multi_select", fresh.type); assertTrue(fresh.id.startsWith("field_"))
    }

    @Test fun descriptionAndDisplayKeysOnlyWhenChanged() {
        val f = field("""{"id":"a","name":"Q","label":"Q","type":"dropdown","required":false,"options":["A"],"description":"help"}""")
        assertEquals("help", f.description)
        assertFalse("description" in f.copy(description = null).json())
        assertEquals(JsonPrimitive("list"), f.copy(display = "list").json()["display"])
        assertEquals(f.raw, f.json())
    }

    @Test fun ruleSetFieldTargetsRideAndDropWhenEmptied() {
        val r = BuilderRule.of(obj("""{"id":"r","operator":"equals","value":"A","action":"set_field","targetCustomFieldId":"cf","targetValue":"X"}"""))
        assertEquals("cf", r.targetCustomFieldId); assertEquals("X", r.targetValue)
        assertEquals(r.raw, r.json())
        val j = r.copy(targetCustomFieldId = "", targetValue = "").json()
        assertFalse("targetCustomFieldId" in j); assertFalse("targetValue" in j)
    }

    @Test fun scheduleKeepsTheOneOffWindow() {
        val s = BuilderSchedule.of(obj("""{"enabled":false,"opensAt":"2026-10-20T01:00:00.000Z","closesAt":"2026-10-30T10:00:00.000Z"}"""))
        assertEquals("2026-10-20T01:00:00.000Z", s.opensAt)
        val j = s.json()
        assertEquals(JsonPrimitive("2026-10-30T10:00:00.000Z"), j["closesAt"])
        assertFalse("opensAt" in s.copy(opensAt = "").json())
    }

    @Test fun cleanJsonDropsALogicWithNoValue() {
        val f = field("""{"id":"b","type":"text","showIf":{"fieldId":"a","operator":"equals","value":"1"}}""")
        assertEquals(JsonNull, f.copy(showIf = BuilderCondition("a", "equals", " ")).cleanJson()["showIf"])
        // "is empty" needs no value: it stays.
        assertNotEquals(JsonNull, f.copy(showIf = BuilderCondition("a", "is_empty", "")).cleanJson()["showIf"])
    }

    @Test fun duplicatedQuestionNeverNamesTheTask() {
        val f = field("""{"id":"a","name":"Title","type":"text","mapping":{"target":"task_title"}}""")
        val d = f.duplicated()
        assertNotEquals(f.id, d.id); assertEquals(JsonPrimitive(d.id), d.json()["id"]); assertEquals("none", d.mappingTarget)
        val (list, copy) = FormStudioLogic.duplicate(listOf(f, field("""{"id":"b"}""")), "a")!!
        assertEquals(listOf("a", copy.id, "b"), list.map { it.id })
    }

    @Test fun brandingAndSettingsKeepUnknownKeysAndEmptyBecomesNull() {
        val b = FormBranding.of(obj("""{"icon":"📝","cover":"preset:dusk","future":1}"""))
        assertEquals("dusk", b.preset?.key); assertEquals(3, b.preset?.colors?.size)
        assertEquals(obj("""{"cover":"preset:dusk","future":1}"""), b.copy(icon = "").json())
        assertEquals(JsonNull, FormBranding.of(null).json())
        assertNull(b.copy(cover = "https://x/y.png").preset)

        val s = FormStudioSettings.of(obj("""{"submitLabel":"Go","responseLimit":25,"notifyUserIds":["u1","u2"],"extra":true}"""))
        assertEquals(25, s.responseLimit); assertEquals(listOf("u1", "u2"), s.notifyUserIds)
        assertEquals(obj("""{"submitLabel":"Go","responseLimit":25,"notifyUserIds":["u1","u2"],"extra":true}"""), s.json())
        assertEquals(obj("""{"submitLabel":"Go","responseLimit":25,"extra":true}"""), s.duplicateJson())
        assertEquals(JsonNull, FormStudioSettings.of(obj("""{"responseLimit":0}""")).json())
        assertEquals(0, FormStudioSettings.of(obj("""{"responseLimit":"9"}""")).responseLimit)
    }

    @Test fun logicParentsRefuseLoops() {
        val a = field("""{"id":"a","type":"dropdown","options":["x"]}""")
        val b = field("""{"id":"b","type":"text","showIf":{"fieldId":"a","operator":"equals","value":"x"}}""")
        val c = field("""{"id":"c","type":"text","showIf":{"fieldId":"b","operator":"is_not_empty","value":""}}""")
        val all = listOf(a, b, c)
        // a may not depend on b or c: both are shown only after a.
        assertEquals(emptyList<String>(), FormStudioLogic.logicParents(all, "a").map { it.id })
        assertEquals(listOf("a", "b"), FormStudioLogic.logicParents(all, "c").map { it.id })
        // The closest question above with options.
        assertEquals("a", FormStudioLogic.defaultParent(all, "c")?.id)
        assertNull(FormStudioLogic.defaultParent(listOf(a), "a"))
    }

    @Test fun staleOptions() {
        val a = field("""{"id":"a","type":"dropdown","options":["Yes"," No "]}""")
        assertTrue(FormStudioLogic.staleOption(a, "equals", "Maybe"))
        assertFalse(FormStudioLogic.staleOption(a, "equals", "No"))
        assertFalse(FormStudioLogic.staleOption(a, "equals", " "))
        assertFalse(FormStudioLogic.staleOption(a, "is_empty", "Maybe"))
        assertFalse(FormStudioLogic.staleOption(field("""{"id":"t","type":"text"}"""), "equals", "Maybe"))
    }

    @Test fun deletingAQuestionClearsItsDependentsAndUndoPutsThemBack() {
        val a = field("""{"id":"a","type":"dropdown","options":["x"]}""")
        val b = field("""{"id":"b","type":"text","showIf":{"fieldId":"a","operator":"equals","value":"x"}}""")
        val c = field("""{"id":"c","type":"text"}""")
        val (next, u) = FormStudioLogic.remove(listOf(a, b, c), "a")!!
        assertEquals(listOf("b", "c"), next.map { it.id }); assertNull(next[0].showIf); assertEquals(setOf("b"), u.dependents.keys)
        val back = FormStudioLogic.restore(next, u)
        assertEquals(listOf("a", "b", "c"), back.map { it.id }); assertEquals("a", back[1].showIf?.fieldId)
        assertNull(FormStudioLogic.remove(next, "zz"))
    }

    @Test fun moveStopsAtTheEnds() {
        val l = listOf(field("""{"id":"a"}"""), field("""{"id":"b"}"""))
        assertEquals(listOf("b", "a"), FormStudioLogic.move(l, "a", 1).map { it.id })
        assertEquals(l, FormStudioLogic.move(l, "a", -1))
    }

    @Test fun mappingLabelFollowsTheCategoryRule() {
        val kat = CustomFieldDef("cf1", "Kategori", "SELECT", options = JsonArray(listOf(JsonPrimitive("Bensin"), JsonPrimitive("Parkir"))))
        val q = field("""{"id":"q","type":"dropdown","options":["Bensin"],"mapping":{"target":"task_list"}}""")
        assertEquals(MappingLabel.Named("Kategori"), FormStudioLogic.mappingLabel(q, listOf(kat), listOf("To do", "Done")))
        assertEquals(MappingLabel.Vocab(R.string.fs_map_section), FormStudioLogic.mappingLabel(q.copy(options = listOf("Done")), listOf(kat), listOf("To do", "Done")))
        assertEquals(MappingLabel.Named("Kategori"), FormStudioLogic.mappingLabel(q.copy(mappingTarget = "custom_field", mappingCustomFieldId = "cf1"), listOf(kat), emptyList()))
        assertEquals(MappingLabel.Vocab(R.string.fs_project_field), FormStudioLogic.mappingLabel(q.copy(mappingTarget = "custom_field", mappingCustomFieldId = "gone"), listOf(kat), emptyList()))
        assertNull(FormStudioLogic.mappingLabel(q.copy(mappingTarget = "none"), listOf(kat), emptyList()))
        assertEquals(MappingLabel.Raw("weird"), FormStudioLogic.mappingLabel(q.copy(mappingTarget = "weird"), emptyList(), emptyList()))
        assertEquals(listOf("cf1"), FormStudioLogic.settableFields(listOf(kat, CustomFieldDef("d", "When", "DATE"))).map { it.id })
    }

    @Test fun payloadSendsOnlyWhatChanged() {
        val form = BuilderForm(obj("""{"id":"f","name":"Trip","fields":[{"id":"a","name":"Where","type":"text"}],"isPublic":true,"requireAuth":false,
            "accessSchedule":{"enabled":true,"daysOfWeek":[1],"startTime":"08:00","endTime":"17:00","timezone":"Asia/Jakarta"},"branding":{"icon":"🚗"}}"""))
        val base = FormStudioDraft.of(form)
        val p = FormStudioLogic.payload(base.copy(name = "  "), base, creating = false, untitled = "Untitled form")
        assertEquals(JsonPrimitive("Untitled form"), p["name"]); assertEquals(JsonNull, p["description"])
        assertFalse("accessSchedule" in p); assertFalse("branding" in p); assertFalse("settings" in p)
        val changed = base.copy(schedule = base.schedule.copy(end = "18:00"), settings = base.settings.copy(responseLimit = 50))
        val q = FormStudioLogic.payload(changed, base, creating = false, untitled = "x")
        assertEquals(JsonPrimitive("18:00"), q["accessSchedule"]!!.jsonObject["endTime"]); assertEquals(obj("""{"responseLimit":50}"""), q["settings"])
        // A new form: everything, the untouched schedule as null.
        val blank = FormStudioDraft.blank("What do you need?")
        val c = FormStudioLogic.payload(blank, blank, creating = true, untitled = "Untitled form")
        assertEquals(JsonNull, c["accessSchedule"]); assertEquals(JsonNull, c["branding"]); assertEquals(JsonNull, c["settings"])
        assertEquals(JsonPrimitive(true), c["isPublic"]); assertEquals(JsonPrimitive(true), c["requireAuth"])
        val first = (c["fields"] as JsonArray)[0].jsonObject
        assertEquals(JsonPrimitive(true), first["required"]); assertEquals(obj("""{"target":"task_title"}"""), first["mapping"])
    }

    @Test fun duplicatePayloadLeavesThisProjectBehind() {
        val stored = obj("""{"enabled":false,"daysOfWeek":[],"startTime":"00:00","endTime":"23:59","timezone":"Asia/Jakarta","custom":1}""")
        val d = FormStudioDraft("Trip", "", true, true, BuilderSchedule.of(stored),
            listOf(field("""{"id":"a","type":"dropdown","options":["A"],"routingRules":[{"id":"r","action":"assign_user","targetUserId":"u"}]}""")),
            FormBranding.of(obj("""{"icon":"🚗"}""")), FormStudioSettings.of(obj("""{"notifyUserIds":["u"]}""")))
        val p = FormStudioLogic.duplicatePayload(d, stored, " ", "Form", "p2")
        assertEquals(JsonPrimitive("Trip"), p["name"]); assertEquals(JsonPrimitive("p2"), p["projectId"])
        assertEquals(stored, p["accessSchedule"]); assertEquals(JsonNull, p["settings"]); assertEquals(obj("""{"icon":"🚗"}"""), p["branding"])
        assertFalse("routingRules" in (p["fields"] as JsonArray)[0].jsonObject)
        val edited = FormStudioLogic.duplicatePayload(d.copy(schedule = d.schedule.copy(enabled = true)), stored, "Copy", "Form", "p2")
        assertFalse("custom" in edited["accessSchedule"]!!.jsonObject); assertEquals(JsonPrimitive("Copy"), edited["name"])
        assertEquals(JsonNull, FormStudioLogic.duplicatePayload(d.copy(schedule = BuilderSchedule.of(null)), null, "x", "Form", "p")["accessSchedule"])
    }

    @Test fun instants() {
        val i = FormInstant.parse("2026-10-14T03:15:00.000Z")!!
        assertEquals("2026-10-14T03:15:00.000Z", FormInstant.string(i))
        assertEquals(Instant.parse("2026-10-14T03:15:00Z"), FormInstant.parse("2026-10-14T10:15:00+07:00"))
        assertNull(FormInstant.parse("")); assertNull(FormInstant.parse("soon"))
        assertEquals(Instant.parse("2026-10-14T04:00:00Z"), FormInstant.nextHour(Instant.parse("2026-10-14T03:15:42Z")))
        assertEquals(50, FormStudioLogic.defaultLimit(3)); assertEquals(70, FormStudioLogic.defaultLimit(60))
    }

    // region Autosave

    private class Server {
        val sent = mutableListOf<Pair<String, String>>()
        var fail = false
        var created = false
        var slow = 0L
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun TestScope.saver(server: Server) = FormAutosave<String>(this, send = { snap, base, _ ->
        if (server.slow > 0) delay(server.slow)
        if (server.fail) throw IllegalStateException("down")
        server.sent += snap to base; server.created = true
    }, hasId = { server.created }, describe = { it.message ?: "" })

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun autosaveDebouncesAndSavesTheLastEdit() = runTest(StandardTestDispatcher()) {
        val server = Server()
        val a = saver(server)
        a.start("v0", saved = false)
        a.update("v1"); advanceTimeBy(300); a.update("v2")
        assertEquals(FormSaveState.Pending, a.state.value)
        advanceTimeBy(650); assertTrue(server.sent.isEmpty())
        advanceUntilIdle()
        assertEquals(listOf("v2" to "v0"), server.sent); assertEquals(FormSaveState.Saved, a.state.value); assertFalse(a.dirty)
        // Back to what the server has: nothing to send.
        a.update("v2"); advanceUntilIdle(); assertEquals(1, server.sent.size)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun autosaveSendsAnEditMadeDuringASaveRightAfter() = runTest(StandardTestDispatcher()) {
        val server = Server().apply { slow = 1000 }
        val a = saver(server)
        a.start("v0", saved = true)
        a.update("v1"); advanceTimeBy(800) // the save of v1 is on its way
        assertTrue(a.inflight)
        a.update("v2"); advanceUntilIdle()
        assertEquals(listOf("v1" to "v0", "v2" to "v1"), server.sent); assertEquals(FormSaveState.Saved, a.state.value)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun autosaveFailureIsShownAndRetried() = runTest(StandardTestDispatcher()) {
        val server = Server().apply { fail = true }
        val a = saver(server)
        a.start("v0", saved = true)
        a.update("v1"); advanceUntilIdle()
        assertEquals(FormSaveState.Failed("down"), a.state.value); assertTrue(a.dirty)
        server.fail = false
        a.flush(); assertEquals(listOf("v1" to "v0"), server.sent); assertEquals(FormSaveState.Saved, a.state.value)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun autosaveNothingForAnUntouchedNewFormUnlessForced() = runTest(StandardTestDispatcher()) {
        val server = Server()
        val a = saver(server)
        a.start("blank", saved = false)
        a.flush(); assertTrue(server.sent.isEmpty()); assertEquals(FormSaveState.Idle, a.state.value)
        a.flush(force = true); assertEquals(listOf("blank" to "blank"), server.sent)
        // Stopped (deleted / discarded): nothing more goes out.
        a.stopped = true; a.update("x"); advanceUntilIdle(); assertEquals(1, server.sent.size)
    }

    // endregion
}
