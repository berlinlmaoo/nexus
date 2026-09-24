/**
 * What an uploaded picture really is, read from its first bytes.
 *
 * The iOS app labels some multipart parts `application/octet-stream` (the folder icon, every build
 * from 0.1.4 on — APIClient.uploadFolderIcon), and the upload routes used to trust only the part's
 * Content-Type, so those uploads were refused with a 400 however valid the picture was. A declared
 * type the route already allows is still taken as it is (nothing that worked before changes); only
 * a generic or missing type falls back to the bytes, and the bytes must be one of the formats the
 * route allows. Anything else — a PDF, a HEIC, text, an SVG with no declared type — is refused as
 * before. SVG is deliberately never sniffed: it is a document that can carry script, and it is only
 * accepted where a route allows it AND the client declared it.
 *
 * Pure: no imports, so `node src/lib/image-sniff.test.mjs` can load it directly.
 */

export type SniffedImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp"

/** How many leading bytes `sniffImageType` needs. */
export const IMAGE_SNIFF_BYTES = 16

const GENERIC_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream", "application/x-octet-stream"])

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[offset + i] !== prefix[i]) return false
  }
  return true
}

/** The image format these bytes start with, or null when they are not PNG, JPEG, GIF or WEBP. */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  // JPEG: FF D8 FF (JFIF, EXIF and raw variants all share it)
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  // GIF: "GIF87a" / "GIF89a"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return "image/gif"
  }
  // WEBP: "RIFF" <size:4> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"
  return null
}

/** True for a Content-Type that says nothing about the file: empty, or one of the octet-stream spellings. */
export function isGenericContentType(type: string | null | undefined): boolean {
  return GENERIC_TYPES.has((type ?? "").split(";")[0].trim().toLowerCase())
}

/**
 * The type to store an upload under, or null to refuse it.
 *  - declared type in `allowed` → the declared type, exactly as before this change;
 *  - declared type generic/empty → the sniffed type, if it is in `allowed`;
 *  - anything else → null.
 */
export function resolveImageUploadType(
  declared: string | null | undefined,
  head: Uint8Array,
  allowed: readonly string[],
): string | null {
  const type = declared ?? ""
  if (allowed.includes(type)) return type
  if (!isGenericContentType(type)) return null
  const sniffed = sniffImageType(head)
  return sniffed && allowed.includes(sniffed) ? sniffed : null
}

/** `resolveImageUploadType` for a multipart File: reads only the first bytes, and only when it has to. */
export async function resolveUploadedImageType(file: Blob, allowed: readonly string[]): Promise<string | null> {
  if (allowed.includes(file.type)) return file.type
  if (!isGenericContentType(file.type)) return null
  const head = new Uint8Array(await file.slice(0, IMAGE_SNIFF_BYTES).arrayBuffer())
  return resolveImageUploadType(file.type, head, allowed)
}
