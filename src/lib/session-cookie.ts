/**
 * The name of the session cookie, which auth.js also uses as the JWT salt.
 *
 * This lives in one place because it once did not. A second copy of the rule was written with only
 * the URL checks and without the NODE_ENV one, so it derived `authjs.session-token` where the rest
 * of the app derived `__Secure-authjs.session-token`. The salt is part of the decryption, so tokens
 * minted by that route were accepted at sign-in and then rejected by every request afterwards —
 * you were let in, and then quietly logged out the moment you touched anything.
 *
 * Any route that mints a session must import this rather than restate it.
 */
export function shouldUseSecureAuthCookies() {
  return (
    process.env.NODE_ENV === "production" ||
    (process.env.NEXTAUTH_URL?.startsWith("https://") ?? false) ||
    (process.env.AUTH_URL?.startsWith("https://") ?? false)
  )
}

export function getSessionCookieName() {
  return `${shouldUseSecureAuthCookies() ? "__Secure-" : ""}authjs.session-token`
}
