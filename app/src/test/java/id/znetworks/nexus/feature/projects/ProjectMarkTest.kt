package id.znetworks.nexus.feature.projects

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** PROJECT-ICON (Berlin, 11 Oct): one default mark per project, a photo the only custom icon. */
class ProjectMarkTest {
    private fun src(p: String) = File("src/main/java/id/znetworks/nexus/$p").readText()

    @Test fun onlyAPhotoIsCustom() {
        assertTrue(ProjectMarkLogic.isPhoto("/api/files/project-icons/p1.jpg?v=1"))
        assertTrue(ProjectMarkLogic.isPhoto("https://cdn.example/x.png"))
        listOf(null, "", "🚀", "folder", "briefcase", "📁").forEach { assertFalse(it.toString(), ProjectMarkLogic.isPhoto(it)) }
    }

    @Test fun colourFallsBackToViolet() {
        assertEquals(parseColor("#7B2FBE", androidx.compose.ui.graphics.Color.Black), ProjectMarkLogic.color(null))
        assertEquals(parseColor("#16a34a", androidx.compose.ui.graphics.Color.Black), ProjectMarkLogic.color("#16a34a"))
        assertEquals(0.6f, ProjectMarkLogic.SCALE)
        assertEquals("folder", ProjectMarkLogic.REMOVED)
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
        assertFalse(src("feature/projects/ProjectsScreen.kt").contains("PROJECT_ICONS"))
        val settings = src("feature/projects/ProjectSettingsScreen.kt")
        assertFalse(settings.contains("EmojiRow("))
        assertFalse(settings.contains("\"icon\" to JsonPrimitive(icon)"))
        assertTrue(settings.contains("ps_photo_add") && settings.contains("ps_photo_change") && settings.contains("ps_photo_remove"))
        assertTrue(api.contains("/api/upload/project-icon"))
    }
}
