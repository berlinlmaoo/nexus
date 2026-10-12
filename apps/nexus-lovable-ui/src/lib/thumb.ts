/**
 * A small version of an uploaded avatar or project icon (perf pass, 12 Oct 2026). The server answers
 * `?w=64|128|256` on /api/files/avatars/* and /api/files/project-icons/* with a WebP of at most that many
 * pixels; the originals are phone photos of 1–2.5 MB drawn at 24–40 px. Other URLs (Google photos, system
 * avatars, emoji) pass through unchanged.
 */
export function thumbUrl<T extends string | null | undefined>(url: T, cssPx: number): T {
  if (!url || !/^\/api\/files\/(avatars|project-icons)\//.test(url) || /[?&]w=/.test(url)) return url;
  const dpr = typeof window !== "undefined" ? Math.min(Math.max(window.devicePixelRatio || 1, 1), 3) : 2;
  const need = cssPx * Math.max(dpr, 2);
  const w = need <= 64 ? 64 : need <= 128 ? 128 : 256;
  return `${url}${url.includes("?") ? "&" : "?"}w=${w}` as T;
}
