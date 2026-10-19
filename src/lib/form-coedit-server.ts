/**
 * Server side of live form co-editing (A-12, 19 Oct 2026): apply a batch of ops (lib/form-ops.ts) to one
 * form under its row lock, bump `Form.version`, and tell the `form:<id>` room.
 *
 * One request = one transaction = one version step. Two requests for the same form never interleave: the
 * second waits on `SELECT … FOR UPDATE` and applies its ops to the form as the first one left it, so both
 * people's changes to different parts land and the version only goes up. The legacy whole-form PATCH
 * (released apps) takes the same row through its compare-and-swap on updatedAt, so it can never write over
 * an op-based change it did not see: it gets 409 FORM_CHANGED like before.
 */
import prisma from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import type { InputJsonValue } from "@prisma/client/runtime/client"
import { applyFormOps, editStateOf, type ApplyResult, type FormEditState, type FormOp } from "@/lib/form-ops"
import { generateUniqueFormSlug } from "@/lib/form-slugs"
import { emitFormOps } from "@/lib/socket-emitter"

const json = (value: unknown) => (value === null || value === undefined ? Prisma.DbNull : (value as InputJsonValue))

/** What the builder needs of a form (no submissions): the GET ?lite=1 shape, the ops reply and the room event. */
export const BUILDER_FORM_SELECT = {
  id: true, name: true, slug: true, description: true, fields: true, branding: true, accessSchedule: true, settings: true,
  isPublic: true, requireAuth: true, createdAt: true, updatedAt: true, projectId: true, version: true,
  _count: { select: { submissions: true } },
} as const

export type BuilderForm = Prisma.FormGetPayload<{ select: typeof BUILDER_FORM_SELECT }>

export type ApplyOutcome =
  | { ok: true; form: BuilderForm; version: number; applied: FormOp[]; skipped: ApplyResult["skipped"]; changed: boolean }
  | { ok: false; status: 404; code: "FORM_NOT_FOUND" }

export async function applyFormOpsToForm(formId: string, ops: FormOp[]): Promise<ApplyOutcome> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Form" WHERE id = ${formId} FOR UPDATE`
    if (locked.length === 0) return { ok: false as const, status: 404 as const, code: "FORM_NOT_FOUND" as const }
    const row = await tx.form.findUniqueOrThrow({ where: { id: formId } })
    const result = applyFormOps(editStateOf(row), ops)
    if (!result.changed) {
      // Nothing moved (a retry, or only skipped ops): no write, no version step, no event.
      const form = await tx.form.findUniqueOrThrow({ where: { id: formId }, select: BUILDER_FORM_SELECT })
      return { ok: true as const, form, version: form.version, applied: result.applied, skipped: result.skipped, changed: false }
    }
    const s: FormEditState = result.state
    const slug = row.slug ?? await generateUniqueFormSlug(tx as unknown as typeof prisma, s.name, row.id)
    const form = await tx.form.update({
      where: { id: formId },
      data: {
        name: s.name,
        description: s.description,
        fields: s.fields as unknown as InputJsonValue,
        isPublic: s.isPublic,
        requireAuth: s.requireAuth,
        accessSchedule: json(s.accessSchedule),
        branding: json(s.branding),
        settings: json(s.settings),
        ...(!row.slug ? { slug } : {}),
        version: { increment: 1 },
      },
      select: BUILDER_FORM_SELECT,
    })
    return { ok: true as const, form, version: form.version, applied: result.applied, skipped: result.skipped, changed: true }
  }, { timeout: 15_000, maxWait: 10_000 })
}

/** The room event after a write (ops or a whole-form save). Sent after the commit, so a refetch sees it. */
export function announceFormChange(params: {
  form: BuilderForm
  kind: "ops" | "replace"
  ops: FormOp[]
  actor: { id: string; name: string | null }
  originTab: string | null
}) {
  const { form, kind, ops, actor, originTab } = params
  emitFormOps(form.projectId, form.id, {
    formId: form.id,
    projectId: form.projectId,
    version: form.version,
    kind,
    ops,
    actor: { id: actor.id, name: actor.name ?? null },
    originTab,
    form: builderSnapshot(form),
    at: new Date().toISOString(),
  })
}

/** The form fields the room event carries: everything the builder shows, nothing about responses' content. */
export function builderSnapshot(form: BuilderForm) {
  return {
    id: form.id, name: form.name, slug: form.slug, description: form.description, fields: form.fields,
    branding: form.branding, accessSchedule: form.accessSchedule, settings: form.settings,
    isPublic: form.isPublic, requireAuth: form.requireAuth, updatedAt: form.updatedAt, version: form.version,
    projectId: form.projectId,
  }
}
