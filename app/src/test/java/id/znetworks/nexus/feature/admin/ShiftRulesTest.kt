package id.znetworks.nexus.feature.admin

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShiftRulesTest {
    @Test fun bothOrNeitherAndNotEqualOvernightAllowed() {
        assertTrue(ShiftRules.pairOk("22:00", "06:00"))
        assertTrue(ShiftRules.pairOk(null, null))
        assertFalse(ShiftRules.pairOk("09:00", null))
        assertFalse(ShiftRules.pairOk("09:00", "09:00"))
        assertFalse(ShiftRules.pairOk("24:00", "08:00"))
        assertFalse(ShiftRules.pairOk("9:00", "17:00"))
    }
}
