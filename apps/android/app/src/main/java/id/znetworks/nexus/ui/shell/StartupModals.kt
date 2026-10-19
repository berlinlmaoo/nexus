package id.znetworks.nexus.ui.shell

internal enum class StartupModal { XP_PENALTY, ANNOUNCEMENT, LOCATION_CONSENT, ALWAYS_LOCATION, PROMO }

/** Hold the visible modal until it finishes; loading announcements reserve their place ahead of prompts. */
internal object StartupModals {
    fun next(current: StartupModal?, announcementsLoading: Boolean, announcements: Boolean, consent: Boolean, alwaysLocation: Boolean, promo: Boolean,
             xpLoading: Boolean = false, xpPenalty: Boolean = false): StartupModal? {
        val pending = mapOf(StartupModal.XP_PENALTY to xpPenalty, StartupModal.ANNOUNCEMENT to announcements, StartupModal.LOCATION_CONSENT to consent,
            StartupModal.ALWAYS_LOCATION to alwaysLocation, StartupModal.PROMO to promo)
        if (current != null && pending[current] == true) return current
        if (xpLoading) return null
        if (xpPenalty) return StartupModal.XP_PENALTY
        if (announcementsLoading) return null
        return StartupModal.entries.firstOrNull { pending[it] == true }
    }
}
