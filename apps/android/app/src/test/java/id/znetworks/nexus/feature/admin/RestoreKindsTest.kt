package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** RESTORE-ALL-TYPES (owner, 8 Oct): every kind of delete, as the web reads it. */
class RestoreKindsTest {
    private fun page(json: String) = NexusJson.decodeFromString(AuditPage.serializer(), json)
    private fun entry(json: String) = NexusJson.decodeFromString(AuditEntryResponse.serializer(), json)
    private fun refuse(code: String, parent: String? = null) =
        ApiError.Http(409, "server english", code, JsonObject(buildMap { put("code", JsonPrimitive(code)); parent?.let { put("parent", JsonPrimitive(it)) } }))

    @Test fun anyRowWithACopyGetsThePill() {
        // A revoked extra day off, a soft-deleted post: the list sends `restore` on them too.
        val p = page("""{"logs":[{"id":"a","action":"revoke","entityType":"dayoff_bonus","restore":{"available":true,"soft":true,"entityLabel":"extra day off","counts":{"items":1},"open":null}}]}""")
        val r = p.logs[0].restore!!
        assertTrue(r.available); assertEquals(true, r.soft); assertEquals("extra day off", r.entityLabel); assertEquals(1, r.counts!!.items)
    }

    @Test fun buttonsAndNotesPerKind() {
        assertEquals(R.string.au_restore_project, RestoreKinds.button("project"))
        assertEquals(R.string.au_restore_task, RestoreKinds.button("task"))
        assertEquals(R.string.au_rb_comment, RestoreKinds.button("sheet_comment"))
        assertEquals(R.string.au_rb_folder, RestoreKinds.button("project_folder"))
        assertEquals(R.string.au_rb_extra_day_off, RestoreKinds.button("dayoff_bonus"))
        assertEquals(R.string.au_restore, RestoreKinds.button("something_newer"))
        assertEquals(R.string.au_restore_folder, RestoreKinds.note("project", false))
        assertNull(RestoreKinds.note("task", false))
        assertEquals(R.string.au_note_vault_soft, RestoreKinds.note("vault_file", true))
        assertEquals(R.string.au_note_vault_purged, RestoreKinds.note("vault_trash", false))
        assertNull(RestoreKinds.note("attendance_office", false))
        assertEquals(R.string.au_note_office, RestoreKinds.note("attendance_office", true))
        assertEquals(R.string.au_restored_now_vault, RestoreKinds.restoredNow("vault_folder", false))
        assertEquals(R.string.au_restored_now, RestoreKinds.restoredNow("vault_folder", true))
        assertEquals(R.string.au_restored_now, RestoreKinds.restoredNow("project", false))
        // Every kind the server restores has its own button.
        RestoreKinds.RESTORABLE.forEach { k -> assertTrue(k, RestoreKinds.button(k) != R.string.au_restore) }
    }

    @Test fun countsInTheWebsOrder() {
        val c = AuditRestoreCounts(rows = 3, comments = 1, items = 9)
        assertEquals(listOf(R.plurals.au_n_rows to 3, R.plurals.au_n_comments to 1), RestoreKinds.parts(c, "sheet_rows"))
        // A comment's comments are its replies; a cell count reads as values.
        assertEquals(listOf(R.plurals.au_n_replies to 2), RestoreKinds.parts(AuditRestoreCounts(comments = 2), "comment"))
        assertEquals(listOf(R.plurals.au_n_values to 40), RestoreKinds.parts(AuditRestoreCounts(cells = 40), "project_sheet_column"))
        assertEquals(listOf(R.plurals.au_n_projects to 2, R.plurals.au_n_subfolders to 1), RestoreKinds.parts(AuditRestoreCounts(projects = 2, folders = 1), "project_folder"))
        // Vault and unknown kinds: only "N items", and only when more than one.
        assertEquals(listOf(R.plurals.au_n_items to 9), RestoreKinds.parts(c, "vault_folder"))
        assertEquals(emptyList<Pair<Int, Int>>(), RestoreKinds.parts(AuditRestoreCounts(items = 1), "brand_new_kind"))
        // Project and task exactly as before (items ignored).
        assertEquals(listOf(R.plurals.au_n_tasks to 226, R.plurals.au_n_lists to 7, R.plurals.au_n_files to 155),
            RestoreKinds.parts(AuditRestoreCounts(tasks = 226, lists = 7, files = 155, items = 400), "project"))
    }

    @Test fun refusalsByKindAndParent() {
        assertEquals(R.string.au_cf_holiday, RestoreKinds.errorRes(refuse("CONFLICT"), "holiday", false))
        assertEquals(R.string.au_cf_soft, RestoreKinds.errorRes(refuse("CONFLICT"), "post", true))
        assertEquals(R.string.au_cf_other, RestoreKinds.errorRes(refuse("CONFLICT"), "doc", false))
        assertEquals(R.string.au_pm_subtask, RestoreKinds.errorRes(refuse("PARENT_MISSING", "task"), "task", false))
        assertEquals(R.string.au_err_parent_missing, RestoreKinds.errorRes(refuse("PARENT_MISSING", "project"), "task", false))
        assertEquals(R.string.au_pm_section, RestoreKinds.errorRes(refuse("PARENT_MISSING", "section"), "comment", false))
        assertEquals(R.string.au_pm_field, RestoreKinds.errorRes(refuse("PARENT_MISSING", "custom field"), "form_submission", false))
        assertEquals(R.string.au_pm_unit, RestoreKinds.errorRes(refuse("PARENT_MISSING", "org chart unit"), "org_unit_member", false))
        assertEquals(R.string.au_pm_person, RestoreKinds.errorRes(refuse("PARENT_MISSING", "person"), "dayoff_bonus", false))
        assertEquals(R.string.au_pm_unknown, RestoreKinds.errorRes(refuse("PARENT_MISSING"), "doc", false))
        assertEquals(R.string.au_err_already_restored, RestoreKinds.errorRes(refuse("ALREADY_RESTORED"), "doc", false))
    }

    @Test fun openGoesToTheRightScreen() {
        fun t(open: String?, type: String, id: String? = "e1"): RestoreTarget? {
            val json = if (open == null) """{"entry":{"id":"a","action":"delete","entityType":"$type"},"restore":{"available":true}}"""
                else """{"entry":{"id":"a","action":"delete","entityType":"$type"},"restore":{"available":true,"open":$open}}"""
            return RestoreKinds.target(entry(json).restore!!.open, type, id)
        }
        // Copies from before `open` existed: project/task by their id, others nowhere.
        assertEquals(RestoreTarget(RestoreTarget.Kind.PROJECT, "e1"), t(null, "project"))
        assertEquals(RestoreTarget(RestoreTarget.Kind.TASK, "e1"), t(null, "task"))
        assertNull(t(null, "doc"))
        // `open: null` = nowhere to go.
        assertNull(t("null", "project"))
        assertEquals(RestoreTarget(RestoreTarget.Kind.DOC, "d1"), t("""{"type":"doc","id":"d1"}""", "doc"))
        assertEquals(RestoreTarget(RestoreTarget.Kind.FOLDER, "f1"), t("""{"type":"folder","id":"f1"}""", "project_folder"))
        assertEquals(RestoreTarget(RestoreTarget.Kind.CALENDAR, date = "2026-10-08"), t("""{"type":"calendar_event","id":"x","date":"2026-10-08"}""", "calendar_event"))
        assertEquals(RestoreTarget.Kind.ATTENDANCE, t("""{"type":"attendance_request","id":"r1"}""", "attendance_request")!!.kind)
        assertEquals(RestoreTarget.Kind.VAULT, t("""{"type":"vault","id":"v"}""", "vault_file")!!.kind)
        assertEquals(RestoreTarget.Kind.WIRE, t("""{"type":"post","id":"p"}""", "post")!!.kind)
        // A sheet, page, form, P&L… or a type this app doesn't know: its project, else no link.
        assertEquals(RestoreTarget(RestoreTarget.Kind.PROJECT, "p9"), t("""{"type":"sheet","id":"s","projectId":"p9"}""", "project_sheet"))
        assertNull(t("""{"type":"goal","id":"g"}""", "goal"))
    }

    @Test fun tooOldPerKind() {
        val e = AuditEntry("a", action = "delete", entityType = "holiday")
        assertEquals(R.string.au_restore_too_old_any, RestoreKinds.tooOld(e, null))
        assertEquals(R.string.au_restore_too_old, RestoreKinds.tooOld(e.copy(entityType = "project"), null))
        assertNull(RestoreKinds.tooOld(e.copy(entityType = "user"), null))
    }
}
