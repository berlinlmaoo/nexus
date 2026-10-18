package id.znetworks.nexus.core.net

import okhttp3.Dns
import java.net.InetAddress
import org.junit.Assert.*
import org.junit.Test

class DevHostDnsTest {
    @Test fun overrideOnlyMatchesTheConfiguredDevHostWhileEnabled() {
        val calls = mutableListOf<String>()
        val fallback = Dns { hostname -> calls += hostname; listOf(InetAddress.getByAddress(byteArrayOf(127,0,0,2))) }
        var enabled = true
        val dns = DevHostDns("dev.example.invalid", "127.0.0.1", { enabled }, fallback)
        assertEquals("127.0.0.1", dns.lookup("dev.example.invalid").single().hostAddress)
        assertTrue(calls.isEmpty())
        assertEquals("127.0.0.2", dns.lookup("other.example.invalid").single().hostAddress)
        enabled = false
        assertEquals("127.0.0.2", dns.lookup("dev.example.invalid").single().hostAddress)
        assertEquals(listOf("other.example.invalid", "dev.example.invalid"), calls)
    }
    @Test fun blankDefaultUsesNormalDns() {
        var called = false
        DevHostDns("dev.example.invalid", "", { true }, Dns { called = true; emptyList() }).lookup("dev.example.invalid")
        assertTrue(called)
    }
}
