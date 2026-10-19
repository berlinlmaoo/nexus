/**
 * Links made before the UUIDv7 conversion (18 Oct 2026, docs/internal/UUID-MIGRATION.md) name rows by
 * their old ids: /projects/<cuid>/tasks/<cuid>, ?request=<cuid>, sent in chats, WhatsApp, emails and
 * pushes. The API resolves old ids by itself, but the page would keep the old id in its address and
 * compare it with the new ids it loads. So: one round trip to swap them, then a replace navigation.
 */
const OLD_ID = /(?<![A-Za-z0-9])(c[a-z0-9]{24}|[0-9a-f]{32})(?![A-Za-z0-9])/;
const tried = new Set<string>();

export async function resolveLegacyLocation(href: string): Promise<string | null> {
  if (!OLD_ID.test(href) || tried.has(href)) return null;
  tried.add(href);
  try {
    const res = await fetch(`/api/legacy-ids?path=${encodeURIComponent(href)}`, {
      credentials: "include",
      headers: { "X-Nexus-Client": "web/1" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { path?: unknown };
    return typeof body.path === "string" && body.path !== href && body.path.startsWith("/") ? body.path : null;
  } catch {
    return null;
  }
}
