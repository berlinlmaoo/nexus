package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** ANDROID-GROUP-ADMINS (owner, 8 Oct): only Manager and above add or remove GROUP members. */
class ChatGroupAdminsTest {
    private fun conv(json: String) = NexusJson.decodeFromString(Conversation.serializer(), json)

    @Test fun addPeopleFollowsTheServerFlag() {
        // Old server: no field = today's behaviour (a group may grow).
        val old = conv("""{"id":"c","type":"GROUP"}""")
        assertNull(old.canManageMembers)
        assertTrue(ChatRules.showsAddPeople(old))
        assertTrue(ChatRules.showsAddPeople(conv("""{"id":"c","type":"GROUP","canManageMembers":true}""")))
        assertFalse(ChatRules.showsAddPeople(conv("""{"id":"c","type":"GROUP","canManageMembers":false}""")))
        // Project rooms add through the project, whatever the flag; a DM never grows.
        assertTrue(ChatRules.showsAddPeople(conv("""{"id":"c","type":"PROJECT","projectId":"p","canManageMembers":false}""")))
        assertFalse(ChatRules.showsAddPeople(conv("""{"id":"c","type":"DM"}""")))
        assertFalse(ChatRules.showsAddPeople(null))
    }

    @Test fun managerRequiredIsTheCodeNotTheSentence() {
        assertTrue(ChatRules.managerRequired(ApiError.Http(403, "Hanya manager ke atas…", "MANAGER_REQUIRED", null)))
        // Other 403s (not a member / left the workspace) keep their own meaning.
        assertFalse(ChatRules.managerRequired(ApiError.Http(403, "Forbidden", null, null)))
        assertFalse(ChatRules.managerRequired(ApiError.Http(400, null, "MANAGER_REQUIRED", null)))
    }

    @Test fun managerRequiredHasBothLanguages() {
        val en = java.io.File("src/main/res/values/strings.xml").readText()
        val id = java.io.File("src/main/res/values-in/strings.xml").readText()
        assertEquals(1, Regex("name=\"chat_manager_required\"").findAll(en).count())
        assertTrue(id.contains("Hanya manager ke atas yang bisa menambah atau mengeluarkan anggota."))
    }
}
