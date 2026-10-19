/**
 * Which shape GET /api/docs/:id gives the page body in (no imports: unit-tested with plain node).
 *
 *   "canonical"  the stored TipTap JSON, lossless (lib/blockdoc.ts sanitizeDoc — the same document the live
 *                room and POST /api/collab/edit's merge start from). Opt-in only: `?format=canonical` or the
 *                header `X-Nexus-Doc-Format: canonical`, from any client. Used by the Android editor (G5,
 *                parity audit 19 Oct 2026) as the `base` it sends to POST /api/collab/edit.
 *   "blocknote"  the released Android app without the opt-in: BlockNote blocks (lib/blockdoc.ts
 *                docToBlockNote), which is what its reader understands. Flattens marks, lists, details and
 *                unknown blocks, so it must never be used as a merge base.
 *   "stored"     everyone else (web, iOS): the stored JSON as is (today's behaviour, unchanged).
 */
export type DocReadFormat = "canonical" | "blocknote" | "stored"

export const DOC_FORMAT_PARAM = "format"
export const DOC_FORMAT_HEADER = "x-nexus-doc-format"

const isCanonical = (v: string | null | undefined) => typeof v === "string" && v.trim().toLowerCase() === "canonical"

export function docReadFormat(input: { platform: string | null | undefined; formatParam: string | null | undefined; formatHeader: string | null | undefined }): DocReadFormat {
  if (isCanonical(input.formatParam) || isCanonical(input.formatHeader)) return "canonical"
  return input.platform === "android" ? "blocknote" : "stored"
}

/** The blockdoc helpers the shaping needs (passed in, so this file stays import-free). */
export type DocShapeDeps<D> = {
  sanitize: (input: unknown) => D | null
  empty: D
  toBlockNote: (doc: { type?: unknown }) => unknown
}

/**
 * The `content` a format gives. "canonical" always returns a document ({ type: "doc", content: [...] }):
 * an empty or unreadable body becomes the empty document, exactly what the live room loads (loadBody).
 */
export function docContentFor<D>(format: DocReadFormat, content: unknown, deps: DocShapeDeps<D>): unknown {
  if (format === "canonical") return deps.sanitize(content) ?? deps.empty
  if (format === "blocknote") {
    const c = content as { type?: unknown } | null | undefined
    return c && typeof c === "object" && c.type === "doc" ? deps.toBlockNote(c) : content
  }
  return content
}
