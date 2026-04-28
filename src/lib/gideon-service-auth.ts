import crypto from 'crypto'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

type GideonAuthSuccess = {
  ok: true
  actor: Awaited<ReturnType<typeof prisma.user.findUnique>> & {}
}

type GideonAuthFailure = {
  ok: false
  response: NextResponse
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return crypto.timingSafeEqual(aBuffer, bBuffer)
}

export async function authenticateGideonService(
  req: Pick<Request, 'headers'>
): Promise<GideonAuthSuccess | GideonAuthFailure> {
  const configuredToken = process.env.NEXUS_GIDEON_SERVICE_TOKEN
  if (!configuredToken) {
    return {
      ok: false,
      response: jsonError('GIDEON service token not configured', 503),
    }
  }

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token || !safeEqual(token, configuredToken)) {
    return {
      ok: false,
      response: jsonError('Unauthorized', 401),
    }
  }

  const actorEmail = process.env.NEXUS_GIDEON_ACTOR_EMAIL
  if (!actorEmail) {
    return {
      ok: false,
      response: jsonError('GIDEON actor not configured', 503),
    }
  }

  const actor = await prisma.user.findUnique({
    where: { email: actorEmail },
  })

  if (!actor) {
    return {
      ok: false,
      response: jsonError('GIDEON actor user not found', 503),
    }
  }

  return { ok: true, actor }
}
