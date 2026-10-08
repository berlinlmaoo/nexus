package id.znetworks.nexus.feature.vault

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.RealtimeEvents
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** VAULT-MOVE-DND (Berlin, 9 Oct): move, gallery, thumbnails, the vault ping. */
class VaultMoveTest {
    private fun item(json: String) = NexusJson.decodeFromString(VaultItem.serializer(), json)

    @Test fun thumbnails() {
        val png = item("""{"id":"a","name":"logo.png","mimeType":"image/png","thumbUrl":"/api/vault/items/a/thumb?v=123"}""")
        assertEquals("/api/vault/items/a/thumb?v=123&w=320", VaultRules.thumb(png))
        assertEquals("/api/vault/items/a/thumb?v=123&w=1280", VaultRules.thumb(png, 1280))
        assertTrue(VaultRules.showWhole(png))
        val jpg = item("""{"id":"b","name":"x.jpg","mimeType":"image/jpeg"}""")
        assertNull(VaultRules.thumb(jpg)) // an older server: the type icon
        assertFalse(VaultRules.showWhole(jpg))
    }

    @Test fun galleryOrder() {
        val items = listOf(
            item("""{"id":"1","name":"b.mp4","mimeType":"video/mp4"}"""), item("""{"id":"2","name":"LOGO","kind":"FOLDER"}"""),
            item("""{"id":"3","name":"a.pdf","mimeType":"application/pdf"}"""), item("""{"id":"4","name":"a.png","mimeType":"image/png"}"""),
        )
        val g = VaultRules.gallery(items)
        assertEquals(listOf("2"), g.folders.map { it.id }); assertEquals(listOf("4", "1"), g.media.map { it.id }); assertEquals(listOf("3"), g.files.map { it.id })
    }

    @Test fun moveHereRules() {
        assertEquals(R.string.vm_already_here, VaultRules.moveBlock("logo", "logo", canWrite = true))
        assertEquals(R.string.vm_already_here, VaultRules.moveBlock(null, null, canWrite = true))
        assertEquals(R.string.vm_cant_add, VaultRules.moveBlock("logo", "locked", canWrite = false))
        assertNull(VaultRules.moveBlock("logo", null, canWrite = true))
        // The top level is an explicit JSON null, never an omitted key (omitted = no change on the server).
        val api = File("src/main/java/id/znetworks/nexus/feature/vault/VaultApi.kt").readText()
        assertTrue(api.contains("\"parentId\" to (parentId?.let(::JsonPrimitive) ?: kotlinx.serialization.json.JsonNull)"))
    }

    @Test fun vaultPingOnlyForVault() {
        val e = RealtimeEvents.parse("workspace-changed", """{"kind":"vault","actorId":"u"}""")
        assertEquals("vault", e.kind)
        assertFalse(RealtimeEvents.isProjectsOrFolders(e)); assertFalse(RealtimeEvents.isAudit(e))
    }
}
