package id.znetworks.nexus.feature.whatsnew

import org.junit.Assert.assertTrue
import org.junit.Test

class WhatsNewTest {
    @Test fun currentVersionHasNotesAndUnknownIsSilent() {
        assertTrue(WhatsNew.entries("0.1.6").isNotEmpty())
        assertTrue(WhatsNew.entries("9.9.9").isEmpty())
    }
}
