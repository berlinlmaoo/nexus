package id.znetworks.nexus.feature.presence

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime

class PresenceDraftTest {
    @Test fun emojiRoundTripDoesNotDuplicateOnEditing() {
        val payload = PresenceDraft.payload("🎬", "Out for a shoot")
        val (emoji, text) = PresenceDraft.split(payload)
        assertEquals(payload, PresenceDraft.payload(emoji, text))
        assertEquals("Out for a shoot", text)
    }
    @Test fun ordinaryStatusTextIsPreserved() {
        assertEquals("" to "Meeting with the team", PresenceDraft.split("Meeting with the team"))
        assertEquals("Meeting", PresenceDraft.payload("", " Meeting "))
    }
    @Test fun emojiCountsTowardTheExistingServerLimit() {
        assertEquals(80, PresenceDraft.payload("🚗", "x".repeat(77)).length)
        assertTrue(PresenceDraft.payload("🚗", "x".repeat(78)).length > 80)
    }
    @Test fun shootPresetLastsThreeHours() {
        val start = Instant.parse("2026-10-19T03:30:00Z")
        assertEquals(start.plusSeconds(10_800), PresenceTimes.end(start, "3h", LocalDateTime.MIN))
    }
}
