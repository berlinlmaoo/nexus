import crypto from 'crypto'
import { promises as dns } from 'dns'
import net from 'net'
import prisma from '@/lib/prisma'
import type { InputJsonValue } from '@prisma/client/runtime/client'

interface WebhookPayload {
  event: string
  timestamp: string
  data: Record<string, unknown>
}

// ── Outbound URL safety (SSRF) ───────────────────────────────────
// A webhook makes THIS server POST to a URL a user typed. It must never reach the server itself, the
// LAN (NAS, Postgres, Proxmox), Tailscale (CGNAT 100.64/10) or cloud metadata. Checked when the URL is
// saved AND again before every delivery (DNS can change in between).

function ipv4Blocked(ip: string): boolean {
  const [a, b] = ip.split('.').map((n) => Number(n))
  if (a === 0 || a === 10 || a === 127) return true // "this" network, private, loopback
  if (a === 169 && b === 254) return true // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT / Tailscale
  if (a === 192 && b === 0) return true // 192.0.0.0/24 IETF + 192.0.2.0/24 docs
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast, reserved, broadcast
  return false
}

function ipv6Blocked(ip: string): boolean {
  const v = ip.toLowerCase()
  if (v === '::' || v === '::1') return true // unspecified, loopback
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) // IPv4-mapped
  if (mapped) return ipv4Blocked(mapped[1])
  if (v.startsWith('::ffff:')) return true // mapped in hex form: refuse rather than decode
  const first = parseInt(v.split(':')[0] || '0', 16)
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true // multicast
  if (v.startsWith('64:ff9b:')) return true // NAT64 → could reach an IPv4 private address
  return false
}

export function isBlockedAddress(ip: string): boolean {
  const kind = net.isIP(ip)
  if (kind === 4) return ipv4Blocked(ip)
  if (kind === 6) return ipv6Blocked(ip)
  return true
}

/** Why this URL may not be a webhook target, or null when it may. Resolves the hostname. */
export async function webhookUrlError(rawUrl: unknown): Promise<string | null> {
  if (typeof rawUrl !== 'string') return 'Invalid URL'
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return 'Invalid URL'
  }
  if (parsed.protocol !== 'https:') return 'Webhook URL must use https'
  if (parsed.username || parsed.password) return 'Webhook URL must not contain credentials'
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (!host) return 'Invalid URL'
  let addresses: { address: string }[]
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true })
  } catch {
    return 'Webhook host does not resolve'
  }
  if (addresses.length === 0) return 'Webhook host does not resolve'
  if (addresses.some((a) => isBlockedAddress(a.address))) {
    return 'Webhook URL points to a private or internal address'
  }
  return null
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

async function deliverWebhook(
  webhookId: string,
  url: string,
  secret: string,
  payload: WebhookPayload,
  maxRetries = 3
) {
  const body = JSON.stringify(payload)
  const signature = signPayload(body, secret)
  let statusCode: number | null = null
  let response = ''
  let success = false

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Re-checked before every attempt: the host may have been re-pointed since the URL was saved.
      const blocked = await webhookUrlError(url)
      if (blocked) {
        response = blocked
        statusCode = null
        break
      }
      const res = await fetch(url, {
        method: 'POST',
        // A redirect would be followed to wherever it points, past the check above.
        redirect: 'manual',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': payload.event,
          'X-Webhook-Timestamp': payload.timestamp,
        },
        signal: AbortSignal.timeout(10000),
      })

      statusCode = res.status
      response = await res.text().catch(() => '')
      success = res.ok

      if (success) break
    } catch (err) {
      response = err instanceof Error ? err.message : 'Unknown error'
      statusCode = null
    }

    if (attempt < maxRetries) {
      // Exponential backoff: 1s, 4s, 9s
      await new Promise((r) => setTimeout(r, attempt * attempt * 1000))
    }
  }

  await prisma.webhookDelivery.create({
    data: {
      webhookId,
      event: payload.event,
      payload: payload as unknown as InputJsonValue,
      statusCode,
      response: response.slice(0, 1000),
      success,
      attempts: Math.min(maxRetries, 3),
    },
  })

  return success
}

export async function dispatchWebhookEvent(
  event: string,
  data: Record<string, unknown>,
  projectId?: string
) {
  const webhooks = await prisma.webhook.findMany({
    where: {
      active: true,
      events: { has: event },
      // No project → only global webhooks; a project webhook never hears about other projects.
      ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : { projectId: null }),
    },
  })

  if (webhooks.length === 0) return

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  }

  // Fire and forget - don't block the request
  for (const webhook of webhooks) {
    deliverWebhook(webhook.id, webhook.url, webhook.secret, payload).catch(
      () => {}
    )
  }
}
