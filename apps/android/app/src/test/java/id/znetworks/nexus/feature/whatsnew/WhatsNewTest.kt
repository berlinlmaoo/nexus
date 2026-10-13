package id.znetworks.nexus.feature.whatsnew

import org.junit.Assert.assertTrue
import org.junit.Test

class WhatsNewTest {
    @Test fun currentVersionHasNotesAndUnknownIsSilent() {
        assertTrue(WhatsNew.entries("0.1.6").isNotEmpty())
        assertTrue(WhatsNew.entries("9.9.9").isEmpty())
        // 0.1.6 final (iOS 22c4ecb): the multi-date leave line.
        assertTrue(WhatsNew.entries("0.1.6").any { it.title == id.znetworks.nexus.R.string.wn_leave_multi && it.body == null })
    }
}
