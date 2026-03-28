/** Normalize email for storage and consistent lookups. */
export function canonicalEmail(email: string): string {
  return email.trim().toLowerCase()
}
