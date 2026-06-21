// Map filename extensions → MIME types, used to recover a usable type when the browser-provided
// file.type is empty or the generic application/octet-stream (common from Android Chrome, some iOS
// share-sheets, and .mov drag-drop). A trustworthy stored mimeType lets the UI mount a <video>/<img>
// instead of a non-playable "download" card.
const EXT_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp", heic: "image/heic", heif: "image/heif",
  pdf: "application/pdf",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v", ogv: "video/ogg", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac",
  txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
}

export function mimeFromName(name: string | null | undefined, fallback = "application/octet-stream"): string {
  const m = (name ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)
  return (m && EXT_MIME[m[1]]) || fallback
}

// Trust the browser-provided type unless it's missing or the generic octet-stream, then derive from the
// filename. Always returns a non-empty string.
export function resolveMime(providedType: string | null | undefined, name: string | null | undefined): string {
  const t = (providedType ?? "").trim()
  if (t && t.toLowerCase() !== "application/octet-stream") return t
  return mimeFromName(name, t || "application/octet-stream")
}
