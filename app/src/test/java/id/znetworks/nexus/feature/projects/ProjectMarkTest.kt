package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Checklist
import java.io.File

/** PROJECT-ICON (Berlin, 11 Oct + UPDATE): the task icon for every project, a photo the only custom icon, no colour picker. */
class ProjectMarkTest {
    private fun src(p: String) = File("src/main/java/id/znetworks/nexus/$p").readText()

    @Test fun onlyAPhotoIsCustom() {
        assertTrue(ProjectMarkLogic.isPhoto("/api/files/project-icons/p1.jpg?v=1"))
        assertTrue(ProjectMarkLogic.isPhoto("https://cdn.example/x.png"))
        listOf(null, "", "🚀", "folder", "briefcase", "📁").forEach { assertFalse(it.toString(), ProjectMarkLogic.isPhoto(it)) }
    }

    @Test fun defaultIsTheTaskIconNotTheColour() {
        assertEquals(Icons.Filled.Checklist, ProjectMarkLogic.DEFAULT)
        assertTrue(src("ui/shell/SignedInShell.kt").contains("TASKS(\"tasks\", R.string.tab_tasks, Icons.Filled.Checklist"))
        assertEquals("folder", ProjectMarkLogic.REMOVED)
        val mark = src("feature/projects/ProjectMark.kt")
        assertFalse(mark.contains("parseColor"))
        assertTrue(mark.contains("tint = c.mutedFg"))
    }

    @Test fun projectsNeverDrawAnEmoji() {
        listOf("feature/projects/ProjectsScreen.kt", "feature/projects/ProjectDetailScreen.kt", "feature/home/HomeScreen.kt",
            "feature/projects/FolderCalendar.kt", "feature/admin/Teams.kt").forEach { f ->
            val s = src(f)
            assertFalse(f, Regex("""IconTile\((p|it|ref)\.icon""").containsMatchIn(s))
            // ProjectsScreen keeps ProjectIcon.emoji for FOLDER icons (IconTile, EmojiRow).
            if (!f.endsWith("ProjectsScreen.kt")) assertFalse(f, s.contains("ProjectIcon.emoji("))
        }
        // Folders keep their own emoji/photo.
        assertTrue(src("feature/projects/ProjectTree.kt").contains("IconTile(f.icon"))
    }

    @Test fun createAndSettingsSendNoEmoji() {
        val api = src("feature/projects/ProjectsApi.kt")
        val create = api.substringAfter("suspend fun createProject(").substringBefore("\n    }")
        assertFalse(create.contains("put(\"icon\""))
        assertFalse(create.contains("put(\"color\""))
        assertFalse(src("feature/projects/ProjectsScreen.kt").contains("PROJECT_ICONS"))
        val settings = src("feature/projects/ProjectSettingsScreen.kt")
        assertFalse(settings.contains("EmojiRow("))
        assertFalse(settings.contains("ColorRow("))
        assertFalse(settings.contains("\"color\" to"))
        val dialog = src("feature/projects/ProjectsScreen.kt").substringAfter("private fun CreateProjectDialog(").substringBefore("private fun FolderDialog(")
        assertFalse(dialog.contains("ColorRow("))
        assertFalse(settings.contains("\"icon\" to JsonPrimitive(icon)"))
        assertTrue(settings.contains("ps_photo_add") && settings.contains("ps_photo_change") && settings.contains("ps_photo_remove"))
        assertTrue(api.contains("/api/upload/project-icon"))
    }
}
