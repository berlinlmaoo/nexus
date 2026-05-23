import { encode } from 'next-auth/jwt'
import { NextRequest, NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { verifyCredentialUser } from '@/lib/credentials-auth'
import { createLogger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const log = createLogger('direct-login')
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
const FALLBACK_REDIRECT = '/dashboard'

function getRequestHost(request: NextRequest) {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  return (forwardedHost ?? request.headers.get('host'))?.split(':')[0]?.toLowerCase()
}

function getRequestOrigin(request: NextRequest) {
  const host = getRequestHost(request)
  const protocol = request.headers.get('x-forwarded-proto') ?? 'https'
  return host ? `${protocol}://${host}` : request.nextUrl.origin
}

function getTrustedOrigins(request: NextRequest) {
  const origins = new Set<string>()
  const configuredUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  const requestOrigin = getRequestOrigin(request)

  if (configuredUrl) {
    try {
      origins.add(new URL(configuredUrl).origin)
    } catch {
      // Ignore invalid deployment URL and fall back to request headers.
    }
  }

  origins.add(requestOrigin)
  if (requestOrigin.startsWith('http://')) {
    origins.add(requestOrigin.replace('http://', 'https://'))
  }

  return origins
}

function isTrustedAuthPost(request: NextRequest) {
  const trustedOrigins = getTrustedOrigins(request)
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  if (origin) return trustedOrigins.has(origin)

  if (referer) {
    try {
      return trustedOrigins.has(new URL(referer).origin)
    } catch {
      return false
    }
  }

  return true
}

function isSafeRelativeRedirect(value: unknown) {
  if (typeof value !== 'string') return false
  return value.startsWith('/') && !value.startsWith('//')
}

function shouldUseSecureAuthCookies() {
  return (
    process.env.NODE_ENV === 'production' ||
    (process.env.NEXTAUTH_URL?.startsWith('https://') ?? false) ||
    (process.env.AUTH_URL?.startsWith('https://') ?? false)
  )
}

function getSessionCookieName() {
  return `${shouldUseSecureAuthCookies() ? '__Secure-' : ''}authjs.session-token`
}

function getCurrentSessionChunkCookieNames(cookieName: string) {
  return Array.from({ length: 10 }, (_, index) => `${cookieName}.${index}`)
}

export async function POST(request: NextRequest) {
  if (!isTrustedAuthPost(request)) {
    log.warn('blocked untrusted direct login POST', {
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer'),
    })
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const email = body?.email
  const password = body?.password
  const redirectTo = isSafeRelativeRedirect(body?.callbackUrl)
    ? String(body.callbackUrl)
    : FALLBACK_REDIRECT

  const result = await verifyCredentialUser(email, password)

  if (!result) {
    return NextResponse.json(
      { ok: false, error: 'CredentialsSignin' },
      {
        status: 401,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
        },
      },
    )
  }

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET

  if (!secret) {
    log.error('direct login failed: missing auth secret')
    return NextResponse.json({ ok: false, error: 'Configuration' }, { status: 500 })
  }

  const cookieName = getSessionCookieName()
  const secureCookies = shouldUseSecureAuthCookies()
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
  const sessionToken = await encode({
    secret,
    salt: cookieName,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: {
      sub: result.user.id,
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      picture: result.user.image,
    },
  })

  await logAudit({
    action: 'login',
    entityType: 'user',
    entityId: result.user.id,
    entityName: result.user.name || undefined,
    userId: result.user.id,
    metadata: {
      provider: 'credentials',
      directSession: true,
      usedMobileNormalizedPassword: result.usedMobileNormalizedPassword,
    },
  }).catch((error) => {
    log.error('direct login audit failed', {
      userId: result.user.id,
      error: String(error),
    })
  })

  const response = NextResponse.json({ ok: true, redirectTo })

  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Expires', '0')
  response.headers.set('Clear-Site-Data', '"cache"')

  for (const name of getCurrentSessionChunkCookieNames(cookieName)) {
    response.cookies.set(name, '', {
      path: '/',
      expires: new Date(0),
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
    })
  }

  response.cookies.set(cookieName, sessionToken, {
    path: '/',
    expires,
    maxAge: SESSION_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies,
  })

  return response
}
