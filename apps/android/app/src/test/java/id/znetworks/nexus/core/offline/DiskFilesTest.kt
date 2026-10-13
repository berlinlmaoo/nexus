package id.znetworks.nexus.core.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.nio.file.Files

class DiskFilesTest {
    @Test fun keyedByUrlSweptOldestFirstAndClearedAtLogout() {
        val dir = Files.createTempDirectory("nx").toFile()
        DiskFiles.init(dir)
        val a = DiskFiles.fileFor("/api/files/a.jpg", "a.jpg")!!.apply { writeBytes(ByteArray(100)); setLastModified(1_000) }
        DiskFiles.fileFor("/api/files/b.jpg", "b.jpg")!!.apply { writeBytes(ByteArray(100)); setLastModified(2_000) }
        assertEquals(a, DiskFiles.existing("/api/files/a.jpg"))
        assertEquals(200L, DiskFiles.bytes())
        DiskFiles.sweep(150)
        assertNull(DiskFiles.existing("/api/files/a.jpg"))
        assertNotNull(DiskFiles.existing("/api/files/b.jpg"))
        DiskFiles.clear()
        assertEquals(0L, DiskFiles.bytes())
    }
}
