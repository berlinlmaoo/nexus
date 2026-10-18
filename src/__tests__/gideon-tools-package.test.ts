// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The GIDEON tools package (owner, 18 Oct 2026) — the plumbing every tool relies on:
 *  - an "always" write (send_message) is a card in EVERY approval mode, "don't ask" included, and never runs straight
 *    from the model (no run → refused, nothing sent);
 *  - a "modes" write (create_reminder) runs directly in "don't ask" and is a card in "review";
 *  - Apply of a package card needs `confirm: { proposalId }` (released apps: 409 NEEDS_LATEST_APP, stays PENDING);
 *  - a `web` Apply goes to the NEXUS endpoint AS the person: their cookie forwarded, X-Nexus-Client web/1, a local
 *    /api/ path only; a double tap applies once.
 * The registry is a stub (lib/gideon-tools); meta.ts, the tools route and the proposals route are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const w = vi.hoisted(() => {
  process.env.NEXUS_GIDEON_SERVICE_TOKEN = 'svc'
  return { mode: 'dont_ask' as string, proposals: [] as any[], seq: 0, applied: [] as any[], calls: [] as any[], noRun: false }
})

vi.mock('@/lib/collab-rooms', () => ({}))
vi.mock('@/lib/gideon-service-auth', () => ({ authenticateGideonService: vi.fn(async () => ({ ok: true, actor: { id: 'actor-1', name: 'Asker', email: 'asker@example.test' } })) }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'actor-1' } })) }))
vi.mock('@/lib/gideon-tools', async () => {
  const meta = await import('@/lib/gideon-tools/meta')
  const tools: Record<string, any> = {
    send_message: {
      describe: async (_a: any, input: any) => ({ summary: 'Send a message to Rina', diff: [{ field: 'To', to: 'Rina' }, { field: 'Message', to: input.text }], store: { text: input.text, target: { conversationId: 'c-1' } }, preview: input.text, note: 'NOT sent yet.' }),
      web: async (input: any, call: any) => {
        const r = await call({ method: 'POST', path: '/api/conversations/c-1/messages', json: { content: input.text } })
        return r.ok ? { ok: true, link: '/messages/c-1' } : { ok: false, message: r.body?.error ?? 'x' }
      },
    },
    create_reminder: {
      describe: async (_a: any, input: any) => ({ summary: `Remind you: ${input.text}`, diff: [{ field: 'Reminder', to: input.text }] }),
      apply: async (_a: any, input: any) => { w.applied.push(input); return { created: true, link: '/reminders' } },
    },
  }
  return {
    EXTRA_DISABLED_TEXT: 'not available yet',
    extraToolEnabled: async (a: string) => a !== 'create_sheet',
    extraTool: (a: string) => (meta.isExtraAction(a) && tools[a]) || null,
    runExtraTool: async (actor: any, action: string, input: any, opts: any) => {
      const m = meta.EXTRA_TOOL_META[action]
      if (m.write && !opts.approved && !(opts.direct && m.approval === 'modes')) throw new Error('This always waits for the person to confirm it on a card in the NEXUS GIDEON chat. Nothing was changed.')
      return tools[action].apply(actor, input)
    },
  }
})

vi.mock('@/lib/prisma', () => {
  const match = (p: any, where: any) => Object.entries(where).every(([k, v]) => p[k] === v)
  return {
    default: {
      $executeRaw: vi.fn(async () => 1),
      gideonRun: {
        findUnique: vi.fn(async () => (w.noRun ? null : { id: 'run-1', userId: 'actor-1', approvalMode: w.mode, trigger: 'CHAT', status: 'RUNNING', startedAt: new Date(), projectId: null })),
        findFirst: vi.fn(async () => null),
      },
      gideonRunStep: { create: vi.fn(async () => ({ id: 'st1' })) },
      gideonProposal: {
        create: vi.fn(async ({ data }: any) => { const p = { id: `prop-${++w.seq}`, status: 'PENDING', createdAt: new Date(), result: null, error: null, ...data }; w.proposals.push(p); return p }),
        findFirst: vi.fn(async ({ where }: any) => w.proposals.find((p) => match(p, where)) ?? null),
        findUnique: vi.fn(async ({ where }: any) => w.proposals.find((p) => p.id === where.id) ?? null),
        updateMany: vi.fn(async ({ where, data }: any) => { const hit = w.proposals.filter((p) => match(p, where)); hit.forEach((p) => Object.assign(p, data)); return { count: hit.length } }),
        update: vi.fn(async ({ where, data }: any) => { const p = w.proposals.find((x) => x.id === where.id); Object.assign(p, data); return p }),
      },
      user: { findUnique: vi.fn(async () => ({ email: 'asker@example.test' })), findMany: vi.fn(async () => []) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'STAFF' })), findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    },
  }
})

import { POST as TOOLS } from '@/app/api/gideon/tools/route'
import { POST as DECIDE } from '@/app/api/gideon/proposals/[id]/route'

const tool = (action: string, input: Record<string, unknown>) =>
  TOOLS(new Request('http://x/api/gideon/tools', { method: 'POST', headers: { 'x-gideon-run': 'run-1', 'content-type': 'application/json' }, body: JSON.stringify({ action, input }) }))
const decide = (id: string, body: Record<string, unknown>) =>
  DECIDE(new Request(`http://x/api/gideon/proposals/${id}`, { method: 'POST', headers: { cookie: '__Secure-authjs.session-token=SESSION', 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any, { params: Promise.resolve({ id }) })

const realFetch = globalThis.fetch
beforeEach(() => {
  w.mode = 'dont_ask'; w.proposals = []; w.seq = 0; w.applied = []; w.calls = []; w.noRun = false
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    w.calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ message: { id: 'm-1' } }), { status: 201, headers: { 'content-type': 'application/json' } })
  }) as any
})
afterEach(() => { globalThis.fetch = realFetch })

describe('always-card writes (send_message)', () => {
  it('is a card even in "don\'t ask", with the exact text kept for the card', async () => {
    const res = await tool('send_message', { with: 'Rina', text: 'Meeting jam 4 ya' })
    const body = await res.json()
    expect(body.data.proposed).toBe(true)
    expect(body.data.note).toBe('NOT sent yet.')
    expect(w.proposals).toHaveLength(1)
    expect(w.proposals[0].input.preview).toBe('Meeting jam 4 ya')
    expect(w.calls).toHaveLength(0)
  })

  it('never runs straight from the model (no GIDEON run)', async () => {
    w.noRun = true
    const res = await tool('send_message', { with: 'Rina', text: 'hi' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/confirm it on a card/)
    expect(w.calls).toHaveLength(0)
  })

  it('a released app (no confirm) cannot apply it; the card stays waiting', async () => {
    await tool('send_message', { with: 'Rina', text: 'hi' })
    const res = await decide('prop-1', { decision: 'apply' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('NEEDS_LATEST_APP')
    expect(w.proposals[0].status).toBe('PENDING')
    expect(w.calls).toHaveLength(0)
  })

  it('applies through the person\'s own session, once', async () => {
    await tool('send_message', { with: 'Rina', text: 'hi there' })
    const res = await decide('prop-1', { decision: 'apply', confirm: { proposalId: 'prop-1' } })
    expect(res.status).toBe(200)
    const view = (await res.json()).proposal
    expect(view.status).toBe('APPLIED')
    expect(view.extra.link).toBe('/messages/c-1')
    expect(w.calls).toHaveLength(1)
    const c = w.calls[0]
    expect(c.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/conversations\/c-1\/messages$/)
    expect(c.init.headers.cookie).toContain('SESSION')
    expect(c.init.headers['x-nexus-client']).toBe('web/1')
    expect(JSON.parse(c.init.body)).toEqual({ content: 'hi there' })
    const again = await decide('prop-1', { decision: 'apply', confirm: { proposalId: 'prop-1' } })
    expect(again.status).toBe(409)
    expect(w.calls).toHaveLength(1)
  })

  it('a confirm for another proposal does not apply this one', async () => {
    await tool('send_message', { with: 'Rina', text: 'hi' })
    const res = await decide('prop-1', { decision: 'apply', confirm: { proposalId: 'prop-9' } })
    expect(res.status).toBe(409)
    expect(w.calls).toHaveLength(0)
  })
})

describe('"modes" writes (create_reminder)', () => {
  it('runs directly in "don\'t ask"', async () => {
    const res = await tool('create_reminder', { text: 'follow up vendor', at: '2026-10-19T09:00' })
    const body = await res.json()
    expect(body.data.created).toBe(true)
    expect(w.applied).toHaveLength(1)
    expect(w.proposals).toHaveLength(0)
  })

  it('is a card in "review", applied in-process on confirm', async () => {
    w.mode = 'review'
    const res = await tool('create_reminder', { text: 'follow up vendor', at: '2026-10-19T09:00' })
    expect((await res.json()).data.proposed).toBe(true)
    expect(w.applied).toHaveLength(0)
    // Apply goes through the tools route (x-gideon-approved) as the person.
    globalThis.fetch = vi.fn(async (_url: any, init: any) => TOOLS(new Request('http://x/api/gideon/tools', { method: 'POST', headers: init.headers, body: init.body }))) as any
    const done = await decide('prop-1', { decision: 'apply', confirm: { proposalId: 'prop-1' } })
    expect(done.status).toBe(200)
    expect((await done.json()).proposal.extra.link).toBe('/reminders')
    expect(w.applied).toHaveLength(1)
  })
})
