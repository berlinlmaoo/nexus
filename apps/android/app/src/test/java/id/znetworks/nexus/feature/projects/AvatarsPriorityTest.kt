package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** AVATARS-PRIORITY (owner, 10 Oct): faces on task/project screens, compact priority pill. */
class AvatarsPriorityTest {
    private fun src(p: String) = File("src/main/java/id/znetworks/nexus/$p").readText()

    @Test fun avatarIsOptionalEverywhere() {
        val t = NexusJson.decodeFromString(BoardTask.serializer(), """{"id":"t","assignees":[{"user":{"id":"u","name":"Ana","avatar":"/api/files/a.jpg"}},{"user":{"id":"v","name":"Budi"}}]}""")
        assertEquals("/api/files/a.jpg", t.assignees[0].user?.avatar); assertNull(t.assignees[1].user?.avatar)
    }

    @Test fun pillIsCompactAndBesideTheTitle() {
        val ui = src("feature/projects/TaskUi.kt")
        val chip = ui.substringAfter("fun PriorityChip(").substringBefore("\n}\n")
        assertTrue("fontSize = 10.sp" in chip && "softWrap = false" in chip && "horizontal = 7.dp, vertical = 2.dp" in chip)
        val card = ui.substringAfter("fun TaskCard(")
        // In the title row (after the title column), not in the chips row below.
        assertTrue(card.indexOf("PriorityChip(t.priority") in card.indexOf("Text(t.title")..card.indexOf("FieldChipRow("))
        assertFalse("\"LOW\" -> Nx.colors.violetText" in ui)
        assertTrue("PriorityChip(t.priority)" in src("feature/projects/ProjectTabs.kt"))
    }

    @Test fun facesOnTaskAndProjectScreens() {
        assertTrue("(-6 * i).dp" in src("ui/components/RemoteImage.kt"))
        val detail = src("feature/tasks/TaskDetailScreen.kt")
        assertTrue(Regex("""Avatar\(""").findAll(detail).count() >= 5)   // assigned, picker, subtasks, comments, created by
        assertTrue("Avatar(p.name, p.avatar" in src("feature/projects/ProjectOverview.kt"))   // the Overview's team rows
        assertTrue("AvatarStack(t.assignees.map" in src("feature/projects/ProjectTabs.kt"))
    }
}
