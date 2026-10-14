package id.znetworks.nexus.feature.auth

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class AccountApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: AccountApi

    @Before fun setUp() {
        server = MockWebServer(); server.start()
        api = AccountApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 6, 36), { Session("t", "c", "u") }, mayCarrySession = { true }))
    }
    @After fun tearDown() { server.close() }

    // owner 29 Sep (iOS f068bbf): changing the email needs the current password; the server requires it.
    @Test fun emailChangeSendsTheCurrentPassword() = runTest {
        server.enqueue(MockResponse.Builder().code(200).body("""{"email":"new@z.id","resendCooldownSeconds":60}""").build())
        val sent = api.changeEmailRequest(" new@z.id ", "s3cret pass")
        assertEquals("new@z.id", sent.email)
        val body = NexusJson.decodeFromString(JsonObject.serializer(), server.takeRequest().body!!.utf8())
        assertEquals(JsonPrimitive("new@z.id"), body["email"])
        assertEquals(JsonPrimitive("s3cret pass"), body["currentPassword"]) // as typed, never trimmed
    }
}
