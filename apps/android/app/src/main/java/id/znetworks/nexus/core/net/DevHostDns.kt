package id.znetworks.nexus.core.net

import okhttp3.Dns
import java.net.InetAddress

/** Optional local emulator workaround for MagicDNS. URLs, TLS/SNI and certificate checks stay unchanged. */
class DevHostDns(private val host: String, private val address: String, private val enabled: () -> Boolean,
    private val fallback: Dns = Dns.SYSTEM) : Dns {
    override fun lookup(hostname: String): List<InetAddress> =
        if (enabled() && hostname.equals(host, ignoreCase = true) && address.isNotBlank()) listOf(InetAddress.getByName(address))
        else fallback.lookup(hostname)
}
