package id.znetworks.nexus.feature.vault

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Z Vault's 5 GB shelf (web vault.tsx quota bar + lib/vault-media humanSize). */
class VaultUsageTest {
    @Test fun usageAgainstTheCap() {
        val gb = 1024L * 1024 * 1024
        val u = VaultRules.usage(Quota(usedBytes = gb, totalBytes = 0))!! // no total from the server: the 5 GB cap
        assertEquals(5 * gb, u.total); assertEquals(20, u.percent); assertFalse(u.nearlyFull)
        val full = VaultRules.usage(Quota(usedBytes = 46 * gb / 10, totalBytes = 5 * gb))!!
        assertEquals(92, full.percent); assertTrue(full.nearlyFull)
        assertEquals(100, VaultRules.usage(Quota(usedBytes = 6 * gb, totalBytes = 5 * gb))!!.percent)
        assertNull(VaultRules.usage(null))
    }

    @Test fun humanSizeLikeTheWeb() {
        assertEquals("512 B", VaultRules.humanSize(512))
        assertEquals("1.5 KB", VaultRules.humanSize(1536))
        assertEquals("12 MB", VaultRules.humanSize(12L * 1024 * 1024))
        assertEquals("5.0 GB", VaultRules.humanSize(5L * 1024 * 1024 * 1024))
    }
}
