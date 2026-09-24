/**
 * Self-service account deletion (App Store guideline 5.1.1(v)).
 *
 * A deleted account is DEACTIVATED and ANONYMISED, never hard-deleted: the company keeps the
 * attendance, task and XP history, and that history keeps pointing at the same User id, which now
 * reads "Deleted account". What makes the row "deleted" is its email: it is rewritten to an address
 * under the reserved `.invalid` TLD (RFC 2606), which can never receive mail and can never be typed
 * in by someone signing up, and it frees the real address so the person may sign up again later.
 *
 * The marker lives in the email rather than a new column on purpose: a column would need a schema
 * push before this could ship, and the email has to be rewritten anyway.
 */

export const DELETED_ACCOUNT_NAME = "Deleted account"
export const DELETED_ACCOUNT_EMAIL_DOMAIN = "deleted.invalid"

export function deletedAccountEmail(userId: string) {
  return `deleted-${userId}@${DELETED_ACCOUNT_EMAIL_DOMAIN}`.toLowerCase()
}

export function isDeletedAccountEmail(email: string | null | undefined) {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${DELETED_ACCOUNT_EMAIL_DOMAIN}`)
}
