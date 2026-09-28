package id.znetworks.nexus.feature.tasks

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Test

class TaskModelsTest {

    private fun task(json: String) = NexusJson.decodeFromString(TaskDetail.serializer(), json)

    @Test fun plainStringDescription() {
        assertEquals("Beli kabel", task("""{"id":"t","description":"Beli kabel"}""").descriptionText)
    }

    @Test fun blockNoteDescriptionFlattensOneBlockPerLine() {
        val t = task("""{"id":"t","description":[
            {"type":"paragraph","content":[{"type":"text","text":"Halo "},{"type":"text","text":"tim"}]},
            {"type":"bulletListItem","content":[{"type":"link","content":[{"type":"text","text":"link"}]}],
             "children":[{"type":"paragraph","content":[{"type":"text","text":"anak"}]}]},
            {"type":"paragraph","content":[]}
        ]}""")
        assertEquals("Halo tim\nlink\nanak", t.descriptionText)
    }

    @Test fun missingOrNullDescriptionIsEmpty() {
        assertEquals("", task("""{"id":"t"}""").descriptionText)
        assertEquals("", task("""{"id":"t","description":null}""").descriptionText)
    }

    @Test fun projectIdFromTaskListProject() {
        val t = task("""{"id":"t","taskList":{"id":"l","name":"Todo","project":{"id":"p","name":"P"}},"quests":[{"id":"q","xpReward":10}]}""")
        assertEquals("p", t.projectId)
        assertEquals(10, t.quests.single().xpReward)
    }

    @Test fun activityTextHumanizesAndJoinsDetails() {
        val log = NexusJson.decodeFromString(ActivityLog.serializer(), """{"id":"a","action":"STATUS_CHANGED","details":{"from":"TODO","to":"DONE"}}""")
        assertEquals("Status changed — TODO → DONE", activityText(log))
        val bare = NexusJson.decodeFromString(ActivityLog.serializer(), """{"id":"b","action":"created"}""")
        assertEquals("Created", activityText(bare))
    }

    @Test fun sizesAndMinutes() {
        assertEquals("512 B", sizeText(512))
        assertEquals("2 KB", sizeText(2048))
        assertEquals("1.5 MB", sizeText(1_572_864))
        assertEquals("45m", minutesText(45))
        assertEquals("2j 5m", minutesText(125))
    }
}
