import prisma from "@/lib/prisma"

/**
 * Notifications in two languages (13 Oct 2026). A notifier writes its title + message in English AND
 * Indonesian (`bi(...)`); the row keeps both in `Notification.texts` and the web shows the viewer's
 * language. `title`/`message` — what old apps, the push and older web builds read — are written in the
 * recipient's language: `User.uiLanguage` (remembered from the web's Accept-Language), else English.
 * Before this every notifier picked one language in code: half the inbox was Indonesian in an English UI
 * and the other half English in an Indonesian one.
 */
export type NotifLang = "en" | "id"
export type NotifText = { title: string; message: string }
export type NotifTexts = { en: NotifText; id: NotifText }

/** Both languages, plus English title/message for callers that need a plain pair. */
export function bi(en: [string, string], id: [string, string]): { title: string; message: string; texts: NotifTexts } {
  const texts = { en: { title: en[0], message: en[1] }, id: { title: id[0], message: id[1] } }
  return { title: en[0], message: en[1], texts }
}

export function isNotifTexts(v: unknown): v is NotifTexts {
  const ok = (x: unknown) => !!x && typeof (x as NotifText).title === "string" && typeof (x as NotifText).message === "string"
  return !!v && typeof v === "object" && ok((v as NotifTexts).en) && ok((v as NotifTexts).id)
}

const cache = new Map<string, { lang: NotifLang; at: number }>()
const TTL = 5 * 60_000

/** The language a person's stored notification text (and push) is written in. */
export async function recipientLangs(userIds: string[]): Promise<Map<string, NotifLang>> {
  const out = new Map<string, NotifLang>()
  const need: string[] = []
  for (const id of new Set(userIds)) {
    const c = cache.get(id)
    if (c && Date.now() - c.at < TTL) out.set(id, c.lang)
    else need.push(id)
  }
  if (need.length) {
    const rows = await prisma.user.findMany({ where: { id: { in: need } }, select: { id: true, uiLanguage: true } }).catch(() => [])
    const got = new Map(rows.map((r) => [r.id, r.uiLanguage === "id" ? "id" : "en"] as const))
    for (const id of need) {
      const lang: NotifLang = got.get(id) ?? "en"
      cache.set(id, { lang, at: Date.now() })
      out.set(id, lang)
    }
  }
  return out
}
export async function recipientLang(userId: string): Promise<NotifLang> {
  return (await recipientLangs([userId])).get(userId) ?? "en"
}

/** Day "13 Oct" / "13 Okt" in WIB for the given language. */
export function dayText(d: Date, lang: NotifLang, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return d.toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", ...opts }).replace(/\bSept\b/, "Sep")
}

/**
 * Remember the interface language the web is showing (its Accept-Language is exactly the UI language,
 * "en" or "id"), so notifications made for this person later are stored and pushed in it. Only the web
 * client: an app's header is the phone's language, not the app's.
 */
export async function rememberUiLanguage(userId: string, headers: Headers): Promise<void> {
  if (!(headers.get("x-nexus-client") ?? "").startsWith("web")) return
  const raw = (headers.get("accept-language") ?? "").trim().toLowerCase()
  const lang: NotifLang | null = raw === "id" || raw.startsWith("id-") ? "id" : raw === "en" || raw.startsWith("en-") ? "en" : null
  if (!lang) return
  const c = cache.get(userId)
  if (c && c.lang === lang && Date.now() - c.at < TTL) return
  await prisma.user.updateMany({ where: { id: userId, OR: [{ uiLanguage: null }, { uiLanguage: { not: lang } }] }, data: { uiLanguage: lang } }).catch(() => null)
  cache.set(userId, { lang, at: Date.now() })
}
