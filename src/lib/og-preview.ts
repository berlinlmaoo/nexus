import prisma from "@/lib/prisma"
import { getFormAccessStatus } from "@/lib/form-access-schedule"
import { formResponseLimit } from "@/lib/form-settings"
import { linkByUrlId } from "@/lib/legal/requests"
import { tokenFromLinkId } from "@/lib/legal/request-rules"
import { PUBLIC_BASE } from "@/lib/vault-share"

/**
 * Link previews for the web app's share links (owner, 27 Oct 2026: a form link pasted in WhatsApp
 * read "NEXUS Phaëthon" instead of the form's name).
 *
 * The web is a static SPA, so its index.html cannot know which form a link opens. For link-preview
 * crawlers (by user agent, the same list as Z Vault's /s/ cards) nginx serves the live index.html through
 * SSI, and the head of that page comes from here (GET /api/og/head?p=<path>, maintenance/phaethon.conf).
 * People, and anything nginx does not take for a crawler, get index.html untouched.
 *
 * Only what a signed-out visitor of that link already sees is ever put in a card, whoever asks: the request's
 * cookies are not read at all. A form that is not public, closed by its schedule or full, an unknown or
 * malformed id, and every page behind sign-in all get the same generic NEXUS card.
 */

export type OgLang = "en" | "id"

export type OgCard = {
  /** og:title — the thing itself ("Pengajuan Finance"), without the site name. */
  title: string
  description: string
  /** <title> — "Pengajuan Finance · NEXUS". */
  documentTitle: string
}

const COPY = {
  en: {
    tagline: "NEXUS by Z Networks: tasks, projects, attendance and chat in one place.",
    formFallback: "Fill in this form on NEXUS.",
    legal: "Legal request",
    legalDesc: (company?: string) =>
      company
        ? `Ask Legal for a document of ${company}. Fill in what you know; Legal completes the rest.`
        : "Ask Legal for a document. Fill in what you know; Legal completes the rest.",
    android: "Get NEXUS for Android",
    androidDesc: "Install the NEXUS app on your Android phone.",
    signIn: "Sign in",
    register: "Request access",
    reset: "Reset password",
  },
  id: {
    tagline: "NEXUS by Z Networks: task, project, absensi, dan chat dalam satu tempat.",
    formFallback: "Isi formulir ini di NEXUS.",
    legal: "Permintaan legal",
    legalDesc: (company?: string) =>
      company
        ? `Minta dokumen ${company} ke Legal. Isi yang kamu tahu; sisanya dilengkapi Legal.`
        : "Minta dokumen ke Legal. Isi yang kamu tahu; sisanya dilengkapi Legal.",
    android: "Pasang NEXUS untuk Android",
    androidDesc: "Pasang aplikasi NEXUS di HP Android kamu.",
    signIn: "Masuk",
    register: "Minta akses",
    reset: "Reset password",
  },
}

const SITE = "NEXUS"

export function ogLang(acceptLanguage: string | null): OgLang {
  // Indonesian unless the crawler asks for English — the same default as the web app and Z Vault's cards.
  return (acceptLanguage || "").trim().toLowerCase().startsWith("en") ? "en" : "id"
}

/** The path nginx passes: only plain path characters (its map lets nothing else through either). */
export function cleanPath(p: string | null): string {
  if (!p || !/^\/[A-Za-z0-9_/-]{0,300}$/.test(p)) return "/"
  return p.replace(/\/+$/, "") || "/"
}

/** Plain text on one line, cut at a word near `max` characters. */
export function clip(s: string | null | undefined, max = 200): string {
  const one = (s ?? "").replace(/\s+/g, " ").trim()
  if (one.length <= max) return one
  const cut = one.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "")}…`
}

function card(title: string, description: string): OgCard {
  return { title, description, documentTitle: `${title} · ${SITE}` }
}

function generic(lang: OgLang): OgCard {
  return { title: SITE, description: COPY[lang].tagline, documentTitle: SITE }
}

async function formCard(id: string, lang: OgLang): Promise<OgCard | null> {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return null
  const form = await prisma.form.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    select: { id: true, name: true, description: true, isPublic: true, accessSchedule: true, settings: true },
  })
  // "Project members only" forms are not for a signed-out visitor at all: nothing about them in a card.
  if (!form || !form.isPublic) return null
  // Closed by its schedule or full: the visitor sees "This form isn't open", not the form.
  if (!getFormAccessStatus(form.accessSchedule).allowed) return null
  const limit = formResponseLimit(form.settings)
  if (limit !== null && (await prisma.formSubmission.count({ where: { formId: form.id } })) >= limit) return null
  // Public, with or without sign-in: the visitor sees its title and description (never the questions).
  const name = clip(form.name, 120)
  if (!name) return null
  return card(name, clip(form.description) || COPY[lang].formFallback)
}

async function legalCard(linkId: string, lang: OgLang): Promise<OgCard | null> {
  const token = tokenFromLinkId(linkId)
  if (!token) return null
  const link = await linkByUrlId(token)
  if (!link) return null
  // The signed-out page names the company ("Ask Legal for a document of …"); nothing else.
  const company = link.company && link.company.active ? link.company.name : undefined
  return card(COPY[lang].legal, COPY[lang].legalDesc(company))
}

export async function ogCardFor(path: string, lang: OgLang): Promise<OgCard> {
  const c = COPY[lang]
  try {
    const f = /^\/f\/([^/]+)$/.exec(path)
    if (f) {
      const id = f[1]
      const made = /^legal-[A-Za-z0-9]{24}$/.test(id) ? await legalCard(id, lang) : await formCard(id, lang)
      return made ?? generic(lang)
    }
    if (path === "/download/android") return card(c.android, c.androidDesc)
    if (path === "/login") return card(c.signIn, c.tagline)
    if (path === "/register") return card(c.register, c.tagline)
    if (path === "/forgot-password") return card(c.reset, c.tagline)
  } catch (error) {
    console.error("[og] card failed:", error)
  }
  return generic(lang)
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/** The tags that go into index.html's <head> in place of its generic ones. */
export function ogHeadHtml(c: OgCard, path: string, lang: OgLang): string {
  const url = esc(`${PUBLIC_BASE}${path === "/" ? "/" : path}`)
  const image = esc(`${PUBLIC_BASE}/apple-touch-icon.png`)
  const t = esc(c.title)
  const d = esc(c.description)
  return [
    `<title>${esc(c.documentTitle)}</title>`,
    `<meta name="description" content="${d}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:locale" content="${lang === "en" ? "en_US" : "id_ID"}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="512" />`,
    `<meta property="og:image:height" content="512" />`,
    `<meta property="og:image:alt" content="${SITE}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    "",
  ].join("\n    ")
}
