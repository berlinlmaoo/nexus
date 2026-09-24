/**
 * Recognising the Prisma errors a route should answer as a client error instead of a 500.
 *
 * Checked by `code` rather than `instanceof Prisma.PrismaClientKnownRequestError`: the class is
 * re-exported through the generated client and a second copy of it (a test, a script) would fail
 * the instanceof check while carrying the same code.
 *
 * Pure: no imports, so `node src/lib/prisma-errors.test.mjs` can load it directly.
 */

function codeOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : null
}

/** P2002: a unique constraint refused the row — "that already exists". */
export function isUniqueViolation(error: unknown): boolean {
  return codeOf(error) === "P2002"
}

/** P2025: update/delete of a row that is not there. */
export function isRecordNotFound(error: unknown): boolean {
  return codeOf(error) === "P2025"
}
