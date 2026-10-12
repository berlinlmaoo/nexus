/**
 * Form-level settings and look (form builder rebuild, 12 Oct 2026, Notion-style).
 *
 * `Form.settings` (JSON, nullable): what happens around a response — the confirmation screen, the
 * submit button's text, a response cap and who hears about each new response. `Form.branding` (JSON,
 * existed already): the page's look. The builder adds `icon` (an emoji) and `cover` (a preset key
 * "preset:<name>" or an image URL); the older keys (logoUrl, primaryColor, backgroundColor,
 * headerImage) are kept as they are.
 *
 * Released iOS/Android apps ignore both: they read `fields`, `accessSchedule`, `isPublic`,
 * `requireAuth` only. Everything here is additive.
 */

export interface FormSettings {
  /** Heading on the "sent" screen. Empty = the client's default ("Sent. Thank you!"). */
  confirmationTitle?: string
  /** Body text on the "sent" screen. */
  confirmationMessage?: string
  /** Text of the submit button. Empty = the client's default ("Send"). */
  submitLabel?: string
  /** Stop accepting answers after this many responses (counted over every submission of the form). */
  responseLimit?: number
  /** People notified (in-app + push) on every new response. */
  notifyUserIds?: string[]
}

export interface FormBranding {
  logoUrl?: string
  primaryColor?: string
  backgroundColor?: string
  headerImage?: string
  icon?: string
  cover?: string
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined)

export function normalizeFormSettings(value: unknown): FormSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const limit = Number(input.responseLimit)
  const notify = Array.isArray(input.notifyUserIds)
    ? Array.from(new Set(input.notifyUserIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))).slice(0, 50)
    : []
  const out: FormSettings = {
    ...(str(input.confirmationTitle, 120) ? { confirmationTitle: str(input.confirmationTitle, 120) } : {}),
    ...(str(input.confirmationMessage, 1000) ? { confirmationMessage: str(input.confirmationMessage, 1000) } : {}),
    ...(str(input.submitLabel, 40) ? { submitLabel: str(input.submitLabel, 40) } : {}),
    ...(Number.isInteger(limit) && limit > 0 ? { responseLimit: Math.min(limit, 1_000_000) } : {}),
    ...(notify.length ? { notifyUserIds: notify } : {}),
  }
  return Object.keys(out).length ? out : null
}

/** What a respondent may see: never the notify list. */
export function publicFormSettings(value: unknown) {
  const s = normalizeFormSettings(value)
  if (!s) return null
  const { confirmationTitle, confirmationMessage, submitLabel } = s
  const out = { confirmationTitle, confirmationMessage, submitLabel }
  return Object.values(out).some(Boolean) ? out : null
}

export function formResponseLimit(value: unknown): number | null {
  return normalizeFormSettings(value)?.responseLimit ?? null
}

export const RESPONSE_LIMIT_MESSAGE = "This form has reached its response limit and is closed."

const COVER_PRESET = /^preset:[a-z0-9-]{1,32}$/
const IMAGE_URL = /^(https:\/\/|\/api\/files\/)[^\s"'<>]{1,500}$/

export function normalizeFormBranding(value: unknown): FormBranding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const cover = str(input.cover, 520)
  const out: FormBranding = {
    ...(str(input.logoUrl, 520) ? { logoUrl: str(input.logoUrl, 520) } : {}),
    ...(str(input.primaryColor, 32) ? { primaryColor: str(input.primaryColor, 32) } : {}),
    ...(str(input.backgroundColor, 32) ? { backgroundColor: str(input.backgroundColor, 32) } : {}),
    ...(str(input.headerImage, 520) ? { headerImage: str(input.headerImage, 520) } : {}),
    // An emoji (a few code points, ZWJ sequences included) — not free text.
    ...(str(input.icon, 16) ? { icon: str(input.icon, 16) } : {}),
    ...(cover && (COVER_PRESET.test(cover) || IMAGE_URL.test(cover)) ? { cover } : {}),
  }
  return Object.keys(out).length ? out : null
}
