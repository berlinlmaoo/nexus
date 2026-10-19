package id.znetworks.nexus.feature.meetings

import id.znetworks.nexus.core.nav.*
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.feature.admin.*
import id.znetworks.nexus.feature.inbox.InboxRules
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class MeetingsTest {
    @Test fun queueReadingsUpdateAtTheSameVersionAndQueueZeroRefetches() {
        val m = Meeting("m", status = "TRANSCRIBING", progress = .2, version = 4)
        assertEquals(.7, meetingReading(m, MeetingChanged("m", status = "TRANSCRIBING", progress = .7, version = 4))!!.progress, .001)
        assertNull(meetingReading(m, MeetingChanged("m", status = "TRANSCRIBING", progress = 0.0, version = 4)))
        assertNull(meetingReading(m, MeetingChanged("m", status = "READY", progress = 1.0, version = 5)))
        assertEquals(m, meetingReading(m, MeetingChanged("m", status = "TRANSCRIBING", progress = .1, version = 3)))
    }
    @Test fun appliedSpeakerNamesCannotBeOverlaidByPendingOrSubmittedDrafts() {
        val speaker = MeetingSpeaker(name = "Saved speaker")
        val server = Meeting("m", status = "APPLIED", speakers = mapOf("Speaker 1" to speaker), progress = 1.0, version = 8)
        val edits = mapOf("title" to JsonPrimitive("My title"), "speakers" to NexusJson.parseToJsonElement("""{"Speaker 1":{"name":"Unsaved speaker"}}"""))
        val merged = meetingAcknowledge(server, edits, emptyMap())
        assertEquals("My title", merged.title); assertEquals("Saved speaker", merged.speakers!!["Speaker 1"]!!.name)
        assertEquals(1.0, merged.progress, .001); assertEquals(8, merged.version)
    }
    @Test fun speakerEditsPreserveOtherAutomaticNamesAndClearTheEditedAutoFlag() {
        val original = mapOf("Speaker 1" to MeetingSpeaker("Berlin", "u1", true), "Speaker 2" to MeetingSpeaker("Rina", "u2", true))
        val changed = MeetingRules.nameVoice(original, "Speaker 1", "Bagas", "u3")
        assertEquals(MeetingSpeaker("Bagas", "u3"), changed["Speaker 1"])
        assertNull(changed["Speaker 1"]?.auto)
        assertEquals(original["Speaker 2"], changed["Speaker 2"])
        assertFalse("Speaker 1" in MeetingRules.nameVoice(changed, "Speaker 1", " "))
        assertEquals(120, MeetingRules.nameVoice(original, "Speaker 1", "a".repeat(130))["Speaker 1"]?.name?.length)
        assertEquals(0, MeetingRules.voiceIndex("Speaker 11"))
        assertEquals(9, MeetingRules.voiceIndex("Speaker 10"))
    }
    @Test fun speakerPipelineAndNamesSurviveWholeMapAutosave() {
        val meeting = NexusJson.decodeFromString(Meeting.serializer(), """{"id":"m","status":"READY","speakerLabels":true,"introEndSec":7.2,"transcribeStats":{"stage":"speakers"},"speakers":{"Speaker 1":{"name":"Berlin","userId":"u1","auto":true}},"transcript":[{"start":0,"end":3,"text":"Hi","speaker":"Speaker 1"},{"start":4,"end":6,"text":"Next","speaker":"Speaker 2"},{"start":7,"end":8,"text":"Again","speaker":"Speaker 1"}]}""")
        assertEquals(listOf("Speaker 1", "Speaker 2"), MeetingRules.voices(meeting))
        assertEquals("speakers", meeting.transcribeStats?.stage)
        assertEquals(7.2, meeting.introEndSec!!, .001)
        val map = MeetingRules.nameVoice(meeting.speakers!!, "Speaker 2", "Rina")
        val fields = mapOf("speakers" to JsonObject(map.mapValues { NexusJson.encodeToJsonElement(MeetingSpeaker.serializer(), it.value) }))
        val saved = meetingAcknowledge(meeting.copy(version = 4), fields, emptyMap())
        assertEquals(true, saved.speakers?.get("Speaker 1")?.auto)
        assertEquals("Rina", saved.speakers?.get("Speaker 2")?.name)
        assertEquals(4, saved.version)
    }
    @get:Rule val temp = TemporaryFolder()
    private fun client(server: MockWebServer) = MeetingsApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 36), { Session("t", "c", "u") }, mayCarrySession = { true }))
    private fun body(received: Long, status: String = "UPLOADING") = NexusJson.encodeToString(MeetingEnvelope.serializer(), MeetingEnvelope(Meeting("meeting-uuid", status = status, audio = MeetingAudio(bytes = 8, received = received))))
    private fun response(body: String, code: Int = 200) = MockResponse.Builder().code(code).body(body).build()

    @Test fun resumedUploadUsesServerOffsetAndRecoversADuplicateChunk() = runTest {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(response(body(3)))
            server.enqueue(response("""{"code":"OFFSET_MISMATCH","received":6}""", 409))
            server.enqueue(response("""{"received":8,"complete":true}"""))
            server.enqueue(response(body(8, "QUEUED")))
            val file = temp.newFile().apply { writeText("ABCDEFGH") }
            val result = MeetingUploader(client(server)).resume("meeting-uuid", file, 3)
            assertEquals("QUEUED", result.status)
            assertEquals("/api/meetings/meeting-uuid", server.takeRequest().target)
            val first = server.takeRequest()
            assertEquals("/api/meetings/meeting-uuid/audio?offset=3", first.target)
            assertEquals("DEF", first.body!!.utf8())
            assertEquals("application/octet-stream", first.headers["Content-Type"])
            val second = server.takeRequest()
            assertEquals("/api/meetings/meeting-uuid/audio?offset=6", second.target)
            assertEquals("GH", second.body!!.utf8())
            assertEquals("/api/meetings/meeting-uuid/audio/complete", server.takeRequest().target)
        }
    }
    @Test fun finishedUploadNeverRequiresOrSendsTheLocalAudioAgain() = runTest {
        MockWebServer().use { server ->
            server.start(); server.enqueue(response(body(8, "READY")))
            val result = MeetingUploader(client(server)).resume("meeting-uuid", java.io.File(temp.root, "missing"), 4)
            assertEquals("READY", result.status)
            assertEquals(1, server.requestCount)
        }
    }
    @Test fun completionResumesMissingBytesRatherThanStartingAnotherMeeting() = runTest {
        MockWebServer().use { server ->
            server.start(); server.enqueue(response(body(8)))
            server.enqueue(response("""{"code":"INCOMPLETE","received":6}""", 409))
            server.enqueue(response("""{"received":8,"complete":true}"""))
            server.enqueue(response(body(8, "QUEUED")))
            MeetingUploader(client(server)).resume("meeting-uuid", temp.newFile().apply { writeText("ABCDEFGH") }, 4)
            server.takeRequest(); server.takeRequest()
            assertEquals("/api/meetings/meeting-uuid/audio?offset=6", server.takeRequest().target)
        }
    }
    @Test fun applyRequiresAnEditableProjectAndNonEmptySelectedTitles() {
        val ready = Meeting("m", status = "READY", can = MeetingCan(apply = true), projectId = "project", proposals = listOf(MeetingProposal("task", title = "Task")))
        assertTrue(MeetingRules.canApply(ready))
        assertFalse(MeetingRules.canApply(ready.copy(projectId = null)))
        assertFalse(MeetingRules.canApply(ready.copy(status = "APPLIED")))
        assertFalse(MeetingRules.canApply(ready.copy(proposals = listOf(MeetingProposal("task", title = " ")))))
        assertTrue(MeetingRules.canApply(ready.copy(proposals = listOf(MeetingProposal("task", include = false)))))
        assertEquals(listOf("edit", "full", "legacy"), MeetingRules.editableProjects(listOf(MeetingProject("edit", viewerAccessLevel = "EDIT"), MeetingProject("view", viewerAccessLevel = "VIEW"), MeetingProject("full", viewerAccessLevel = "FULL"), MeetingProject("comment", viewerAccessLevel = "COMMENT"), MeetingProject("archived", archivedAt = "now"), MeetingProject("legacy"))).map { it.id })
    }
    @Test fun retryDoesNotOfferAnImpossibleTranscriptionAndQueueRoundingKeepsHours() {
        val failed = Meeting("m", status = "FAILED", can = MeetingCan(retry = true), audio = MeetingAudio(available = true))
        assertTrue(MeetingRules.retryable(failed.copy(errorCode = "gpu_busy")))
        assertFalse(MeetingRules.retryable(failed.copy(errorCode = "undecodable")))
        assertFalse(MeetingRules.retryable(failed.copy(audio = MeetingAudio())))
        assertTrue(MeetingRules.retryable(failed.copy(audio = MeetingAudio(), transcript = listOf(MeetingSegment(text = "Words")))))
        assertEquals(61, MeetingRules.estimateMinutes(3601.0))
        assertEquals("1:00:01", MeetingRules.timestamp(3601.0))
        assertTrue(MeetingRules.accepts("Audio.M4A")); assertFalse(MeetingRules.accepts("notes.txt"))
    }
    @Test fun meetingsOwnTheirLinksPushAndAuditTargets() {
        val id = "01a14dd5-593f-7000-955a-8beae9dabc48"
        assertEquals(Target.Meeting(id), Links.parse("nexus://meetings/$id"))
        assertEquals(Target.Meeting(id), Links.forNotification("meeting_notes_ready", null, null, null, id))
        assertEquals(Target.Meeting(id), Links.forNotification("meeting_notes_failed", "/meetings/$id", "wrong-task", "wrong-project"))
        assertEquals(Target.NewMeeting(), Links.parse("/meetings/new"))
        assertEquals(RestoreTarget(RestoreTarget.Kind.MEETING, id), RestoreKinds.target(buildJsonObject { put("type", "meeting"); put("id", id) }, "meeting_note", id))
        assertEquals(InboxRules.Mark.MEETING, InboxRules.mark("meeting_notes_failed"))
    }
    @Test fun applyingLocalEditsKeepsServerVersionAndFreshProjectMembers() {
        val server = Meeting("m", version = 9, projectId = "new-project", members = listOf(id.znetworks.nexus.feature.gideon.GTaskMember("new-member", "New")))
        val edited = meetingMerge(server, mapOf("overview" to JsonPrimitive("Local\ntext"), "projectId" to JsonPrimitive("new-project")))
        assertEquals(9, edited.version)
        assertEquals("new-member", edited.projectMembers.single().id)
        assertEquals("Local\ntext", edited.overview)
        assertTrue(meetingMerge(server, mapOf("projectId" to JsonPrimitive("other-project"))).projectMembers.isEmpty())
    }
    @Test fun unfinishedTaskRowsSurviveAnAutosaveAndStillDisableApply() {
        val server = Meeting("m", status = "READY", version = 12, projectId = "project", can = MeetingCan(apply = true), members = emptyList())
        val local = listOf(MeetingProposal("draft", title = " ", assigneeIds = listOf("removed-member")))
        val submitted = mapOf("proposals" to NexusJson.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(MeetingProposal.serializer()), local))
        val acknowledged = meetingAcknowledge(server, submitted, mapOf("title" to JsonPrimitive("Newer title")))
        assertEquals("draft", acknowledged.proposals.single().key)
        assertEquals(" ", acknowledged.proposals.single().title)
        assertTrue(acknowledged.proposals.single().assigneeIds.isEmpty())
        assertFalse(MeetingRules.canApply(acknowledged))
        assertEquals(12, acknowledged.version)
        assertEquals("Newer title", acknowledged.title)
    }
    @Test fun patchResponsesWithoutMembersDoNotEraseExistingPics() {
        val member = id.znetworks.nexus.feature.gideon.GTaskMember("member", "Person")
        val before = Meeting("m", projectId = "p", members = listOf(member))
        val response = before.copy(version = 3, members = null)
        val task = MeetingProposal("task", title = "Task", assigneeIds = listOf(member.id))
        val submitted = mapOf("proposals" to NexusJson.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(MeetingProposal.serializer()), listOf(task)))
        val saved = meetingAcknowledge(response, submitted, emptyMap(), before)
        assertEquals(listOf(member), saved.projectMembers)
        assertEquals(listOf(member.id), saved.proposals.single().assigneeIds)
    }
}
