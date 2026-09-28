/**
 * Session revocation by a per-user counter (User.sessionVersion).
 *
 * Sessions are stateless JWTs — the web cookie and the iOS app's Keychain copy alike — so nothing
 * could end them before they expired. Every token minted from now on carries the user's
 * `sessionVersion`; bumping the column ends every token that carries an older number, on its very
 * next request (the jwt callback in lib/auth.ts answers "signed out", exactly as it does for a
 * deleted account).
 *
 * A token WITHOUT the field — every session issued before this change, including every iOS app
 * signed in today — stays valid: refusing those would sign everybody out on deploy.
 *
 * Pure: no imports, so `node src/lib/session-version.test.mjs` can load it directly.
 */

/**
 * True when a token must be refused: it has no sessionVersion (issued before 24 Sep 2026 — owner,
 * 29 Sep 2026: those sessions could never be revoked, so everyone signs in again once), or it is not
 * the user's current one.
 */
export function sessionVersionRejects(tokenVersion: unknown, currentVersion: number): boolean {
  if (tokenVersion === undefined || tokenVersion === null) return true
  return Number(tokenVersion) !== currentVersion
}

/**
 * Whether the caller is the web app (X-Nexus-Client: web/<n>). Only the browser can take a fresh
 * session from the response (Set-Cookie on the same origin); no iOS build (0.1.4–0.1.6) reads a new
 * token out of a password-change response, so revoking sessions from an app caller would sign that
 * very person out.
 */
export function isWebClientTag(tag: string | null | undefined): boolean {
  return /^web\//i.test((tag ?? "").trim())
}
