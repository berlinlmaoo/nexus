package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDateTime

class RemindersTest {
    @Test fun linksAndNotificationOpenTheNativeList() {
        assertEquals(Target.Reminders, Links.parse("/reminders"))
        assertEquals(Target.Reminders, Links.forNotification(type = "reminder", link = "/reminders", taskId = null, projectId = null))
    }
    @Test fun creationConvertsWibOnceAndCancellationUsesTheRowId() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val api = RemindersApi(ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 36), { Session("t", "c", "u") }, mayCarrySession = { true }))
            server.enqueue(MockResponse.Builder().body("{\"reminder\":{}}").build())
            api.create("  Reminder  ", LocalDateTime.parse("2026-10-20T18:00"))
            val body = NexusJson.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
            assertEquals("Reminder", body["text"]!!.jsonPrimitive.content)
            assertEquals("2026-10-20T11:00:00Z", body["remindAt"]!!.jsonPrimitive.content)
            server.enqueue(MockResponse.Builder().body("{\"reminder\":{}}").build())
            api.cancel("uuid-123")
            assertEquals("/api/reminders/uuid-123", server.takeRequest().target)
        }
    }
}
