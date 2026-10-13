package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** PROJECT-ICON (Berlin, 11 Oct + UPDATE 3): the full-colour task icon for every project, a photo the only custom icon, no colour picker. */
class ProjectMarkTest {
    private fun src(p: String) = File("src/main/java/id/znetworks/nexus/$p").readText()

    @Test fun onlyAPhotoIsCustom() {
        assertTrue(ProjectMarkLogic.isPhoto("/api/files/project-icons/p1.jpg?v=1"))
        assertTrue(ProjectMarkLogic.isPhoto("https://cdn.example/x.png"))
        listOf(null, "", "🚀", "folder", "briefcase", "📁").forEach { assertFalse(it.toString(), ProjectMarkLogic.isPhoto(it)) }
    }

    @Test fun defaultIsTheFullColourTaskIcon() {
        val shapes = ProjectMarkLogic.SHAPES
        assertEquals(9, shapes.size)
        assertEquals(ProjectMarkLogic.Shape(3f, 3f, 18f, 20f, 3.5f, 0xFFF59E0B), shapes[0])
        assertEquals(ProjectMarkLogic.Shape(8.5f, 1.5f, 7f, 4f, 1.4f, 0xFF475569), shapes[2])
        assertEquals(listOf(0xFF22C55E, 0xFF22C55E, 0xFFE2E8F0), shapes.filter { it.w == 3.4f }.map { it.color })
        assertEquals(3.6f, shapes.last().w)
        assertEquals(listOf(7.9f to 9.9f, 7.9f to 14.3f), ProjectMarkLogic.TICKS)
        assertEquals("folder", ProjectMarkLogic.REMOVED)
        // Everything fits the 24×24 grid.
        shapes.forEach { assertTrue(it.toString(), it.x >= 0 && it.y >= 0 && it.x + it.w <= 24f && it.y + it.h <= 24f) }
        val mark = src("feature/projects/ProjectMark.kt")
        assertFalse(mark.contains("parseColor") || mark.contains("verticalGradient") || mark.contains("background("))
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
