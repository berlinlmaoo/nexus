import { randomUUID } from "node:crypto"
import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { OUTLET_TYPE, outletGate, parseEventFields } from "@/lib/outlet-sales-server"
import { outletToday, reportOpen } from "@/lib/outlet-sales"
import { SOCIAL_TYPE, loadSocialConfig, socialGate, validDay } from "@/lib/social-media-server"
import { METRIC_KEYS, METRIC_MAX, activePlatforms, socialToday } from "@/lib/social-media"
import { count, dayLabel, num, rupiah, str } from "./util"
import { webError, type ExtraTool, type Input } from "./types"

/**
 * Outlet Sales and Social Media Report numbers from chat (owner, 18 Oct 2026). The forms' own rules decide:
 *  - Outlet: a night (event) of an OUTLET_SALES project, Can edit (outletGate "write"); sales = total revenue after
 *    tax / service / discount as ONE amount in rupiah, pax = the people who came; the report opens on the night
 *    itself. Checked with the form's parseEventFields; applied through PATCH …/outlet-sales/events/:id (or POST
 *    …/events for a night not on the board yet) as the person — row lock, audit, realtime.
 *  - Social: one day of a SOCIAL_MEDIA_REPORT project, Can edit (socialGate "record"); views / likes / comments /
 *    shares / posts per platform, whole numbers, never a future day. Applied through PUT …/social-media/days/:date
 *    as the person — per-day lock, only the figures sent change.
 * Money says "Rp"; counts never do (memory nexus-format-angka). Always a card: the numbers feed a team's targets.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/

async function findProject(actor: User, input: Input, type: string, what: string) {
  const id = str(input.projectId)
  const q = str(input.project) ?? str(input.outlet) ?? str(input.report) ?? str(input.name)
  const scope = {
    type: type as never,
    OR: [
      { members: { some: { userId: actor.id } } },
      { workspace: { members: { some: { userId: actor.id, role: { in: ["ONE_ABOVE_ALL" as const, "BOD" as const] } } } } },
    ],
  }
  const rows = await prisma.project.findMany({
    where: { ...scope, ...(id ? { id } : q ? { name: { contains: q, mode: "insensitive" as const } } : {}) },
    select: { id: true, name: true },
    take: 8,
  })
  const exact = q ? rows.filter((r) => r.name.toLowerCase() === q.toLowerCase()) : []
  const pick = exact.length === 1 ? exact : rows
  if (pick.length === 1) return pick[0]
  if (!pick.length) throw new Error(`No ${what} this person can see${q ? ` is named like "${q}"` : ""}.`)
  throw new Error(`Several ${what}s: ${pick.map((r) => r.name).join(", ")}. Ask which one.`)
}

async function gateError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return res.status === 403 ? fallback : body?.error ?? fallback
}

const dayIn = (d: string) => new Date(`${d}T00:00:00.000Z`)

// ── Outlet Sales ──────────────────────────────────────────────────────────────────────────────────────

async function describeOutlet(actor: User, input: Input) {
  const project = await findProject(actor, input, OUTLET_TYPE, "Outlet Sales project")
  const gate = await outletGate(actor.id, project.id, "write")
  if (!gate.ok) throw new Error(await gateError(gate.response, `This person can see ${project.name} but cannot fill its reports (needs Can edit). Tell them so.`))
  const date = str(input.date) ?? outletToday()
  if (!DAY.test(date)) throw new Error("date must be YYYY-MM-DD (the night).")
  if (!reportOpen(date, outletToday())) throw new Error("A night's report opens on the night itself; this date has not come yet.")
  const body: Record<string, unknown> = {}
  const sales = num(input.sales)
  const pax = num(input.pax)
  if (sales !== undefined) body.sales = sales
  if (pax !== undefined) body.pax = pax
  if (!Object.keys(body).length) throw new Error("Give sales (total revenue after tax / service / discount, one rupiah amount) and/or pax (people who came).")
  // The form's own field rules (money and counts whole and ≥ 0, pax an integer, size caps).
  const parsed = parseEventFields(body, "patch")
  if (!parsed.ok) throw new Error(`${parsed.error.field}: ${parsed.error.error}`)

  const nights = await prisma.outletSalesEvent.findMany({ where: { projectId: project.id, date: dayIn(date) }, select: { id: true, name: true, sales: true, pax: true }, take: 10 })
  const want = str(input.event)
  const named = want ? nights.filter((n) => n.name.toLowerCase().includes(want.toLowerCase())) : nights
  let target: { id: string | null; name: string; sales: number | null; pax: number | null }
  if (named.length === 1) target = named[0]
  else if (named.length > 1) throw new Error(`${project.name} has ${named.length} nights on ${date}: ${named.map((n) => n.name).join(", ")}. Ask which one (event).`)
  else if (want) target = { id: null, name: want, sales: null, pax: null }
  else if (nights.length) throw new Error(`No night named like that on ${date}. The nights then are: ${nights.map((n) => n.name).join(", ")}.`)
  else throw new Error(`${project.name} has no night on ${date} yet. Ask for the event's name (event) to add it with these numbers.`)

  const diff: { field: string; from?: string | null; to: string; toDay?: string }[] = [
    { field: "Project", to: project.name },
    { field: "Date", to: dayLabel(date) ?? date, toDay: date },
    { field: "Event", to: target.id ? target.name : `${target.name} (new night · malam baru)` },
  ]
  if (parsed.data.sales !== undefined) diff.push({ field: "Sales", from: target.sales !== null ? rupiah(target.sales) : "—", to: parsed.data.sales === null ? "—" : rupiah(parsed.data.sales as number) })
  if (parsed.data.pax !== undefined) diff.push({ field: "Pax", from: target.pax !== null ? count(target.pax) : "—", to: parsed.data.pax === null ? "—" : count(parsed.data.pax as number) })
  return {
    summary: `${target.id ? "Fill" : "Add"} ${target.name} · ${dayLabel(date)} in ${project.name}`,
    projectId: project.id,
    diff,
    store: { projectId: project.id, eventId: target.id, name: target.name, date, fields: parsed.data, clientRequestId: `gideon-${randomUUID()}` },
    note: "NOT saved yet. It waits on the card below and is saved in the outlet's report when the person confirms. Say sales in rupiah and pax as a plain count.",
  }
}

// ── Social Media Report ───────────────────────────────────────────────────────────────────────────────

async function describeSocial(actor: User, input: Input) {
  const project = await findProject(actor, input, SOCIAL_TYPE, "Social Media Report project")
  const gate = await socialGate(actor.id, project.id, "record")
  if (!gate.ok) throw new Error(await gateError(gate.response, `This person can see ${project.name} but cannot fill it (needs Can edit). Tell them so.`))
  const date = str(input.date) ?? socialToday()
  if (!validDay(date)) throw new Error("date must be YYYY-MM-DD.")
  if (date > socialToday()) throw new Error("That day has not passed yet. Fill the report after the day.")
  const config = await loadSocialConfig(project.id)
  const plats = activePlatforms(config)
  const pname = str(input.platform)
  const platform = pname
    ? plats.find((p) => p.name.toLowerCase() === pname.toLowerCase()) ?? (plats.filter((p) => p.name.toLowerCase().includes(pname.toLowerCase())).length === 1 ? plats.find((p) => p.name.toLowerCase().includes(pname.toLowerCase())) : undefined)
    : plats.length === 1 ? plats[0] : undefined
  if (!platform) throw new Error(`Say which platform: ${plats.map((p) => p.name).join(", ")}.`)
  const figures: Record<string, number> = {}
  for (const k of METRIC_KEYS) {
    const v = num(input[k])
    if (v === undefined) continue
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k}: a whole number, not negative.`)
    if (v > METRIC_MAX[k]) throw new Error(`${k}: that number is too big.`)
    figures[k] = v
  }
  const notes: Record<string, string> = {}
  const worked = str(input.worked)
  const didnt = str(input.didntWork)
  if (worked) notes.worked = worked.slice(0, 2000)
  if (didnt) notes.didntWork = didnt.slice(0, 2000)
  if (!Object.keys(figures).length && !Object.keys(notes).length) throw new Error("Give at least one of views, likes, comments, shares, posts (or what worked / didn't).")
  const cur = await prisma.socialMediaDay.findUnique({ where: { projectId_date_platformId: { projectId: project.id, date: dayIn(date), platformId: platform.id } } })
  const label: Record<string, string> = { views: "Views", likes: "Likes", comments: "Comments", shares: "Shares", posts: "Posts" }
  const diff: { field: string; from?: string | null; to: string; toDay?: string }[] = [
    { field: "Project", to: project.name },
    { field: "Date", to: dayLabel(date) ?? date, toDay: date },
    { field: "Platform", to: platform.name },
  ]
  for (const [k, v] of Object.entries(figures)) {
    const was = (cur as Record<string, unknown> | null)?.[k]
    diff.push({ field: label[k], from: typeof was === "number" ? count(was) : "—", to: count(v) })
  }
  if (notes.worked) diff.push({ field: "What worked", to: notes.worked })
  if (notes.didntWork) diff.push({ field: "What didn't", to: notes.didntWork })
  return {
    summary: `${platform.name} · ${dayLabel(date)} in ${project.name}`,
    projectId: project.id,
    diff,
    store: { projectId: project.id, date, body: { platforms: { [platform.id]: figures }, ...notes } },
    note: "NOT saved yet. It waits on the card below and is saved in the report when the person confirms. Counts are plain numbers, never Rp.",
  }
}

export const outletSocialTools: Record<string, ExtraTool> = {
  log_outlet_sales: {
    describe: describeOutlet,
    stepArg: (i) => str(i.project) ?? str(i.outlet) ?? null,
    web: async (input, call) => {
      const pid = String(input.projectId)
      const fields = (input.fields && typeof input.fields === "object" ? input.fields : {}) as Record<string, unknown>
      const r = input.eventId
        ? await call({ method: "PATCH", path: `/api/projects/${pid}/outlet-sales/events/${String(input.eventId)}`, json: fields })
        : await call({ method: "POST", path: `/api/projects/${pid}/outlet-sales/events`, json: { name: String(input.name), date: String(input.date), ...fields, clientRequestId: String(input.clientRequestId) } })
      if (!r.ok) return { ok: false, message: webError(r, "Couldn't save the numbers") }
      return { ok: true, link: `/projects/${pid}?date=${String(input.date)}`, result: { eventId: (r.body?.id as string | undefined) ?? input.eventId ?? null } }
    },
  },
  log_social_media_day: {
    describe: describeSocial,
    stepArg: (i) => str(i.project) ?? null,
    web: async (input, call) => {
      const pid = String(input.projectId)
      const r = await call({ method: "PUT", path: `/api/projects/${pid}/social-media/days/${String(input.date)}`, json: input.body ?? {} })
      if (!r.ok) return { ok: false, message: webError(r, "Couldn't save the numbers") }
      return { ok: true, link: `/projects/${pid}?date=${String(input.date)}`, result: { changed: r.body?.changed ?? [] } }
    },
  },
}
