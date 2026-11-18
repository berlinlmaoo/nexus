/**
 * Who may print what (owner, 18 Nov 2026: "everyone who can already view that item", no new roles), and who sees
 * which print log rows. The rules are the existing ones, asked through the same functions the item's own screen
 * uses — nothing is re-implemented here:
 *   • a Legal document: Legal is invitation-only, every invited person sees the whole archive
 *     (lib/legal/access.ts legalActor, as GET /api/legal/documents/{id}); a deleted document does not exist;
 *   • a Doc page: bodyAccess(...).read (lib/block-bodies.ts = canReadProjectContent, as GET /api/docs/{id});
 *   • an uploaded file (Print menu, 18 Nov 2026): every member of the company workspace (lib/org.ts isOrgMember), and
 *     only their own upload (someone else's upload id reads as missing);
 *   • the log: your own rows; BoD / One Above All of the company workspace see everyone's (lib/org.ts isOrgBodPlus).
 * The deciding functions are injected so the rules are testable without a database (src/__tests__/print-access.test.ts);
 * lib/print/service.ts wires the real ones.
 */

export type PrintKind = "legal" | "doc" | "upload"
export const PRINT_KINDS: PrintKind[] = ["legal", "doc", "upload"]
export const isPrintKind = (v: unknown): v is PrintKind => v === "legal" || v === "doc" || v === "upload"

export type PrintVerdict =
  | { ok: true }
  | { ok: false; status: 403 | 404; error: string; code?: string }

export type PrintAccessDeps = {
  /** Has Legal (invited or root), lib/legal/access.ts legalActor(...) !== null. */
  hasLegal: (userId: string) => Promise<boolean>
  /** The Legal document exists and is not deleted. */
  legalDocExists: (documentId: string) => Promise<boolean>
  /** lib/block-bodies.ts bodyAccess(userId, "doc", id). */
  docAccess: (userId: string, docId: string) => Promise<{ exists: boolean; read: boolean }>
  /** A member (any role) of the company workspace, lib/org.ts isOrgMember. */
  isMember: (userId: string) => Promise<boolean>
  /** The upload exists, has not expired and was made by this person. */
  ownsUpload: (userId: string, uploadId: string) => Promise<boolean>
}

export async function canPrint(userId: string, kind: PrintKind, refId: string, deps: PrintAccessDeps): Promise<PrintVerdict> {
  if (kind === "legal") {
    // The Legal routes answer "not invited" before they look the document up; so does this.
    if (!(await deps.hasLegal(userId))) return { ok: false, status: 403, error: "Legal is available by invitation only", code: "LEGAL_NOT_INVITED" }
    if (!(await deps.legalDocExists(refId))) return { ok: false, status: 404, error: "Document not found" }
    return { ok: true }
  }
  if (kind === "upload") {
    if (!(await deps.isMember(userId))) return { ok: false, status: 403, error: "Printing is for members of the company workspace", code: "NOT_A_MEMBER" }
    if (!(await deps.ownsUpload(userId, refId))) return { ok: false, status: 404, error: "This upload has expired. Upload the file again.", code: "UPLOAD_GONE" }
    return { ok: true }
  }
  const access = await deps.docAccess(userId, refId)
  if (!access.exists) return { ok: false, status: 404, error: "Not found" }
  if (!access.read) return { ok: false, status: 403, error: "Forbidden" }
  return { ok: true }
}

/** Which rows of the print log a person may list: their own, or (BoD / One Above All) anyone's. */
export function logScope(viewerId: string, seesAll: boolean, askedUserId: string | null | undefined): { userId?: string } | null {
  if (seesAll) return askedUserId ? { userId: askedUserId } : {}
  if (askedUserId && askedUserId !== viewerId) return null
  return { userId: viewerId }
}

/** May this person open one row of the log? */
export function canSeeJob(viewerId: string, seesAll: boolean, job: { userId: string }): boolean {
  return seesAll || job.userId === viewerId
}
