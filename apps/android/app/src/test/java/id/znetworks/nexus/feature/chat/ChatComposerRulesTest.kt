package id.znetworks.nexus.feature.chat

import org.junit.Assert.*
import org.junit.Test

class ChatComposerRulesTest {
    @Test fun theLimitCountsUnicodeCodePointsIncludingEmoji() {
        val emoji = String(Character.toChars(0x1F44B))
        assertEquals(4000, ChatComposerLimit.length(emoji.repeat(4000)))
        assertFalse(ChatComposerLimit.tooLong(emoji.repeat(4000)))
        assertTrue(ChatComposerLimit.tooLong(emoji.repeat(4000) + "x"))
        assertEquals(3600, ChatComposerLimit.length("a".repeat(3599) + emoji))
        // A joined emoji is several code points, matching the API rather than grapheme clusters.
        assertEquals(3, ChatComposerLimit.length(emoji + "\u200D" + emoji))
    }
    @Test fun spacedMentionsAndCompactNamesMatchWithoutChangingInsertedTags() {
        assertEquals("QA Dev 2", Mentions.query("Hello @QA Dev 2"))
        assertTrue(Mentions.matches("QA Dev 2", "QA Dev"))
        assertTrue(Mentions.matches("QA Dev 2", "QADev"))
        assertTrue(Mentions.matches("QA Dev 2", "qa dev 2"))
        assertFalse(Mentions.matches("Berlin", "QA Dev"))
        assertNull(Mentions.query("@one two three four five"))
        assertNull(Mentions.query("@QA\nDev"))
        assertEquals("Hi @QADev2 ", Mentions.insert("Hi @QA Dev", "QA Dev 2"))
        assertEquals(listOf("u"), Mentions.ids("Hi @QADev2 ", mapOf("u" to Mentions.tag("QA Dev 2"))))
    }
}
