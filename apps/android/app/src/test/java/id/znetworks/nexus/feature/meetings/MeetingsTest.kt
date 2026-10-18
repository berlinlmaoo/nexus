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
        assertEquals("new-member", edited.members.single().id)
        assertEquals("Local\ntext", edited.overview)
        assertTrue(meetingMerge(server, mapOf("projectId" to JsonPrimitive("other-project"))).members.isEmpty())
    }
}
