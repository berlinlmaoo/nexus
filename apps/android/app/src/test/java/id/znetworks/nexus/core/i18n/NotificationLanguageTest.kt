package id.znetworks.nexus.core.i18n

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.inbox.InboxResponse
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Notifications in the app's language (HANDOFF scope 7; iOS 5aaa3fb; server 13 Oct 2026). */
class NotificationLanguageTest {
    @After fun reset() { AppLanguage.current = AppLanguage.ENGLISH }

    @Test fun serverCodes() {
        assertEquals("id", AppLanguage.serverCode(AppLanguage.INDONESIAN))
        assertEquals("en", AppLanguage.serverCode(AppLanguage.ENGLISH))
        assertEquals("en", AppLanguage.serverCode("fr"))
    }

    @Test fun everyRequestCarriesTheAppLanguage() = runTest {
        val server = MockWebServer(); server.start()
        try {
            val api = ApiClient(server.url("/"), ClientIdentity("0.1.6", 13, 34), sessionProvider = { null })
            server.enqueue(MockResponse.Builder().code(200).body("{}").build())
            server.enqueue(MockResponse.Builder().code(200).body("{}").build())
            api.get("/api/ping", JsonObject.serializer())
            assertEquals("en", server.takeRequest().headers["X-Nexus-Lang"]) // English by default
            AppLanguage.current = AppLanguage.INDONESIAN
            api.get("/api/ping", JsonObject.serializer())
            assertEquals("id", server.takeRequest().headers["X-Nexus-Lang"])
        } finally { server.close() }
    }

    @Test fun inboxShowsTheAppLanguageWhenBothAreThere() {
        val body = """{"notifications":[
            {"id":"a","title":"Task assigned","message":"Budi gave you a task","texts":{"en":{"title":"Task assigned","message":"Budi gave you a task"},"id":{"title":"Task ditugaskan","message":"Budi memberimu task"}}},
            {"id":"b","title":"Old row","message":"Stored once"}],"unreadCount":2}"""
        val list = NexusJson.decodeFromString(InboxResponse.serializer(), body).notifications
        assertEquals("Task assigned", list[0].title)
        AppLanguage.current = AppLanguage.INDONESIAN
        assertEquals("Task ditugaskan", list[0].title); assertEquals("Budi memberimu task", list[0].message)
        assertEquals("Old row", list[1].title) // older rows: as stored
    }

    @Test fun languageIsSentToTheServer() {
        val app = File("src/main/java/id/znetworks/nexus/NexusApplication.kt").readText()
        val container = File("src/main/java/id/znetworks/nexus/core/AppContainer.kt").readText().replace("\r\n", "\n")
        // Launch, sign-in, and every change of the picker.
        assertTrue(app.contains("AppLanguage.onChosen = { container.sendUiLanguage() }"))
        assertTrue(app.contains("container.sendUiLanguage(); container.push.register()"))
        assertTrue(container.contains("appScope.launch { shortcuts.syncPins() }\n                sendUiLanguage()"))
        assertTrue(File("src/main/java/id/znetworks/nexus/feature/auth/Profile.kt").readText().contains("put(\"uiLanguage\", code)"))
    }
}
