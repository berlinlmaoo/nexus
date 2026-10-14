package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** PIPELINE-DASHBOARD §15 (owner, 10 Oct): Won makes nothing; the button makes a folder with Master Calendar + Master Task. */
class PipelineExecutionFolderTest {
    private fun obj(json: String) = NexusJson.parseToJsonElement(json).jsonObject

    @Test fun decodesFolderAndCalendar() {
        val d = PipelineDeal(obj("""{"id":"a","executionFolder":{"id":"f1","name":"ACME Launch"},"executionCalendarProjectId":"c1",
            "executionCalendarProject":{"id":"c1","name":"ACME Launch: Master Calendar"},"executionProjectId":"t1"}"""))
        assertEquals("f1", d.executionFolderId); assertEquals("ACME Launch", d.executionFolderName)
        assertEquals("c1", d.executionCalendarProjectId); assertEquals("t1", d.executionProjectId)
        // A 9 Oct deal: one project, no folder. Before that: nothing at all.
        val old = PipelineDeal(obj("""{"id":"b","executionProjectId":"t2"}"""))
        assertNull(old.executionFolderId); assertNull(old.executionCalendarProjectId); assertEquals("t2", old.executionProjectId)
        assertNull(PipelineDeal(obj("""{"id":"c"}""")).executionFolderId)
    }

    @Test fun answerOpensFolderElseProject() {
        val r = PipelineExecution.of(obj("""{"projectId":"t1","calendarProjectId":"c1","folderId":"f1","created":true,"deal":{"id":"a","executionFolderId":"f1"}}"""))
        assertEquals("f1", r.folderId); assertEquals("c1", r.calendarProjectId); assertEquals("f1", r.deal!!.executionFolderId)
        val older = PipelineExecution.of(obj("""{"projectId":"t1"}"""))
        assertNull(older.folderId); assertEquals("t1", older.projectId); assertNull(older.deal)
    }

    @Test fun noAutoFootnoteAndNoClientTrigger() {
        val strings = File("src/main/res/values/strings.xml").readText()
        assertFalse("Made automatically when a deal is won" in strings)
        assertTrue("Makes a folder for this deal with its Master Calendar and Master Task." in strings)
        val idStrings = File("src/main/res/values-in/strings.xml").readText()
        assertFalse("Dibuat otomatis saat deal won" in idStrings)
        // Only the deal screen's button calls the execution endpoint; a stage move never does.
        val screen = File("src/main/java/id/znetworks/nexus/feature/pipeline/PipelineScreen.kt").readText()
        assertEquals(1, Regex("""api\.execution\(""").findAll(screen).count())
        val sheet = File("src/main/java/id/znetworks/nexus/feature/pipeline/PipelineDealSheet.kt").readText()
        assertTrue("vm.execution(deal, onOpenFolder, onOpenProject)" in sheet)
    }
}
