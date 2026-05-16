import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

const AUTH_COOKIE_BASE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
  "next-auth.callback-url",
  "__Secure-next-auth.callback-url",
]

function getAuthCookieNames() {
  const names = new Set(AUTH_COOKIE_BASE_NAMES)

  // Auth.js may chunk large cookies as `cookie-name.0`, `cookie-name.1`, etc.
  for (const baseName of AUTH_COOKIE_BASE_NAMES) {
    for (let index = 0; index < 10; index += 1) {
      names.add(`${baseName}.${index}`)
    }
  }

  return Array.from(names)
}

export async function POST() {
  const response = NextResponse.json({ ok: true })
  const secure = process.env.NODE_ENV === "production"

  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Expires", "0")
  response.headers.set("Clear-Site-Data", '"cache"')

  for (const name of getAuthCookieNames()) {
    response.cookies.set(name, "", {
      path: "/",
      expires: new Date(0),
      maxAge: 0,
      httpOnly: name.includes("session-token") || name.includes("csrf-token"),
      sameSite: "lax",
      secure,
    })
  }

  return response
}
