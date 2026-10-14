/**
 * The real client IP behind the reverse proxy chain (UI tour run 14, R14-WB-3: every session in
 * Settings › Security showed the same address — the proxy's own hop on the container network — because
 * X-Real-IP was read first, and X-Real-IP is only the address that connected to the last proxy).
 *
 * Trust rule: a forwarded header is believed only as far as the hops that wrote it are our own proxies,
 * i.e. private / loopback / link-local / CGNAT addresses. The client controls everything to the left of
 * the first public hop, so X-Forwarded-For is walked from the RIGHT and the first public address wins;
 * the left-most entry is never taken on trust when a public hop sits to its right.
 *
 *   1. X-Real-IP (overwritten by our nginx with the address that connected to it) is the direct peer.
 *      A public peer IS the client: nothing it sent in other headers is trusted.
 *   2. A private peer is one of our own hops (tunnel connector, host proxy). Then CF-Connecting-IP (set by
 *      the CDN edge, overwritten by nginx for direct LAN clients) is used when it is a valid address.
 *   3. Otherwise X-Forwarded-For right to left: the first public address. When every hop is private the
 *      client is on the local network, and the left-most hop is the best we know.
 *
 * Pure (no node:net) so it runs in any runtime; src/lib/client-ip.test.ts.
 */

type HeaderSource = { get(name: string): string | null } | null | undefined

function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null
}

function isIPv6(s: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(s) || !s.includes(":")) return false
  if ((s.match(/::/g) ?? []).length > 1) return false
  const groups = s.split(":")
  if (groups.length > 8) return false
  const last = groups[groups.length - 1]
  if (last.includes(".") && !parseIPv4(last)) return false
  return groups.every((g, i) => g === "" || (i === groups.length - 1 && g.includes(".")) || /^[0-9a-f]{1,4}$/i.test(g))
}

/**
 * A header value → a bare IP address, or null when it is not one. Strips a port ("1.2.3.4:5678",
 * "[::1]:80"), brackets, a zone id and the IPv4-mapped IPv6 prefix ("::ffff:1.2.3.4" → "1.2.3.4").
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = raw.trim().replace(/^"|"$/g, "")
  if (!s || s.toLowerCase() === "unknown") return null
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s)
  if (bracket) s = bracket[1]
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":"))
  s = s.replace(/%.*$/, "")
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s)
  if (mapped) s = mapped[1]
  if (parseIPv4(s)) return s
  if (isIPv6(s)) return s.toLowerCase()
  return null
}

/**
 * True for addresses that only ever name our own infrastructure or a local network: RFC 1918, loopback,
 * link-local, CGNAT (overlay VPNs), "this network", and the IPv6 equivalents. Also true for anything
 * that is not an IP address at all. Such an address means nothing to a user looking at a session list.
 */
export function isPrivateIp(raw: string | null | undefined): boolean {
  const ip = normalizeIp(raw)
  if (!ip) return true
  const v4 = parseIPv4(ip)
  if (v4) {
    const [a, b] = v4
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  return ip === "::" || ip === "::1" || /^f[cd][0-9a-f]{0,2}:/.test(ip) || /^fe[89ab][0-9a-f]?:/.test(ip)
}

/** The client IP from the proxy headers (see the rule above), or null when the request carries none. */
export function clientIpFromHeaders(h: HeaderSource): string | null {
  if (!h) return null
  const peer = normalizeIp(h.get("x-real-ip"))
  if (peer && !isPrivateIp(peer)) return peer

  const cdn = normalizeIp(h.get("cf-connecting-ip"))
  if (cdn) return cdn

  const hops = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((x) => normalizeIp(x))
    .filter((x): x is string => !!x)
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isPrivateIp(hops[i])) return hops[i]
  }
  return hops[0] ?? peer
}

/** The address worth showing to a person: a public client IP, never a proxy or local-network hop. */
export function displayableIp(raw: string | null | undefined): string | null {
  const ip = normalizeIp(raw)
  return ip && !isPrivateIp(ip) ? ip : null
}
