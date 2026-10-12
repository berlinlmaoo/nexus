import dns from "node:dns"
import net from "node:net"

/**
 * Outbound TCP from the server: IPv4 only, one connect attempt per address (12 Oct 2026).
 *
 * Node 20 turns on "happy eyeballs" by default (net autoSelectFamily): when a host has IPv4 and IPv6
 * addresses, the IPv4 connect gets 250 ms, then Node gives up on it and tries IPv6. Our containers have
 * no IPv6 (connect fails at once with ENETUNREACH) and Google's endpoints answer from ~230 ms away, so
 * any event-loop stall while a connect is in flight lets the 250 ms timer fire first. The request then
 * dies with an AggregateError [ETIMEDOUT, ENETUNREACH] whose message is empty — gaxios reports
 * "request to https://oauth2.googleapis.com/token failed, reason: " and the attendance sheet cron
 * (every minute) failed on roughly half its runs. A lone `node -e` never stalls, so it always worked
 * there. Dockerfile.prod already passes --no-network-family-autoselection to the build for the same
 * reason (next/font, 5 Oct 2026); the runtime never had it.
 *
 * Called from instrumentation.ts before anything else, so it covers every outbound call of the process
 * (Google Sheets/Drive/Directory/finance, APNs, FCM, GIDEON). Returns what it applied.
 */
export function preferSingleIpv4Connect(): { autoSelectFamily: boolean; resultOrder: string | null } {
  if (typeof net.setDefaultAutoSelectFamily === "function") net.setDefaultAutoSelectFamily(false)
  // With one attempt per connect, the first address must be the reachable one.
  if (typeof dns.setDefaultResultOrder === "function") dns.setDefaultResultOrder("ipv4first")
  return {
    autoSelectFamily: typeof net.getDefaultAutoSelectFamily === "function" ? net.getDefaultAutoSelectFamily() : false,
    resultOrder: typeof (dns as { getDefaultResultOrder?: () => string }).getDefaultResultOrder === "function"
      ? (dns as { getDefaultResultOrder: () => string }).getDefaultResultOrder()
      : null,
  }
}
