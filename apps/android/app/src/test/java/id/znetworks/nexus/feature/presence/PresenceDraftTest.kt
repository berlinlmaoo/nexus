package id.znetworks.nexus.feature.presence

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime

class PresenceDraftTest {
    @Test fun availabilityOnlyRequiresAnExplicitValidSelection() {
        assertFalse(PresenceDraft.canSave("", null))
        assertFalse(PresenceDraft.canSave("", ""))
        listOf("online", "away", "dnd").forEach { assertTrue(PresenceDraft.canSave("", it)) }
        assertTrue(PresenceDraft.canSave("[TEST] Typed status", null))
        assertFalse(PresenceDraft.canSave("x".repeat(81), "online"))
        assertEquals("", PresenceDraft.statusText("🚗", "   "))
    }
    @Test fun weekEndsOnSundayInWibIncludingWhenStartedOnSunday() {
        assertEquals(Instant.parse("2026-10-25T16:59:00Z"), PresenceTimes.end(Instant.parse("2026-10-19T03:30:00Z"), "week", LocalDateTime.MIN))
        assertEquals(Instant.parse("2026-10-25T16:59:00Z"), PresenceTimes.end(Instant.parse("2026-10-25T03:30:00Z"), "week", LocalDateTime.MIN))
        val start = Instant.parse("2026-10-19T03:30:00Z")
        assertEquals(start.plusSeconds(14400), PresenceTimes.end(start, "4h", LocalDateTime.MIN))
    }
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
