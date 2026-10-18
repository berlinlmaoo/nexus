package id.znetworks.nexus.feature.calendar

import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CalendarFolderTest {
    @get:Rule val temp = TemporaryFolder()
    private val folder = "01a1303f-6e9e-7000-b02e-a5f4d7b7ac07"
    private val range = "2026-10-01" to "2026-10-31"
    private fun body(id: String) = """{"today":"2026-10-19","access":"all","folder":["$id"],"items":[]}"""

    @Test fun structurePreservesServerTreeOrderAndOlderServersStillDecode() {
        assertTrue(NexusJson.decodeFromString(CalStructure.serializer(), "{}").folders.isEmpty())
        val tree = NexusJson.decodeFromString(CalStructure.serializer(), """{"folders":[{"id":"root","name":"Root"},{"id":"child","name":"Child","parentId":"root","depth":1}]}""")
        assertEquals(listOf("root", "child"), tree.folders.map { it.id })
        assertEquals(1, tree.folders.last().depth)
    }

    @Test fun folderFilterCountsOnceAndLeavesVisibilityToTheServer() {
        val filters = CalendarCore.Filters(folders = listOf(folder, "child"))
        assertEquals(1, CalendarCore.activeFilterCount(filters))
        val row = CalItem("linked", id = "task", day = "2026-10-19", project = CalProject("elsewhere"), linkedProjectIds = listOf("linked-project"))
        val context = CalendarCore.FilterContext(CalendarCore.Index(emptyList(), emptyList()), "u", emptyList(), "2026-10-19", 0L, 14)
        assertEquals(listOf(row), CalendarCore.filterItems(listOf(row), filters, context))
        assertTrue(CalendarCore.NO_FILTERS.folders.isEmpty())
    }

    @Test fun diskResponsesAreSeparatedByFolderAndUnfilteredRange() {
        val cache = CalendarDiskCache(temp.root)
        val all = CalItems(today = "2026-10-19")
        val narrow = all.copy(folder = listOf(folder))
        cache.saveItems("u", range, all, 10)
        cache.saveItems("u", range, narrow, 20, folder)
        assertEquals(all, cache.items("u", range)?.value)
        assertEquals(narrow, cache.items("u", range, folder)?.value)
        assertNull(cache.items("u", range, "another"))
    }

    @Test fun staleUnfilteredDataCannotBecomeTheFilteredMonthsContent() {
        val s = CalState(day = "2026-10-19", items = CalItems(today = "2026-10-19"), filters = CalendarCore.Filters(folders = listOf(folder)))
        val held = s.copy(itemsRange = s.range)
        assertFalse(held.current)
        assertTrue(held.copy(itemsFolder = folder).current)
        assertFalse(held.copy(itemsFolder = folder, filters = CalendarCore.NO_FILTERS).current)
    }

    @Test fun uuidFolderLinksAndOtherCalendarParametersSurviveTogether() {
        assertEquals(Target.Calendar(folder = folder), Links.parse("/folders/$folder"))
        val target = Links.parse("/calendar?folder=$folder,child&date=2026-10-19&view=people&lens=person&scope=me&project=p1&prio=HIGH&done=0&overdue=1&task=t1") as Target.Calendar
        assertEquals("$folder,child", target.folder)
        assertEquals("p1", target.project); assertEquals("HIGH", target.prio)
        assertEquals("0", target.done); assertEquals("1", target.overdue); assertEquals("t1", target.task)
        assertEquals("people", target.view); assertEquals("person", target.lens); assertEquals("me", target.scope)
    }

    @Test fun folderKeysAreCanonicalAndLinkIdsRejectPathFragments() {
        assertEquals("a,b", CalendarCore.folderKey(listOf("b", "a", "b")))
        assertNull(CalendarCore.folderKey(emptyList()))
        assertEquals(listOf(folder, "valid"), CalendarCore.linkIds("$folder,../bad,valid,$folder"))
    }

    @Test fun etagsAndOverdueRequestsDoNotLeakAcrossFolders() = runTest {
        MockWebServer().use { server ->
            server.start()
            val api = CalendarApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 36), { Session("t", "c", "u") }, mayCarrySession = { true }))
            server.enqueue(MockResponse.Builder().code(200).addHeader("ETag", "a").body(body(folder)).build())
            server.enqueue(MockResponse.Builder().code(200).addHeader("ETag", "b").body(body("other")).build())
            server.enqueue(MockResponse.Builder().code(304).build())
            assertEquals(listOf(folder), api.items(range.first, range.second, folder).value.folder)
            assertTrue(server.takeRequest().target.endsWith("&folder=$folder"))
            assertEquals(listOf("other"), api.items(range.first, range.second, "other").value.folder)
            assertNull(server.takeRequest().headers["If-None-Match"])
            assertEquals(listOf(folder), api.items(range.first, range.second, folder).value.folder)
            assertEquals("a", server.takeRequest().headers["If-None-Match"])
            server.enqueue(MockResponse.Builder().code(200).body(body(folder)).build())
            api.overdue(folder)
            assertEquals("/api/calendar/overdue?folder=$folder", server.takeRequest().target)
        }
    }
}
