import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { askGideon } from "@/lib/gideon-chat"
import type { LegalActor } from "@/lib/legal/access"
import { diffWords } from "@/lib/legal/diff"
import { buildEditPrompt, checkProposal, parseEditReply, type ProposedChange, type ThreadTurn } from "@/lib/legal/gideon-edit-core"
import { readParagraphs } from "@/lib/legal/paragraphs"
import { LegalVersionError, loadDocForVersions, lockedTextsOf, saveParagraphEdits, versionDocx } from "@/lib/legal/versions"

// GIDEON's precise edit, the I/O half (rules and checks: gideon-edit-core.ts). A request becomes a
// LegalEditProposal: PENDING with before → after per paragraph, or CLARIFY with GIDEON's question. Approving
// applies it as a new version (kind GIDEON) — only if the document is still at the version it was proposed
// on and every "before" still reads the same.

export class LegalGideonError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
  }
}

/** Per person per hour, like the other GIDEON write tools: each request is a full read of a contract. */
const HOURLY_LIMIT = 30

const person = { select: { id: true, name: true, avatar: true } } as const

type ProposalRow = Prisma.LegalEditProposalGetPayload<{ include: { createdBy: typeof person; decidedBy: typeof person } }>

export function serializeProposal(p: ProposalRow) {
  // A CLARIFY row keeps the thread in `changes` instead; only a proposal has a list there.
  const changes = Array.isArray(p.changes) ? (p.changes as unknown as ProposedChange[]) : []
  return {
    id: p.id,
    status: p.status,
    baseVersion: p.baseVersion,
    instruction: p.instruction,
    question: p.question,
    summary: p.summary,
    changes: changes.map((c) => ({ ...c, segments: diffWords(c.before, c.after) })),
    appliedVersion: p.appliedVersion,
    createdBy: p.createdBy,
    decidedBy: p.decidedBy,
    decidedAt: p.decidedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  }
}

const include = { createdBy: person, decidedBy: person } as const

export async function listProposals(documentId: string) {
  const rows = await prisma.legalEditProposal.findMany({ where: { documentId }, include, orderBy: { createdAt: "desc" }, take: 20 })
  return rows.map(serializeProposal)
}

/**
 * Ask GIDEON. `targets`: the paragraphs the person ticked (empty = GIDEON picks). `replyTo`: a CLARIFY proposal
 * this answers — its question and the answer join the prompt.
 */
export async function requestProposal(
  actor: LegalActor,
  documentId: string,
  input: { baseVersion: number; instruction: string; targets: number[]; replyTo?: string; answer?: string },
) {
  const instruction = input.instruction.trim().slice(0, 2000)
  if (!instruction && !input.replyTo) throw new LegalGideonError("Tell GIDEON what to change", 400)
  const doc = await loadDocForVersions(documentId)
  if (input.baseVersion !== doc.currentVersion) throw new LegalGideonError("Someone changed this document meanwhile. Reload first.", 409)
  const recent = await prisma.legalEditProposal.count({ where: { createdById: actor.userId, createdAt: { gte: new Date(Date.now() - 3600_000) } } })
  if (recent >= HOURLY_LIMIT) throw new LegalGideonError("That's a lot of GIDEON requests this hour. Try again later.", 429)

  // The thread: what was asked before, GIDEON's questions, and the answers.
  const thread: ThreadTurn[] = []
  let targets = [...new Set(input.targets.filter((n) => Number.isInteger(n)))]
  let ask = instruction
  if (input.replyTo) {
    const prev = await prisma.legalEditProposal.findFirst({ where: { id: input.replyTo, documentId, status: "CLARIFY" } })
    if (!prev) throw new LegalGideonError("That question was already answered", 409)
    const earlier = (prev.changes as unknown as { thread?: ThreadTurn[]; targets?: number[] }) ?? {}
    thread.push(...(earlier.thread ?? []), { instruction: prev.instruction, question: prev.question ?? "", answer: (input.answer ?? "").trim().slice(0, 2000) })
    if (!targets.length && earlier.targets?.length) targets = earlier.targets
    ask = instruction || prev.instruction
    await prisma.legalEditProposal.update({ where: { id: prev.id }, data: { status: "DISCARDED", decidedById: actor.userId, decidedAt: new Date() } })
  }

  const paragraphs = readParagraphs(await versionDocx(documentId, doc.currentVersion), lockedTextsOf(doc))
  if (targets.some((i) => !paragraphs[i]?.editable)) throw new LegalGideonError("One of the selected paragraphs is locked", 400)
  const reply = await askGideon({
    prompt: buildEditPrompt({ title: `${doc.number ? `${doc.number} — ` : ""}${doc.title}`, paragraphs, targets, instruction: ask, thread }),
    user: actor.name,
    actorEmail: actor.email,
    trigger: "WRITE",
    approvalMode: "always_ask",
    title: `Legal: ${doc.number || doc.title} · ${ask.slice(0, 80)}`,
    model: "luna",
    timeoutMs: 180_000,
    tag: `legal-edit ${documentId}`,
  }).catch((error) => {
    console.error("Legal GIDEON edit failed:", error)
    return null
  })
  if (!reply) throw new LegalGideonError("GIDEON didn't answer. Try again.", 502)

  const parsed = parseEditReply(reply)
  const base = { documentId, baseVersion: doc.currentVersion, instruction: ask, createdById: actor.userId }
  let row: ProposalRow
  if (parsed.kind === "clarify") {
    row = await prisma.legalEditProposal.create({
      data: { ...base, status: "CLARIFY", question: parsed.question, changes: { thread, targets } as unknown as Prisma.InputJsonValue },
      include,
    })
  } else {
    const checked = parsed.kind === "propose" ? checkProposal(paragraphs, targets, parsed.changes) : { ok: false as const, reason: parsed.reason }
    row = checked.ok
      ? await prisma.legalEditProposal.create({ data: { ...base, status: "PENDING", summary: parsed.kind === "propose" ? parsed.summary : "", changes: checked.changes as unknown as Prisma.InputJsonValue }, include })
      : await prisma.legalEditProposal.create({ data: { ...base, status: "FAILED", summary: checked.reason }, include })
  }
  return serializeProposal(row)
}

/** Approve (all changes, or only `indexes`) or discard a PENDING proposal. */
export async function decideProposal(actor: LegalActor, documentId: string, proposalId: string, decision: "approve" | "discard", indexes?: number[]) {
  // Claim it first so two clicks (or two people) can't apply it twice.
  const claimed = await prisma.legalEditProposal.updateMany({
    where: { id: proposalId, documentId, status: "PENDING" },
    data: { status: decision === "approve" ? "APPLYING" : "DISCARDED", decidedById: actor.userId, decidedAt: new Date() },
  })
  if (claimed.count !== 1) throw new LegalGideonError("This proposal was already decided", 409)
  const proposal = await prisma.legalEditProposal.findUniqueOrThrow({ where: { id: proposalId }, include })
  if (decision === "discard") return { proposal: serializeProposal(proposal), version: null, pdfError: null }

  const fail = async (message: string, status = 409) => {
    await prisma.legalEditProposal.update({ where: { id: proposalId }, data: { status: "FAILED", summary: message } })
    throw new LegalGideonError(message, status)
  }
  const doc = await loadDocForVersions(documentId)
  if (doc.currentVersion !== proposal.baseVersion) return fail("The document changed after GIDEON proposed this. Ask again on the new version.")
  const all = Array.isArray(proposal.changes) ? (proposal.changes as unknown as ProposedChange[]) : []
  const chosen = indexes?.length ? all.filter((c) => indexes.includes(c.index)) : all
  if (!chosen.length) return fail("Pick at least one change to apply", 400)
  const now = readParagraphs(await versionDocx(documentId, doc.currentVersion), lockedTextsOf(doc))
  if (chosen.some((c) => now[c.index]?.text !== c.before)) return fail("The text GIDEON proposed to change is no longer the same. Ask again.")
  try {
    const saved = await saveParagraphEdits(actor.userId, documentId, {
      baseVersion: doc.currentVersion,
      edits: chosen.map((c) => ({ index: c.index, text: c.after })),
      kind: "GIDEON",
      note: (proposal.summary || proposal.instruction).slice(0, 500),
      extraChanges: { proposalId, instruction: proposal.instruction, approvedBy: actor.userId },
    })
    const done = await prisma.legalEditProposal.update({ where: { id: proposalId }, data: { status: "APPLIED", appliedVersion: saved.version }, include })
    return { proposal: serializeProposal(done), version: saved.version, pdfError: saved.pdfError }
  } catch (error) {
    if (error instanceof LegalVersionError) return fail(error.message, error.status)
    await prisma.legalEditProposal.update({ where: { id: proposalId }, data: { status: "FAILED", summary: "Applying failed" } })
    throw error
  }
}
