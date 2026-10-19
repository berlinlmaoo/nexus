package id.znetworks.nexus.feature.gideon

import org.junit.Assert.*
import org.junit.Test

class MemoryProfileTest {
    @Test fun profileFieldsDoNotClaimUnrelatedPeopleOrFacts() {
        val unrelated = GMemory("a", "My sister is Alice", "PERSON", status = "ACTIVE", source = "SETTINGS")
        assertNull(MemoryProfile.find(MemoryProfile.Field.NICKNAME, listOf(unrelated)))
        assertNull(MemoryProfile.field(unrelated))
    }
    @Test fun existingLocalizedFieldIsEditableAfterLanguageChange() {
        val old = GMemory("a", "Nama panggilan: Berlin", "PERSON", status = "ACTIVE", source = "SETTINGS")
        assertEquals(old, MemoryProfile.find(MemoryProfile.Field.NICKNAME, listOf(old)))
        assertEquals("Berlin", MemoryProfile.value(MemoryProfile.Field.NICKNAME, old))
        assertEquals(MemoryProfile.Field.NICKNAME, MemoryProfile.field(old))
    }
    @Test fun pendingOrChatSuggestionsDoNotReplaceTheSavedProfileField() {
        val active = GMemory("a", "Nickname: Berlin", "PERSON", status = "ACTIVE", source = "SETTINGS", updatedAt = "2026-10-19T01:00:00Z")
        val pending = active.copy(id = "b", status = "PENDING", updatedAt = "2026-10-19T02:00:00Z")
        val chat = pending.copy(id = "c", status = "ACTIVE", source = "CHAT")
        assertEquals(active, MemoryProfile.find(MemoryProfile.Field.NICKNAME, listOf(active, pending, chat)))
    }
    @Test fun fieldValueLimitReservesTheCanonicalPrefix() {
        for (field in MemoryProfile.Field.entries) assertEquals(200, MemoryProfile.payload(field, "x".repeat(MemoryProfile.limit(field, 200))).length)
    }
}
