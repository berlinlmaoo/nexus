package id.znetworks.nexus.feature.meetings

import org.junit.Assert.*
import org.junit.Test

class MeetingUploadProgressTest {
    @Test fun liveWorkerReadingWinsOverStaleApiBytes() {
        val p = MeetingUploadProgress.resolve(MeetingAudio(bytes = 1000, received = 0), 400, 1000)
        assertEquals(400L, p.received); assertEquals(.4f, p.fraction); assertEquals(40, p.percent)
    }
    @Test fun roundedMegabytesAndPercentAgreeAtFortyPercent() {
        assertEquals(40, MeetingUploadProgress.resolve(MeetingAudio(bytes = 32610714), 13044285, 32610714).percent)
    }
    @Test fun staleOrInvalidWorkerCannotMoveApiProgressBackwards() {
        val audio = MeetingAudio(bytes = 1000, received = 800)
        assertEquals(800L, MeetingUploadProgress.resolve(audio, 400, 1000).received)
        assertEquals(800L, MeetingUploadProgress.resolve(audio, 900, 2000).received)
        assertEquals(800L, MeetingUploadProgress.resolve(audio, 1001, 1000).received)
    }
    @Test fun zeroAndMalformedTotalsNeverDivideByZeroOrOverflowBar() {
        assertEquals(0f, MeetingUploadProgress.resolve(MeetingAudio(bytes = 0, received = 4)).fraction)
        assertEquals(100, MeetingUploadProgress.resolve(MeetingAudio(bytes = 1000, received = 2000)).percent)
        assertEquals(0, MeetingUploadProgress.resolve(MeetingAudio(bytes = -10, received = -20)).percent)
    }
}
