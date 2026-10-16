package id.znetworks.nexus.feature.admin

import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GoogleWorkspaceTest {
    @Test fun guessesFromTheNexusName() {
        assertEquals(Triple("Muhammad", "Oskar Karim", "muhammad"), GoogleLogic.guess(" Muhammad  Oskar Karim "))
        assertEquals(Triple("Ana", "-", "ana"), GoogleLogic.guess("Ana")) // Google requires a last name
        assertEquals("jos", GoogleLogic.guess("Jo's X").third)
    }

    @Test fun unlinkSendsJsonNullAndOthersAccountsAreLocked() {
        assertEquals(JsonNull, GoogleLogic.linkBody(null)["googleWorkspaceEmail"])
        assertEquals("\"a@z.id\"", GoogleLogic.linkBody("a@z.id")["googleWorkspaceEmail"].toString())
        assertTrue(GoogleLogic.takenByOther(GwAccount("a@z.id", linkedTo = GwLinkedTo("u2", "Bo")), "u1"))
        assertFalse(GoogleLogic.takenByOther(GwAccount("a@z.id", linkedTo = GwLinkedTo("u1", "Me")), "u1"))
        assertFalse(GoogleLogic.takenByOther(GwAccount("a@z.id"), "u1"))
    }
}
