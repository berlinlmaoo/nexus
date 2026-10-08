package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** ANDROID-RESTORE (Berlin, 8 Oct): restore deleted projects and tasks from Control Room › Audit. */
class AuditRestoreTest {
    @Test fun oldServerShowsNothingNew() {
        val page = NexusJson.decodeFromString(AuditPage.serializer(), """{"logs":[{"id":"a","action":"delete","entityType":"project"}],"total":1}""")
        assertNull(page.logs[0].restore)
        val entry = NexusJson.decodeFromString(AuditEntryResponse.serializer(), """{"entry":{"id":"a","action":"delete","entityType":"project"}}""")
        assertNull(entry.restore)
        // A project/task delete without a copy says why it can't come back; other entries say nothing.
        assertTrue(AuditRestore.tooOld(entry.entry, entry.restore))
        assertFalse(AuditRestore.tooOld(entry.entry.copy(action = "update"), null))
        assertFalse(AuditRestore.tooOld(entry.entry.copy(entityType = "user"), null))
    }

    @Test fun newServerFields() {
        val page = NexusJson.decodeFromString(AuditPage.serializer(),
            """{"logs":[{"id":"a","action":"delete","restore":{"available":true,"restoredAt":null,"dataAsOf":"2026-10-08T01:00:00Z","fromBackup":false}}]}""")
        assertTrue(page.logs[0].restore!!.available)
        val e = NexusJson.decodeFromString(AuditEntryResponse.serializer(), """{"entry":{"id":"a","action":"delete","entityType":"task"},
            "restore":{"available":false,"restoredAt":"2026-10-08T03:00:00Z","dataAsOf":"2026-10-08T01:00:00Z","fromBackup":true,
            "restoredBy":{"id":"u","name":"Berlin"},"counts":{"lists":0,"tasks":3,"files":1,"comments":0,"sheets":0,"members":0}}}""")
        assertEquals("Berlin", e.restore!!.restoredBy!!.name)
        assertFalse(AuditRestore.tooOld(e.entry, e.restore))
        // For a task, counts.tasks are its subtasks; zeros are left out.
        assertEquals(listOf(R.plurals.au_n_subtasks to 3, R.plurals.au_n_files to 1), AuditRestore.parts(e.restore!!.counts, isTask = true))
        assertEquals(R.plurals.au_n_tasks, AuditRestore.parts(e.restore!!.counts, isTask = false)[0].first)
        val result = NexusJson.decodeFromString(AuditRestoreResult.serializer(),
            """{"ok":true,"entityType":"project","entityId":"p1","projectId":"p1","restored":{"lists":7,"tasks":226,"files":155,"comments":0,"folders":1}}""")
        assertEquals("p1", result.entityId)
    }

    @Test fun joinedInTheAppLanguage() {
        assertEquals("", AuditRestore.join(emptyList(), "and"))
        assertEquals("226 tasks", AuditRestore.join(listOf("226 tasks"), "and"))
        assertEquals("226 tugas dan 7 list", AuditRestore.join(listOf("226 tugas", "7 list"), "dan"))
        assertEquals("226 tasks, 7 lists and 155 files", AuditRestore.join(listOf("226 tasks", "7 lists", "155 files"), "and"))
    }

    @Test fun eachCodeHasTheAppsOwnText() {
        fun http(status: Int, code: String?) = ApiError.Http(status, "server english", code, null)
        assertEquals(R.string.au_err_already_restored, AuditRestore.errorRes(http(409, "ALREADY_RESTORED")))
        assertEquals(R.string.au_err_already_exists, AuditRestore.errorRes(http(409, "ALREADY_EXISTS")))
        assertEquals(R.string.au_err_parent_missing, AuditRestore.errorRes(http(409, "PARENT_MISSING")))
        assertEquals(R.string.au_err_not_restorable, AuditRestore.errorRes(http(404, "NOT_RESTORABLE")))
        assertEquals(R.string.au_err_restore_failed, AuditRestore.errorRes(http(500, null)))
        assertEquals(R.string.au_err_restore_failed, AuditRestore.errorRes(ApiError.Http(502, null, null, null)))
    }

    @Test fun restoreIsAKind() {
        assertEquals("restore", AuditLogic.kind("restore"))
        assertEquals("delete", AuditLogic.kind("delete"))
    }
}
