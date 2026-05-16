const ZERO_WIDTH_CHARACTERS = /[\u200B-\u200D\uFEFF]/g
const LINE_BREAKS = /\r?\n/g

/** Normalize email for storage and consistent lookups. */
export function canonicalEmail(email: string): string {
  return email
    .normalize("NFKC")
    .replace(ZERO_WIDTH_CHARACTERS, "")
    .trim()
    .toLowerCase()
}

/**
 * Mobile keyboards and chat copy/paste can add invisible characters, line
 * breaks, or full-width punctuation. Keep exact password matching first, then
 * use this as a safe fallback for those input artifacts.
 */
export function normalizePasswordForMobileInput(password: string): string {
  return password
    .normalize("NFKC")
    .replace(ZERO_WIDTH_CHARACTERS, "")
    .replace(LINE_BREAKS, "")
    .trim()
}
