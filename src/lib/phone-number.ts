// Normalise a phone number to E.164. An explicit leading "+" is RESPECTED as-is, so international numbers
// (e.g. +65…, +1…) keep their own country code instead of being forced to +62. Without "+", Indonesian
// local conventions apply (08… → +62…, 62… → +62…, bare digits → assume +62 — type "+" for foreign).
export function normalizeIndonesianPhoneNumber(value: string) {
  const raw = value.trim()
  if (!raw) return null

  const hasPlus = raw.startsWith("+")
  const digits = raw.replace(/[^\d]/g, "")
  if (!digits) return null

  if (hasPlus) return `+${digits}`                          // explicit international → keep its country code
  if (digits.startsWith("0")) return `+62${digits.slice(1)}` // ID local "08…"
  if (digits.startsWith("62")) return `+${digits}`           // already +62
  return `+62${digits}`                                      // bare local digits → assume Indonesia
}

export function isLikelyPhoneNumber(value: string) {
  const normalized = normalizeIndonesianPhoneNumber(value)
  if (!normalized) return false

  return /^\+\d{8,15}$/.test(normalized) // any valid-length E.164, not just +62
}
