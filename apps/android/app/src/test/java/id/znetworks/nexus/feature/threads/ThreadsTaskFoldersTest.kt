package id.znetworks.nexus.feature.threads

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.home.HomeTasks
import id.znetworks.nexus.feature.projects.BoardTask
import id.znetworks.nexus.feature.push.PushManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant

/** THREADS-TASK-FOLDERS (Berlin, 9 Oct): likes, @mentions, Threads push with a photo, Home "Task", folders on refresh. */
class ThreadsTaskFoldersTest {
    private val roster = listOf("u1" to "Bagas Putro", "u2" to "Ali", "u3" to "Alia")

    @Test fun mentionsPickedOrTypedWholeWordsOnly() {
        assertEquals(listOf("u1"), FeedMentions.ids("hi @BagasPutro !", mapOf("u1" to "@BagasPutro"), roster))
        // Typed by hand (never picked) still counts.
        assertEquals(listOf("u2"), FeedMentions.ids("cc @Ali tolong", emptyMap(), roster))
        // "@Ali" isn't inside "@Alia".
        assertEquals(listOf("u3"), FeedMentions.ids("cc @Alia", emptyMap(), roster))
        // A tag deleted from the text is not sent.
        assertEquals(emptyList<String>(), FeedMentions.ids("never mind", mapOf("u1" to "@BagasPutro"), roster))
    }

    @Test fun heartComesFromThePost() {
        val p = NexusJson.decodeFromString(FeedPage.serializer(), """{"posts":[{"id":"p","likedByMe":true,"likeCount":3}]}""").posts[0]
        assertTrue(p.likedByMe); assertEquals(3, p.likeCount)
        val ui = File("src/main/java/id/znetworks/nexus/feature/threads/ThreadsScreen.kt").readText()
        // Optimistic, then the server's {liked, likeCount}, rolled back on failure; a pushed post is fetched.
        assertTrue(ui.contains("it.copy(likedByMe = r.liked, likeCount = r.likeCount)")); assertTrue(ui.contains("if (it.id == p.id) p else it"))
        assertTrue(ui.contains("api.post(postId)")); assertTrue(ui.contains("api.members()"))
    }

    @Test fun threadsPushIsAPictureOnMessages() {
        assertEquals("messages", PushManager.channelFor("feed_post", null))
        assertEquals("messages", PushManager.channelFor("feed_like", null))
        val push = File("src/main/java/id/znetworks/nexus/feature/push/Push.kt").readText()
        assertTrue(push.contains("BigPictureStyle().bigPicture(picture)")); assertTrue(push.contains("callTimeout(6"))
    }

    @Test fun homeTaskLeavesOldDoneOut() {
        val now = Instant.parse("2026-10-09T00:00:00Z")
        val tasks = NexusJson.decodeFromString(kotlinx.serialization.builtins.ListSerializer(BoardTask.serializer()), """[
            {"id":"open","status":"TODO"},
            {"id":"recent","status":"DONE","completedAt":"2026-10-01T00:00:00Z"},
            {"id":"old","status":"DONE","completedAt":"2026-08-01T00:00:00Z","updatedAt":"2026-10-08T00:00:00Z"},
            {"id":"oldByUpdate","status":"DONE","updatedAt":"2026-08-20T00:00:00Z"},
            {"id":"undated","status":"DONE"}]""")
        assertEquals(listOf("open", "recent", "undated"), HomeTasks.recent(tasks, now).map { it.id })
        val en = File("src/main/res/values/strings.xml").readText(); val id = File("src/main/res/values-in/strings.xml").readText()
        // The iOS / web tile words (run 5).
        assertTrue(en.contains("<string name=\"home_stat_mission\">Tasks</string>")); assertTrue(id.contains("<string name=\"home_stat_mission\">Tugas</string>"))
    }

    @Test fun foldersSurviveARefresh() {
        val vm = File("src/main/java/id/znetworks/nexus/feature/projects/ProjectsScreen.kt").readText()
        // Both lists before either shows; a failed folder request keeps the folders on screen.
        assertTrue(vm.contains("runCatching { api.folders().value }.getOrDefault(_state.value.folders)"))
        assertTrue(File("src/main/java/id/znetworks/nexus/feature/projects/ProjectsApi.kt").readText().contains("getCached(\"/api/project-folders\""))
    }
}
