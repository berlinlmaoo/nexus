package id.znetworks.nexus.feature.forms

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FormLiveAutosaveTest {
    @Test fun builderFieldNormalizationDoesNotStartAnEndlessNoOpSave() = runTest {
        val server = FormStudioDraft.of(BuilderForm(obj("""{"id":"f","name":"Form","fields":[{"id":"a","label":"Question","type":"text"}]}""")))
        var sent = 0
        val saver = FormAutosave<FormStudioDraft>(this, send = { _, _, _ -> sent++ }, hasId = { true }, describe = { "error" },
            serverAuthoritative = true, equivalent = { a, b -> FormCoedit.document(a) == FormCoedit.document(b) })
        saver.start(server, saved = true)
        saver.receive(server, merge = FormCoedit::rebase)
        advanceUntilIdle()
        assertEquals(0, sent); assertFalse(saver.dirty); assertEquals(FormSaveState.Saved, saver.state.value)
    }
    private fun obj(s: String) = NexusJson.parseToJsonElement(s).jsonObject
    private val base = obj("""{"name":"Base","description":"","fields":[{"id":"a","label":"A"}]}""")
    @Test fun remoteEventDuringSaveAndNewTypingNeverRevertTheRemoteQuestion() = runTest {
        val gate = CompletableDeferred<Unit>(); val sent = mutableListOf<List<JsonObject>>()
        lateinit var autosave: FormAutosave<JsonObject>
        autosave = FormAutosave(this, send = { snapshot, before, _ ->
            sent += FormCoedit.diff(before, snapshot)
            if (sent.size == 1) gate.await()
            val acknowledgementBase = FormCoedit.rebase(before, snapshot, autosave.baseline!!)
            val server = JsonObject(autosave.baseline!! + ("name" to snapshot.getValue("name")))
            autosave.receive(server, acknowledgementBase, FormCoedit::rebase)
        }, hasId = { true }, describe = { "error" }, serverAuthoritative = true)
        autosave.start(base, saved = true)
        autosave.update(JsonObject(base + ("name" to JsonPrimitive("First"))))
        advanceTimeBy(750); runCurrent(); assertTrue(autosave.inflight)
        val remote = obj("""{"name":"Base","description":"Remote","fields":[{"id":"a","label":"Remote A"}]}""")
        autosave.receive(remote, merge = FormCoedit::rebase)
        autosave.update(JsonObject(autosave.draft!! + ("name" to JsonPrimitive("Second"))))
        gate.complete(Unit); advanceUntilIdle()
        assertEquals(2, sent.size)
        assertTrue(sent.all { batch -> batch.size == 1 && batch.single()["op"] == JsonPrimitive("set_title") })
        assertEquals(remote["fields"], autosave.draft!!["fields"])
        assertEquals(JsonPrimitive("Remote"), autosave.draft!!["description"])
        assertEquals(JsonPrimitive("Second"), autosave.baseline!!["name"])
        assertFalse(autosave.dirty); assertEquals(FormSaveState.Saved, autosave.state.value)
    }
    @Test fun canonicalTitleAcknowledgementDoesNotResendBlankForever() = runTest {
        var requests = 0
        lateinit var autosave: FormAutosave<JsonObject>
        autosave = FormAutosave(this, send = { snapshot, before, _ ->
            requests++
            val canonical = JsonObject(snapshot + ("name" to JsonPrimitive("Untitled form")))
            autosave.receive(canonical, FormCoedit.rebase(before, snapshot, autosave.baseline!!), FormCoedit::rebase)
        }, hasId = { true }, describe = { "error" }, serverAuthoritative = true)
        autosave.start(base, saved = true)
        autosave.update(JsonObject(base + ("name" to JsonPrimitive(""))))
        advanceUntilIdle()
        assertEquals(1, requests); assertFalse(autosave.dirty)
        assertEquals(JsonPrimitive("Untitled form"), autosave.draft!!["name"])
    }
    @Test fun failedWriteKeepsLocalDraftAndNewRemoteBaseForRetry() = runTest {
        var fail = true; val sent = mutableListOf<List<JsonObject>>()
        lateinit var autosave: FormAutosave<JsonObject>
        autosave = FormAutosave(this, send = { snapshot, before, _ ->
            sent += FormCoedit.diff(before, snapshot)
            if (fail) throw IllegalStateException("offline")
            autosave.receive(snapshot, snapshot, FormCoedit::rebase)
        }, hasId = { true }, describe = { it.message.orEmpty() }, serverAuthoritative = true)
        autosave.start(base, saved = true); autosave.update(JsonObject(base + ("name" to JsonPrimitive("Mine"))))
        advanceUntilIdle(); assertTrue(autosave.state.value is FormSaveState.Failed)
        val remote = JsonObject(base + ("description" to JsonPrimitive("Remote")))
        autosave.receive(remote, merge = FormCoedit::rebase); fail = false; advanceUntilIdle()
        assertEquals(JsonPrimitive("Remote"), autosave.draft!!["description"])
        assertEquals("set_title", sent.last().single()["op"]!!.jsonPrimitive.content)
        assertFalse(autosave.dirty)
    }
}
