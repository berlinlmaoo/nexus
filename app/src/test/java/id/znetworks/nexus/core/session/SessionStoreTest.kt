package id.znetworks.nexus.core.session

import id.znetworks.nexus.FakeCipher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class SessionStoreTest {
    @get:Rule val tmp = TemporaryFolder()

    private val s = Session("tok", "__Secure-authjs.session-token", "u1", "Bagas", "b@x.id", 123)

    @Test fun survivesRestart() {
        val f = File(tmp.root, "session/session.bin")
        SessionStore(f, FakeCipher()).save(s)
        assertEquals(s, SessionStore(f, FakeCipher()).current)
    }

    @Test fun storedBytesAreNotPlaintext() {
        val f = File(tmp.root, "s.bin")
        SessionStore(f, FakeCipher()).save(s)
        assertFalse(String(f.readBytes()).contains("tok"))
    }

    @Test fun clearRemovesFile() {
        val f = File(tmp.root, "s.bin")
        val store = SessionStore(f, FakeCipher())
        store.save(s)
        store.clear()
        assertNull(store.current)
        assertFalse(f.exists())
    }

    @Test fun corruptBlobMeansSignedOutNotCrash() {
        val f = File(tmp.root, "s.bin").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        assertNull(SessionStore(f, FakeCipher()).current)
        assertFalse(f.exists())
    }
}
