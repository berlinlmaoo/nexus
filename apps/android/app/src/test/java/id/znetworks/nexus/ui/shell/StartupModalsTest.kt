package id.znetworks.nexus.ui.shell

import org.junit.Assert.*
import org.junit.Test

class StartupModalsTest {
    @Test fun xpLoadingReservesFirstPlaceAndPendingXpPrecedesAnnouncementLoading() {
        assertNull(StartupModals.next(null, false, true, true, true, true, xpLoading = true))
        assertEquals(StartupModal.XP_PENALTY, StartupModals.next(null, true, true, true, true, true, xpPenalty = true))
        assertEquals(StartupModal.ANNOUNCEMENT, StartupModals.next(StartupModal.ANNOUNCEMENT, false, true, true, true, true, xpPenalty = true))
        assertEquals(StartupModal.ANNOUNCEMENT, StartupModals.next(StartupModal.XP_PENALTY, false, true, true, true, true))
    }
    @Test fun loadingReservesPriorityAndAVisibleModalIsNeverPreempted() {
        assertNull(StartupModals.next(null, true, false, true, true, true))
        assertEquals(StartupModal.ANNOUNCEMENT, StartupModals.next(null, false, true, true, true, true))
        assertEquals(StartupModal.LOCATION_CONSENT, StartupModals.next(null, false, false, true, true, true))
        assertEquals(StartupModal.PROMO, StartupModals.next(StartupModal.PROMO, true, true, true, true, true))
        assertEquals(StartupModal.ANNOUNCEMENT, StartupModals.next(StartupModal.PROMO, false, true, true, true, false))
        assertEquals(StartupModal.ALWAYS_LOCATION, StartupModals.next(StartupModal.LOCATION_CONSENT, false, false, false, true, true))
    }
}
