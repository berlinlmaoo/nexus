package id.znetworks.nexus.feature.meetings

import org.junit.Assert.assertEquals
import org.junit.Test

class MeetingProgressTest {
    @Test fun queuedTranscribingAndSummarizingStayInTheSameSecondStep() {
        assertEquals(0, meetingProgressStep("UPLOADING"))
        listOf("QUEUED", "TRANSCRIBING", "SUMMARIZING", "FAILED").forEach { assertEquals(1, meetingProgressStep(it)) }
    }
    @Test fun readyMinutesStayReadyWhileTasksAreBeingApplied() {
        listOf("READY", "APPLYING", "APPLIED").forEach { assertEquals(2, meetingProgressStep(it)) }
    }
}
