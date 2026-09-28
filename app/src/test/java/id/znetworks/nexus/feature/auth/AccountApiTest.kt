package id.znetworks.nexus.feature.auth

import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AccountApiTest {
    private fun o(s: String) = NexusJson.parseToJsonElement(s) as JsonObject

    @Test fun signupShowsTheFirstFieldErrorInFormOrder() {
        val b = o("""{"error":"Validation failed","details":{"password":["Too short"],"email":["Invalid email"]}}""")
        assertEquals("Invalid email", AccountApi.firstValidationMessage(b))
        assertNull(AccountApi.firstValidationMessage(o("""{"error":"x"}""")))
    }

    @Test fun waitsAndAttemptsAreReadFromTheBody() {
        assertEquals(42, AccountApi.retryAfter(o("""{"error":"wait","retryAfterSeconds":42}""")))
        assertEquals(30, AccountApi.retryAfter(o("""{"error":"wait","resendInSeconds":30}""")))
        assertEquals(3, AccountApi.attemptsRemaining(o("""{"error":"Verification code is incorrect.","attemptsRemaining":3}""")))
        assertNull(AccountApi.retryAfter(null))
    }
}
