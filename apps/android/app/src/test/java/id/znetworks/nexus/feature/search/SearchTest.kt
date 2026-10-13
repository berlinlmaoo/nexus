package id.znetworks.nexus.feature.search

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchTest {
    @Test fun twoCharactersMinimumIgnoringSpaces() {
        assertFalse(SearchRules.searchable(" a "))
        assertTrue(SearchRules.searchable("ab"))
    }

    @Test fun decodesAndIgnoresUnknownGroups() {
        val r = NexusJson.decodeFromString(SearchResults.serializer(), """{"tasks":[{"id":"t","title":"Invoice","relevance":"exact"}],"projects":[],
            "comments":[],"docs":[],"members":[{"id":"u","name":"Budi"}],"goals":[],"forms":[],"sprints":[]}""")
        assertEquals("Invoice", r.tasks.single().title)
        assertFalse(r.isEmpty)
        assertTrue(SearchResults().isEmpty)
    }
}
