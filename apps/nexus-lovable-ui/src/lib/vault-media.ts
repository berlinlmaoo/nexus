import type { VaultItem } from "@/lib/nexus-api";

// ─────────────────────────────────────────────────────────────────────────────
// Z Vault pictures and films on the web (owner, 9 Oct 2026: "I want to see the thumbnail of the
// photo" — a folder of PNGs showed as rows of icons). Which items get a picture tile, where the
// picture comes from, and how it sits in its square. No React here, so a harness can run it as is.
// ─────────────────────────────────────────────────────────────────────────────

export type VaultMediaKind = "image" | "video";

/** Pictures every browser draws in an <img>. HEIC is not one (only Safari), TIFF neither. */
const BROWSER_IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const BROWSER_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/svg+xml"]);
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|tiff?|heic|heif)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i;

/** A picture or a film gets a tile and opens in the viewer; everything else stays a row. */
export function mediaKind(item: Pick<VaultItem, "kind" | "mimeType" | "name">): VaultMediaKind | null {
  if (item.kind !== "FILE") return null;
  const mime = (item.mimeType || "").toLowerCase();
  if (mime.startsWith("image/") || IMAGE_EXT.test(item.name)) return "image";
  if (mime.startsWith("video/") || VIDEO_EXT.test(item.name)) return "video";
  return null;
}

/** Whether the original itself can be drawn by an <img> in any browser. */
export function isBrowserImage(item: Pick<VaultItem, "mimeType" | "name">): boolean {
  const mime = (item.mimeType || "").toLowerCase();
  if (mime === "image/heic" || mime === "image/heif" || mime === "image/tiff") return false;
  return BROWSER_IMAGE_MIME.has(mime) || BROWSER_IMAGE_EXT.test(item.name);
}

/** Originals at most this big are drawn as they are when there is no server thumbnail (an SVG logo,
 *  or a server from before thumbnails): a folder of small logos costs little, a folder of photos would not. */
const SMALL_ORIGINAL = 3 * 1024 * 1024;

/** The tile's picture: the server's thumbnail at `width`, or a small original, or nothing (the icon). */
export function thumbSrc(item: VaultItem, width: number): string | null {
  if (item.thumbUrl) return `${item.thumbUrl}${item.thumbUrl.includes("?") ? "&" : "?"}w=${width}`;
  if (mediaKind(item) === "image" && isBrowserImage(item) && item.url && (item.size ?? Infinity) <= SMALL_ORIGINAL) return item.url;
  return null;
}

/** What the viewer draws full screen: the original when a browser can, else the largest thumbnail. */
export function viewerSrc(item: VaultItem): string | null {
  if (isBrowserImage(item) && item.url) return item.url;
  return item.thumbUrl ? thumbSrc(item, 1280) : null;
}

/**
 * Photographs fill their square, the way a phone's gallery shows them. Formats that usually carry
 * transparency — PNG, GIF, WebP, SVG: the LOGO folder — are shown whole on a checkerboard, so a
 * wordmark is not cropped and a white logo is not lost on a white card.
 */
export function fillsTile(item: Pick<VaultItem, "mimeType" | "name">): boolean {
  const mime = (item.mimeType || "").toLowerCase();
  if (/\.(png|gif|webp|svg)$/i.test(item.name)) return false;
  if (mime === "image/png" || mime === "image/gif" || mime === "image/webp" || mime === "image/svg+xml") return false;
  return true;
}

/** 0:42, 3:07, 1:02:09. Empty for anything that is not a finite number of seconds. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
