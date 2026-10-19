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
        for (field in MemoryProfile.Field.entries) {
            assertEquals(170, MemoryProfile.limit(field, 200))
            assertTrue(MemoryProfile.payload(field, "x".repeat(MemoryProfile.limit(field, 200))).length <= 200)
            assertEquals(0, MemoryProfile.limit(field, 1))
        }
    }
    @Test fun webAdoptedProfileRowsKeepTheirNativeBinding() {
        for (field in MemoryProfile.Field.entries) {
            val row = GMemory("profile", MemoryProfile.payload(field, "Berlin"), field.kind, status = "ACTIVE", source = "PROFILE_${field.name}")
            assertEquals(row, MemoryProfile.find(field, listOf(row)))
            assertEquals(field, MemoryProfile.field(row))
            assertEquals("Berlin", MemoryProfile.value(field, row))
        }
    }
}
