package id.znetworks.nexus.feature.vault

import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.core.nav.Target
import org.junit.Assert.assertEquals
import org.junit.Test

class VaultTest {
    @Test fun foldersFirstThenByName() {
        val l = VaultRules.sorted(listOf(VaultItem("1", "FILE", "b.pdf"), VaultItem("2", "FOLDER", "Zeta"), VaultItem("3", "FILE", "A.png"), VaultItem("4", "FOLDER", "alpha")))
        assertEquals(listOf("alpha", "Zeta", "A.png", "b.pdf"), l.map { it.name })
    }

    @Test fun onlyMembersOnlyLinksOpenInTheApp() {
        assertEquals(Target.VaultShare("abc123"), Links.parse("https://nexus.znetworks.id/v/abc123"))
        // A public /s/ link is the browser's, never the app's.
        assertEquals(Target.Web("/s/abc123"), Links.parse("https://nexus.znetworks.id/s/abc123"))
        assertEquals(Target.Vault("f1"), Links.parse("/vault?folder=f1"))
    }

    @Test fun manifestNeverClaimsPublicShareLinks() {
        val m = (java.io.File("src/main/AndroidManifest.xml").takeIf { it.exists() } ?: java.io.File("app/src/main/AndroidManifest.xml")).readText()
        assert("pathPrefix=\"/v/\"" in m && "pathPrefix=\"/f/\"" in m)
        assert("\"/s/\"" !in m && "/s\"" !in m)
    }
}
