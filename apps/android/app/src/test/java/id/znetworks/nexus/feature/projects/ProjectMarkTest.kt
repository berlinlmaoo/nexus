package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** PROJECT-ICON (owner, 14 Oct, option A): the grey page outline for every project, a photo the only custom icon, no colour picker. */
class ProjectMarkTest {
    private fun src(p: String) = File("src/main/java/id/znetworks/nexus/$p").readText()

    @Test fun onlyAPhotoIsCustom() {
        assertTrue(ProjectMarkLogic.isPhoto("/api/files/project-icons/p1.jpg?v=1"))
        assertTrue(ProjectMarkLogic.isPhoto("https://cdn.example/x.png"))
        listOf(null, "", "🚀", "folder", "briefcase", "📁").forEach { assertFalse(it.toString(), ProjectMarkLogic.isPhoto(it)) }
    }

    @Test fun defaultIsThePageOutline() {
        // Option A (owner, 14 Oct 2026): the grey page outline, stroke 1.6, no fill.
        assertEquals(listOf("M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z", "M14 3v4h4", "M8.5 12h7M8.5 15.5h5"), ProjectMarkLogic.PATHS)
        assertEquals(1.6f, ProjectMarkLogic.STROKE)
        assertEquals(0xFF91918E, ProjectMarkLogic.LIGHT); assertEquals(0xFF9B9A97, ProjectMarkLogic.DARK)
        assertEquals("folder", ProjectMarkLogic.REMOVED)
        val mark = src("feature/projects/ProjectMark.kt")
        assertFalse(mark.contains("parseColor") || mark.contains("verticalGradient") || mark.contains("background("))
        assertTrue(mark.contains("style = Stroke("))
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
