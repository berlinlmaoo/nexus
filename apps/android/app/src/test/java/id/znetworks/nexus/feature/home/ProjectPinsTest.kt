package id.znetworks.nexus.feature.home

import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

// Berlin 29 Sep (iOS 286cada): pins live on the server (/api/projects/pins), same list as the web sidebar.
class ProjectPinsTest {
    private class MapStore : ShortcutStore {
        val m = mutableMapOf<String, Any>()
        override fun getString(key: String, default: String?) = m[key] as String? ?: default
        override fun putString(key: String, value: String) { m[key] = value }
        override fun getBoolean(key: String, default: Boolean) = m[key] as Boolean? ?: default
        override fun putBoolean(key: String, value: Boolean) { m[key] = value }
        override fun clear() = m.clear()
    }

    private class FakeRemote(var ids: MutableList<String>, var visible: List<ShortcutRef>?) : PinRemote {
        var fail = false
        val calls = mutableListOf<Pair<String, Boolean>>()
        override suspend fun pins() = ids.toList()
        override suspend fun setPin(projectId: String, pinned: Boolean) {
            calls += projectId to pinned
            if (fail) throw java.io.IOException("offline")
            if (pinned) { ids.remove(projectId); ids.add(0, projectId) } else ids.remove(projectId)
        }
        override suspend fun projects() = visible
    }

    private fun ref(id: String) = ShortcutRef(id, "P$id")

    @Test fun serverOrderOnlyVisibleProjects() = runTest {
        val remote = FakeRemote(mutableListOf("b", "gone", "a"), listOf(ref("a"), ref("b"), ref("c")))
        val s = ProjectShortcuts(MapStore(), { "u1" }, remote, this)
        s.syncPins()
        assertEquals(listOf("b", "a"), s.lists.value.pinned.map { it.id })   // "gone" is not in /api/projects
    }

    @Test fun oldLocalPinsGoUpOnce() = runTest {
        val store = MapStore()
        ProjectShortcuts(store, { "u1" }).apply { refresh(); togglePin(ref("x")) }        // pinned before pins synced
        val remote = FakeRemote(mutableListOf("a"), listOf(ref("a"), ref("x")))
        val s = ProjectShortcuts(store, { "u1" }, remote, this)
        s.syncPins()
        assertEquals(listOf("x" to true), remote.calls)
        assertEquals(setOf("a", "x"), s.lists.value.pinned.map { it.id }.toSet())
        remote.ids.remove("x"); s.syncPins()                                              // unpinned on the web
        assertEquals(listOf("x" to true), remote.calls)                                   // not sent up again
        assertEquals(listOf("a"), s.lists.value.pinned.map { it.id })
    }

    @Test fun optimisticThenBackOnFailure() {
        val scope = TestScope(StandardTestDispatcher())
        val remote = FakeRemote(mutableListOf(), listOf(ref("a")))
        val s = ProjectShortcuts(MapStore(), { "u1" }, remote, scope)
        s.refresh()
        remote.fail = true
        s.togglePin(ref("a"))
        assertEquals(listOf("a"), s.lists.value.pinned.map { it.id })   // at once
        scope.advanceUntilIdle()
        assertEquals(emptyList<String>(), s.lists.value.pinned.map { it.id })  // refused: put back
        remote.fail = false
        s.togglePin(ref("a")); scope.advanceUntilIdle()
        assertEquals(listOf("a"), s.lists.value.pinned.map { it.id }); assertEquals(listOf("a"), remote.ids)
    }

    @Test fun unreadableProjectListKeepsKnownNames() = runTest {
        val store = MapStore()
        val remote = FakeRemote(mutableListOf("a"), null)
        val s = ProjectShortcuts(store, { "u1" }, remote, this)
        s.refresh(); s.visited(ref("a"))
        s.syncPins()
        assertEquals(listOf("Pa"), s.lists.value.pinned.map { it.name })
    }
}
