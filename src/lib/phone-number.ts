export function normalizeIndonesianPhoneNumber(value: string) {
  const raw = value.trim()

  if (!raw) return null

  const hasPlus = raw.startsWith("+")
  const digits = raw.replace(/[^\d]/g, "")

  if (!digits) return null

  let normalized = digits

  if (digits.startsWith("0")) {
    normalized = `62${digits.slice(1)}`
  } else if (!digits.startsWith("62")) {
    normalized = `62${digits}`
  }

  const e164 = `${hasPlus || normalized.startsWith("62") ? "+" : ""}${normalized}`

  return e164.startsWith("+") ? e164 : `+${e164}`
}

export function isLikelyPhoneNumber(value: string) {
  const normalized = normalizeIndonesianPhoneNumber(value)
  if (!normalized) return false

  return /^\+62\d{8,14}$/.test(normalized)
}
