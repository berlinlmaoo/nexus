package id.znetworks.nexus.core.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** DEV-REDESIGN.md (12 Oct 2026): Settings › Server switches between Production and the DEV server. */
class ServerEnvTest {
    @Test fun unknownOrMissingIsProduction() {
        assertEquals(ServerEnv.PRODUCTION, ServerEnv.of(null))
        assertEquals(ServerEnv.PRODUCTION, ServerEnv.of("staging"))
        assertEquals(ServerEnv.DEV, ServerEnv.of("dev"))
        // The DEV host is a build setting (gradle property nexusDevHost), never a literal in the sources.
        assertTrue(NexusConfig.DEV_HOST.isNotBlank())
        assertFalse(File("src/main/java/id/znetworks/nexus/core/net/NexusConfig.kt").readText().contains(".ts.net"))
        assertEquals("https://${NexusConfig.DEV_HOST}:8443", ServerEnv.DEV.base)
    }

    @Test fun theCookieGoesOnlyToTheChosenServer() {
        val before = NexusConfig.env
        try {
            NexusConfig.env = ServerEnv.PRODUCTION
            assertEquals(NexusConfig.PUBLIC_BASE, NexusConfig.base)
            assertTrue(NexusConfig.isNexusHost("nexus.znetworks.id")); assertTrue(NexusConfig.isNexusHost("lan.nexus.znetworks.id"))
            assertFalse(NexusConfig.isNexusHost(NexusConfig.DEV_HOST))
            NexusConfig.env = ServerEnv.DEV
            assertEquals(NexusConfig.DEV_BASE, NexusConfig.base)
            assertTrue(NexusConfig.isNexusHost(NexusConfig.DEV_HOST))
            assertFalse(NexusConfig.isNexusHost("nexus.znetworks.id")); assertFalse(NexusConfig.isNexusHost("lan.nexus.znetworks.id"))
            assertFalse(NexusConfig.isNexusHost("evil." + NexusConfig.DEV_HOST))
        } finally { NexusConfig.env = before }
    }

    @Test fun wiring() {
        val src = "src/main/java/id/znetworks/nexus"
        // Loaded before the container; every client reads the chosen base.
        val app = File("$src/NexusApplication.kt").readText()
        assertTrue(app.indexOf("ServerEnvStore.load(this)") in 0 until app.indexOf("AppContainer(this)"))
        assertTrue(File("$src/core/net/ApiClient.kt").readText().contains("ApiClient(NexusConfig.base.toHttpUrl()"))
        val container = File("$src/core/AppContainer.kt").readText()
        assertTrue(container.contains("NexusConfig.base, session"))
        // Sign out on the old server (waiting for its calls), then save and relaunch.
        val sw = container.substringAfter("suspend fun switchServer").substringBefore("fun serverSwitchHeld")
        assertTrue(sw.indexOf("auth.signOut()") < sw.indexOf("signOutWork?.join()"))
        assertTrue(sw.indexOf("signOutWork?.join()") < sw.indexOf("ServerEnvStore.save"))
        assertTrue(sw.indexOf("ServerEnvStore.save") < sw.indexOf("ServerEnvStore.relaunch"))
        // No DEV session ever reaches the office LAN host.
        assertTrue(File("$src/core/net/LanRoute.kt").readText().contains("if (NexusConfig.env != ServerEnv.PRODUCTION) return@probe false"))
        listOf("ui/shell/SignedInShell.kt", "feature/outlet/OutletScreen.kt", "feature/forms/FormBuilderModels.kt").forEach {
            assertFalse(it, File("$src/$it").readText().contains("PUBLIC_BASE +"))
        }
        // Settings card, centred dialog, badge on every screen, the way back on the sign-in screen.
        assertTrue(File("$src/feature/auth/AccountScreen.kt").readText().contains("ServerCard()"))
        val dialog = File("$src/ui/components/ServerSwitch.kt").readText()
        assertTrue(dialog.contains("AlertDialog(")); assertTrue(dialog.contains("serverSwitchHeld()")); assertTrue(dialog.contains("signOutBlocked()"))
        assertTrue(File("$src/MainActivity.kt").readText().contains("DevBadge()"))
        val login = File("$src/feature/auth/LoginScreen.kt").readText()
        assertTrue(login.contains("ServerSwitchDialog(id.znetworks.nexus.core.net.ServerEnv.PRODUCTION)"))
        listOf("values", "values-in").forEach { v ->
            val s = File("src/main/res/$v/strings.xml").readText()
            listOf("server_caps", "server_hint", "server_production", "server_dev", "server_dev_badge", "server_switch_title", "server_switch_body",
                "server_switch_body_signed_in", "server_switch_dev_note", "server_switch_cta", "server_switch_cta_signed_in",
                "server_switch_blocked_title", "server_switch_blocked_workday", "server_switch_blocked_queue", "login_server_dev")
                .forEach { assertEquals("$v $it", 1, Regex("name=\"$it\"").findAll(s).count()) }
        }
    }
}
