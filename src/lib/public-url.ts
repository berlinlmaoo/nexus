/**
 * The public address of this NEXUS, for links that leave the app — emails, WhatsApp, anything a
 * person clicks from outside.
 *
 * This exists because there were THREE copies of this logic with three different behaviours:
 * `notification-service.ts` refused to emit a localhost link, `attendance-reminders.ts` fell back to
 * NEXTAUTH_URL unconditionally, and `email.ts` used NEXTAUTH_URL alone. The backend runs behind nginx
 * with `NEXTAUTH_URL=http://127.0.0.1:3002`, so the third one wrote that address into every email it
 * sent — invitations, password resets, verification links. All of them dead on arrival.
 *
 * Precedence:
 *   1. NEXUS_PUBLIC_URL — the explicit answer, and the only one that's right behind a proxy.
 *   2. NEXTAUTH_URL, but ONLY if it's already public https. Behind nginx it points at the loopback
 *      address, which is correct for NextAuth (with AUTH_TRUST_HOST the real host comes from the
 *      request) and useless for a link someone opens on their phone.
 *   3. Nothing.
 *
 * NEXTAUTH_URL is deliberately not "fixed" to the public URL instead: it is the address this process
 * is reached at, and conflating it with the address humans use is exactly how this broke.
 */
export function publicBaseUrl(): string {
  const explicit = process.env.NEXUS_PUBLIC_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, "")

  const authUrl = (process.env.NEXTAUTH_URL || "").trim()
  if (/^https:\/\//i.test(authUrl) && !/(localhost|127\.0\.0\.1|\[::1\])/i.test(authUrl)) {
    return authUrl.replace(/\/+$/, "")
  }
  return ""
}

/**
 * A link into the app, or "" when there's no public address configured.
 *
 * Returning "" is deliberate: callers drop the button rather than render one pointing at a loopback
 * address. A missing button is a small annoyance; a dead "Reset password" link is a locked-out user.
 */
export function publicUrl(path: string): string {
  const base = publicBaseUrl()
  if (!base) return ""
  return `${base}/${String(path).replace(/^\/+/, "")}`
}
