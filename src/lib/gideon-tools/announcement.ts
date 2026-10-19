import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { ORG_WORKSPACE_ID, orgRoleOf } from "@/lib/org"
import { findPerson, str } from "./util"
import { webError, type ExtraTool, type Input } from "./types"

/**
 * Announcements (owner, 18 Oct 2026): GIDEON drafts one; it is POSTED only from the card, by the person, through
 * Control Room's own POST /api/announcements with their session — so only who may post one by hand (BoD / One Above
 * All) can, the audience / repeat rules are that endpoint's, and the pop-up + push go out exactly as from the page.
 * Someone who may not post gets the draft as text in the chat instead (nothing is held). SP (warning letters) need a
 * PDF and stay on the page.
 */

const TITLE_MAX = 140
const BODY_MAX = 4000
const TONE: Record<string, string> = { info: "Info", success: "Good news", warning: "Important" }

async function describeAnnouncement(actor: User, input: Input) {
  const title = str(input.title)
  const body = typeof input.body === "string" ? input.body.trim() : typeof input.text === "string" ? input.text.trim() : ""
  if (!title || !body) throw new Error("title and body are required: write the announcement in full first.")
  if (title.length > TITLE_MAX) throw new Error(`The title is at most ${TITLE_MAX} characters.`)
  if (body.length > BODY_MAX) throw new Error(`The body is at most ${BODY_MAX} characters.`)
  const role = await orgRoleOf(actor.id)
  if (role !== "BOD" && role !== "ONE_ABOVE_ALL") {
    throw new Error("Only BoD can post announcements. Give the person the draft as text in your reply (title + body) so they can pass it to a BoD; do not say it was posted or queued.")
  }
  const tone = ["info", "success", "warning"].includes(str(input.tone) ?? "") ? (str(input.tone) as string) : "info"
  const names = Array.isArray(input.audience) ? input.audience.filter((x): x is string => typeof x === "string" && !!x.trim()) : typeof input.audience === "string" && !/^(everyone|all|semua)$/i.test(input.audience.trim()) ? input.audience.split(",").map((s) => s.trim()).filter(Boolean) : []
  const targets: { id: string; name: string | null }[] = []
  for (const n of names.slice(0, 50)) targets.push(await findPerson(n))
  if (targets.length) {
    const inOrg = await prisma.workspaceMember.count({ where: { workspaceId: ORG_WORKSPACE_ID, userId: { in: targets.map((t) => t.id) } } })
    if (inOrg !== targets.length) throw new Error("Someone in the audience is not in the company.")
  }
  const repeatDays = Math.min(Math.max(Math.floor(Number(input.repeatDays) || 0), 0), 30)
  const repeatAtTime = str(input.repeatAtTime) ?? ""
  if (repeatDays > 0 && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(repeatAtTime)) throw new Error("To repeat it, give repeatAtTime as HH:mm (24 h, WIB).")
  return {
    summary: `Post “${title}” to ${targets.length ? targets.map((t) => t.name).join(", ") : "everyone"}`.slice(0, 300),
    diff: [
      { field: "Title", to: title },
      { field: "Audience", to: targets.length ? targets.map((t) => t.name ?? "?").join(", ") : "Everyone" },
      { field: "Tone", to: TONE[tone] },
      ...(repeatDays > 0 ? [{ field: "Repeats", to: `Every day at ${repeatAtTime} WIB for ${repeatDays} more day${repeatDays === 1 ? "" : "s"}` }] : []),
      { field: "Announcement", to: body },
    ],
    store: { title, body, tone, targetUserIds: targets.map((t) => t.id), repeatDays, ...(repeatDays > 0 ? { repeatAtTime } : {}) },
    preview: body,
    note: "NOT posted yet. It waits on the card below with the full text; it goes out (pop-up + push to the audience) only when the person taps Post. Say so in one sentence.",
  }
}

export const announcementTools: Record<string, ExtraTool> = {
  draft_announcement: {
    describe: describeAnnouncement,
    stepArg: (i) => str(i.title) ?? null,
    web: async (input, call) => {
      const r = await call({
        method: "POST",
        path: "/api/announcements",
        json: {
          title: input.title, body: input.body, tone: input.tone ?? "info",
          targetUserIds: Array.isArray(input.targetUserIds) ? input.targetUserIds : [],
          repeatDays: Number(input.repeatDays) || 0,
          ...(input.repeatAtTime ? { repeatAtTime: input.repeatAtTime } : {}),
        },
      })
      if (!r.ok) return { ok: false, message: webError(r, "Couldn't post the announcement") }
      return { ok: true, link: "/admin?tab=announcements", result: { announcementId: r.body?.announcement?.id ?? null } }
    },
  },
}
