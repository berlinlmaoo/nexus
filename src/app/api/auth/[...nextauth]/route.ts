import { Auth, skipCSRFCheck } from "@auth/core"
import { encode } from "next-auth/jwt"
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { handlers, nexusNextAuthConfig } from "@/lib/auth"
import { createLogger } from "@/lib/logger"
import { verifyCredentialUser, type VerifiedCredentialUser } from "@/lib/credentials-auth"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

const log = createLogger("auth-route")
const coreAuthConfig = nexusNextAuthConfig as unknown as Parameters<typeof Auth>[1]
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
const FALLBACK_REDIRECT = "/dashboard"

function getTrustedOrigins(request: NextRequest) {
  const origins = new Set<string>()
  const configuredUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  const forwardedHost = request.headers.get("x-forwarded-host")
  const host = forwardedHost ?? request.headers.get("host")
  const protocol = request.headers.get("x-forwarded-proto") ?? "https"

  if (configuredUrl) {
    try {
      origins.add(new URL(configuredUrl).origin)
    } catch {
      // Ignore invalid deployment URL and fall back to request headers.
    }
  }

  if (host) {
    origins.add(`${protocol}://${host}`)
    origins.add(`https://${host}`)
  }

  return origins
}

function isTrustedAuthPost(request: NextRequest) {
  const trustedOrigins = getTrustedOrigins(request)
  const origin = request.headers.get("origin")
  const referer = request.headers.get("referer")

  if (origin) return trustedOrigins.has(origin)

  if (referer) {
    try {
      return trustedOrigins.has(new URL(referer).origin)
    } catch {
      return false
    }
  }

  // Older WebKit clients may omit both headers. Let Auth.js handle the request;
  // cross-site browsers normally send Origin on POST, so explicit foreign
  // origins are still rejected above.
  return true
}

function getOrigin(request: NextRequest) {
  const configuredUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL

  if (configuredUrl) {
    try {
      return new URL(configuredUrl).origin
    } catch {
      // Fall back to the request URL below.
    }
  }

  return request.nextUrl.origin
}

function isSafeRelativeRedirect(value: unknown) {
  if (typeof value !== "string") return false
  return value.startsWith("/") && !value.startsWith("//")
}

function getRedirectTarget(request: NextRequest, value: unknown) {
  const redirectTo = isSafeRelativeRedirect(value) ? String(value) : FALLBACK_REDIRECT
  return new URL(redirectTo, getOrigin(request)).toString()
}

function shouldUseSecureAuthCookies() {
  return (
    process.env.NODE_ENV === "production" ||
    (process.env.NEXTAUTH_URL?.startsWith("https://") ?? false) ||
    (process.env.AUTH_URL?.startsWith("https://") ?? false)
  )
}

function getSessionCookieName() {
  return `${shouldUseSecureAuthCookies() ? "__Secure-" : ""}authjs.session-token`
}

function getCurrentSessionChunkCookieNames(cookieName: string) {
  return Array.from({ length: 10 }, (_, index) => `${cookieName}.${index}`)
}

async function applyDirectSessionCookies(
  response: NextResponse,
  user: VerifiedCredentialUser,
) {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET

  if (!secret) {
    throw new Error("Missing AUTH_SECRET/NEXTAUTH_SECRET")
  }

  const cookieName = getSessionCookieName()
  const secureCookies = shouldUseSecureAuthCookies()
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
  const sessionToken = await encode({
    secret,
    salt: cookieName,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: {
      sub: user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      picture: user.image,
    },
  })

  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Expires", "0")
  response.headers.set("Clear-Site-Data", '"cache"')

  for (const name of getCurrentSessionChunkCookieNames(cookieName)) {
    response.cookies.set(name, "", {
      path: "/",
      expires: new Date(0),
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
    })
  }

  response.cookies.set(cookieName, sessionToken, {
    path: "/",
    expires,
    maxAge: SESSION_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
  })
}

function credentialsErrorResponse(request: NextRequest, wantsJson: boolean) {
  const url = new URL("/login", getOrigin(request))
  url.searchParams.set("error", "CredentialsSignin")
  url.searchParams.set("code", "credentials")

  if (wantsJson) {
    return NextResponse.json(
      { url: url.toString() },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
    )
  }

  return NextResponse.redirect(url)
}

async function handleLegacyCredentialsCallback(request: NextRequest) {
  const formData = await request.formData()
  const wantsJson =
    request.headers.has("x-auth-return-redirect") ||
    String(formData.get("json") ?? "").toLowerCase() === "true"
  const redirectUrl = getRedirectTarget(request, formData.get("callbackUrl"))
  const result = await verifyCredentialUser(formData.get("email"), formData.get("password"))

  if (!result) {
    return credentialsErrorResponse(request, wantsJson)
  }

  await logAudit({
    action: "login",
    entityType: "user",
    entityId: result.user.id,
    entityName: result.user.name || undefined,
    userId: result.user.id,
    metadata: {
      provider: "credentials",
      legacyCallbackDirectSession: true,
      usedMobileNormalizedPassword: result.usedMobileNormalizedPassword,
    },
  }).catch((error) => {
    log.error("Legacy credentials callback audit failed", {
      userId: result.user.id,
      error: String(error),
    })
  })

  const response = wantsJson
    ? NextResponse.json({ url: redirectUrl })
    : NextResponse.redirect(redirectUrl)

  await applyDirectSessionCookies(response, result.user)
  log.info("Issued direct session for legacy credentials callback", {
    userId: result.user.id,
    wantsJson,
  })

  return response
}

export const { GET } = handlers

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedAuthPost(request)) {
      log.warn("Blocked untrusted auth POST", {
        origin: request.headers.get("origin"),
        referer: request.headers.get("referer"),
      })
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (request.nextUrl.pathname.endsWith("/callback/credentials")) {
      return await handleLegacyCredentialsCallback(request)
    }

    const response = await Auth(request, {
      ...coreAuthConfig,
      skipCSRFCheck,
    } as Parameters<typeof Auth>[1])

    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
    response.headers.set("Pragma", "no-cache")
    response.headers.set("Expires", "0")

    return response
  } catch (error) {
    log.error("Auth POST failed", {
      path: request.nextUrl.pathname,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
