package id.znetworks.nexus.ui.theme

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppThemeTest {
    @Test fun explicitDarkOverridesLightSystem() {
        assertTrue(AppTheme.DARK.resolveDark(systemDark = false))
    }

    @Test fun explicitLightOverridesDarkSystem() {
        assertFalse(AppTheme.LIGHT.resolveDark(systemDark = true))
    }

    @Test fun systemChoiceFollowsBothSystemModes() {
        assertFalse(AppTheme.SYSTEM.resolveDark(systemDark = false))
        assertTrue(AppTheme.SYSTEM.resolveDark(systemDark = true))
    }
}
