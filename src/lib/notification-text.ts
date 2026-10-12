import prisma from "@/lib/prisma"

/**
 * Notifications in two languages (13 Oct 2026). A notifier writes its title + message in English AND
 * Indonesian (`bi(...)`); the row keeps both in `Notification.texts` and the web shows the viewer's
 * language. `title`/`message` — what old apps, the push and older web builds read — are written in the
 * recipient's chosen language (`User.uiLanguage`), else English — the owner's rule (13 Oct 2026):
 * English by default, Indonesian only for someone who picked Indonesian.
 * Before this every notifier picked one language in code: half the inbox was Indonesian in an English UI
 * and the other half English in an Indonesian one.
 */
export type NotifLang = "en" | "id"
export type NotifText = { title: string; message: string }
export type NotifTexts = { en: NotifText; id: NotifText }

/** Both languages, plus the English title/message (the default) for callers that need a plain pair. */
export function bi(en: [string, string], id: [string, string]): { title: string; message: string; texts: NotifTexts } {
  const texts = { en: { title: en[0], message: en[1] }, id: { title: id[0], message: id[1] } }
  return { ...texts.en, texts }
}

export function isNotifTexts(v: unknown): v is NotifTexts {
  const ok = (x: unknown) => !!x && typeof (x as NotifText).title === "string" && typeof (x as NotifText).message === "string"
  return !!v && typeof v === "object" && ok((v as NotifTexts).en) && ok((v as NotifTexts).id)
}

const cache = new Map<string, { lang: NotifLang | null; at: number }>()
const TTL = 5 * 60_000

/** The language a person chose (null = never chose: English). */
export async function recipientLangs(userIds: string[]): Promise<Map<string, NotifLang | null>> {
  const out = new Map<string, NotifLang | null>()
  const need: string[] = []
  for (const id of new Set(userIds)) {
    const c = cache.get(id)
    if (c && Date.now() - c.at < TTL) out.set(id, c.lang)
    else need.push(id)
  }
  if (need.length) {
    // Never let the language lookup cost a notification: unreadable = English.
    let rows: { id: string; uiLanguage: string | null }[] = []
    try { rows = await prisma.user.findMany({ where: { id: { in: need } }, select: { id: true, uiLanguage: true } }) } catch { rows = [] }
    const got = new Map(rows.map((r) => [r.id, r.uiLanguage === "id" ? "id" : r.uiLanguage === "en" ? "en" : null] as const))
    for (const id of need) {
      const lang: NotifLang | null = got.get(id) ?? null
      cache.set(id, { lang, at: Date.now() })
      out.set(id, lang)
    }
  }
  return out
}
export async function recipientLang(userId: string): Promise<NotifLang | null> {
  return (await recipientLangs([userId])).get(userId) ?? null
}

/** Day "13 Oct" / "13 Okt" in WIB for the given language. */
export function dayText(d: Date, lang: NotifLang, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return d.toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", ...opts }).replace(/\bSept\b/, "Sep")
}

/**
 * Remember a language the person CHOSE (owner, 13 Oct 2026: English unless they picked Indonesian), so
 * notifications made for them later are stored and pushed in it. What reveals a choice (checked against
 * the released apps' source, 13 Oct 2026):
 *   - `PATCH /api/user/profile {uiLanguage}` and the `X-Nexus-Lang: en|id` header (new app builds, the web
 *     language toggle);
 *   - the web showing Indonesian (`X-Nexus-Client: web/…` + Accept-Language id): the web is English
 *     unless someone switched it, so "id" is a choice; its "en" is only the default and records nothing;
 *   - `?lang=` on the pipeline export: released iOS/Android send their in-app language there.
 * NOT the released apps' Accept-Language: iOS URLSession sends the PHONE's languages (the app ignores the
 * phone's language on purpose) and OkHttp sends none.
 */
export function langFromRequest(headers: Headers, url?: string | URL): NotifLang | null {
  const norm = (raw: string | null | undefined): NotifLang | null => {
    const v = (raw ?? "").trim().toLowerCase()
    return v === "id" || v.startsWith("id-") ? "id" : v === "en" || v.startsWith("en-") ? "en" : null
  }
  const explicit = norm(headers.get("x-nexus-lang"))
  if (explicit) return explicit
  if ((headers.get("x-nexus-client") ?? "").startsWith("web") && norm(headers.get("accept-language")) === "id") return "id"
  if (url) {
    try { return norm(new URL(url.toString(), "http://x").searchParams.get("lang")) } catch { return null }
  }
  return null
}

export async function rememberUiLanguage(userId: string, headers: Headers, url?: string | URL): Promise<void> {
  const lang = langFromRequest(headers, url)
  if (!lang) return
  await setUiLanguage(userId, lang)
}

/** Store a chosen language (null clears it: back to English). */
export async function setUiLanguage(userId: string, lang: NotifLang | null): Promise<void> {
  if (lang === null) {
    await prisma.user.update({ where: { id: userId }, data: { uiLanguage: null } }).catch(() => null)
    cache.set(userId, { lang: null, at: Date.now() })
    return
  }
  const c = cache.get(userId)
  if (c && c.lang === lang && Date.now() - c.at < TTL) return
  await prisma.user.updateMany({ where: { id: userId, OR: [{ uiLanguage: null }, { uiLanguage: { not: lang } }] }, data: { uiLanguage: lang } }).catch(() => null)
  cache.set(userId, { lang, at: Date.now() })
}
