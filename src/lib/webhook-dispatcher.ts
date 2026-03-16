import crypto from 'crypto'
import prisma from '@/lib/prisma'
import type { InputJsonValue } from '@prisma/client/runtime/client'

interface WebhookPayload {
  event: string
  timestamp: string
  data: Record<string, unknown>
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
      const res = await fetch(url, {
        method: 'POST',
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
      ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}),
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
