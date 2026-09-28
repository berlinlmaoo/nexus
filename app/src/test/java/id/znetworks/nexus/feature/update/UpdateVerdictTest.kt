package id.znetworks.nexus.feature.update

import id.znetworks.nexus.feature.update.ApkUpdater.Reason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The gate before PackageInstaller: nothing wrong, tampered or older ever reaches the installer. */
class UpdateVerdictTest {
    private val own = "id.znetworks.nexus"
    private val key = setOf("5322fe4c")
    private fun v(sum: Boolean? = true, pkg: String? = own, a: Set<String>? = key, i: Set<String>? = key, code: Int? = 3, running: Int = 2) =
        ApkUpdater.verdict(sum, pkg, own, a, i, code, running)

    @Test fun aGoodNewerBuildPasses() = assertNull(v())
    @Test fun noChecksumPublishedStillNeedsTheSameKey() {
        assertNull(v(sum = null))
        assertEquals(Reason.WRONG_APP, v(sum = null, a = setOf("other")))
    }
    @Test fun checksumMismatchStopsFirst() = assertEquals(Reason.CHECKSUM, v(sum = false, pkg = "evil"))
    @Test fun anotherPackageIsRefused() {
        assertEquals(Reason.WRONG_APP, v(pkg = "com.evil"))
        assertEquals(Reason.WRONG_APP, v(pkg = null))
    }
    @Test fun anotherSigningKeyIsRefused() {
        assertEquals(Reason.WRONG_APP, v(a = setOf("attacker")))
        assertEquals(Reason.WRONG_APP, v(a = emptySet()))
        assertEquals(Reason.WRONG_APP, v(i = null))
    }
    @Test fun sameOrOlderIsNotAnUpdate() {
        assertEquals(Reason.NOT_NEWER, v(code = 2))
        assertEquals(Reason.NOT_NEWER, v(code = 1))
        assertEquals(Reason.NOT_NEWER, v(code = null))
    }
}
