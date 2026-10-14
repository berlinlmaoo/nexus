import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// Legal requests (owner, 14 Oct 2026): who may see what. The board is Legal's alone; a requester sees only
// their own requests and downloads only their own final / signed file; an addendum request answers the same
// whatever parent number was typed, and never looks it up.

const session = { current: null as null | { user: { id: string } } }
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => session.current) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }))
vi.mock('@/lib/notification-service', () => ({
  notifyLegalRequestNew: vi.fn(async () => undefined),
  notifyLegalRequestStage: vi.fn(async () => undefined),
}))
vi.mock('@/lib/socket-emitter', () => ({ emitWorkspaceChanged: vi.fn() }))
vi.mock('@/lib/org', () => ({ ORG_WORKSPACE_ID: 'org', orgRoleOf: vi.fn(async () => 'STAFF') }))
vi.mock('@/lib/file-response', () => ({
  serveFile: vi.fn(async (_req: unknown, path: string) => NextResponse.json({ served: path })),
}))

const REQUESTS = [
  { id: 'req-mine', requesterId: 'u-staff', documentId: 'doc-mine' },
  { id: 'req-other', requesterId: 'u-other', documentId: 'doc-other' },
  { id: 'req-draft', requesterId: 'u-staff', documentId: 'doc-draft' },
]
const DOCS: Record<string, { id: string; number: string; title: string; status: string; currentVersion: number; finalVersion: number | null; signedVersion: number | null; deletedAt: null }> = {
  'doc-mine': { id: 'doc-mine', number: 'PATS/SPK/001', title: 'Mine', status: 'SIGNED', currentVersion: 3, finalVersion: 2, signedVersion: 3, deletedAt: null },
  'doc-other': { id: 'doc-other', number: 'PATS/SPK/002', title: 'Other', status: 'SIGNED', currentVersion: 3, finalVersion: 2, signedVersion: 3, deletedAt: null },
  'doc-draft': { id: 'doc-draft', number: 'PATS/SPK/003', title: 'Draft', status: 'DRAFT', currentVersion: 1, finalVersion: null, signedVersion: null, deletedAt: null },
}
const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => row[k] === v)

vi.mock('@/lib/prisma', () => {
  const fn = () => vi.fn()
  return {
    default: {
      user: { findUnique: fn(), findMany: fn() },
      legalMember: { findMany: fn() },
      legalRequest: { findMany: fn(), findFirst: fn(), findUnique: fn(), create: fn(), update: fn() },
      legalRequestLink: { findUnique: fn() },
      legalCompany: { findFirst: fn(), findMany: fn() },
      legalTemplate: { findFirst: fn(), findMany: fn() },
      legalTemplateVersion: { findMany: fn() },
      legalDocument: { findFirst: fn(), findUnique: fn(), findMany: fn(), count: fn() },
      legalDocumentVersion: { findUnique: fn() },
      project: { findMany: fn(), count: fn() },
      pipelineDeal: { findMany: fn(), count: fn() },
      workspaceMember: { findMany: fn() },
    },
  }
})

import prisma from '@/lib/prisma'
import { GET as boardGET } from '@/app/api/legal/requests/route'
import { GET as mineGET } from '@/app/api/legal-requests/mine/route'
import { GET as mineOneGET } from '@/app/api/legal-requests/mine/[requestId]/route'
import { GET as mineFileGET } from '@/app/api/legal-requests/mine/[requestId]/file/route'
import { POST as formPOST } from '@/app/api/legal-requests/form/[linkId]/route'

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost${url}`, init)
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

beforeEach(() => {
  vi.clearAllMocks()
  session.current = { user: { id: 'u-staff' } }
  // An ordinary staff member: no Legal invitation, not the root.
  db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id, name: 'Staff', email: `${where.id}@dev.invalid`, deactivatedAt: null, legalMembership: null,
  }))
  db.user.findMany.mockResolvedValue([])
  db.legalMember.findMany.mockResolvedValue([])
  db.legalTemplateVersion.findMany.mockResolvedValue([])
  db.project.findMany.mockResolvedValue([])
  db.pipelineDeal.findMany.mockResolvedValue([])
  const withDoc = (r: (typeof REQUESTS)[number]) => ({
    ...r, linkId: null, companyId: 'co', company: { id: 'co', code: 'PATS', name: 'PATS' }, templateId: null, templateVersion: null,
    templateName: 'SPK', docType: 'SPK', isAddendum: false, parentNumberText: '', parentDocumentId: null, fieldValues: {}, purpose: '',
    deadline: null, attachments: [], projectId: null, dealId: null, column: 'DONE', stage: 'SIGNED', rejectedAt: null, rejectReason: '',
    rejectedById: null, picId: null, pic: null, requester: null, doneAt: null, idempotencyKey: null, createdAt: new Date(), updatedAt: new Date(),
    document: DOCS[r.documentId],
  })
  db.legalRequest.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => REQUESTS.filter((r) => matches(r, where)).map(withDoc))
  db.legalRequest.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    const r = REQUESTS.find((x) => matches(x, where))
    return r ? withDoc(r) : null
  })
  db.legalDocumentVersion.findUnique.mockImplementation(async ({ where }: { where: { documentId_version: { documentId: string; version: number } } }) => ({
    id: 'v', documentId: where.documentId_version.documentId, version: where.documentId_version.version,
    docxKey: null, pdfKey: `2026/10/${where.documentId_version.documentId}.pdf`, fileKey: null, fileName: 'x.pdf', mimeType: 'application/pdf',
  }))
})

describe('Legal request board', () => {
  it('refuses a non-member: 403 LEGAL_NOT_INVITED, and reads no request', async () => {
    const res = await boardGET(req('/api/legal/requests'))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('LEGAL_NOT_INVITED')
    expect(db.legalRequest.findMany).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller', async () => {
    session.current = null
    const res = await boardGET(req('/api/legal/requests'))
    expect(res.status).toBe(401)
    expect(db.legalRequest.findMany).not.toHaveBeenCalled()
  })
})

describe('My Legal requests', () => {
  it('lists only my own requests', async () => {
    const res = await mineGET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(db.legalRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { requesterId: 'u-staff' } }))
    expect(body.requests.map((r: { id: string }) => r.id).sort()).toEqual(['req-draft', 'req-mine'])
  })

  it("answers someone else's request exactly like a missing one", async () => {
    const other = await mineOneGET(req('/api/legal-requests/mine/req-other'), ctx({ requestId: 'req-other' }))
    const missing = await mineOneGET(req('/api/legal-requests/mine/nope'), ctx({ requestId: 'nope' }))
    expect(other.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await other.json()).toEqual(await missing.json())
    const mine = await mineOneGET(req('/api/legal-requests/mine/req-mine'), ctx({ requestId: 'req-mine' }))
    expect(mine.status).toBe(200)
  })

  it('downloads only the file of my own request, and only once final or signed', async () => {
    const mine = await mineFileGET(req('/api/legal-requests/mine/req-mine/file'), ctx({ requestId: 'req-mine' }))
    expect(mine.status).toBe(200)
    expect((await mine.json()).served).toContain('doc-mine.pdf')

    const other = await mineFileGET(req('/api/legal-requests/mine/req-other/file'), ctx({ requestId: 'req-other' }))
    expect(other.status).toBe(404)
    const draft = await mineFileGET(req('/api/legal-requests/mine/req-draft/file'), ctx({ requestId: 'req-draft' }))
    expect(draft.status).toBe(404)
    // Never asked for the other person's document version.
    for (const call of db.legalDocumentVersion.findUnique.mock.calls) {
      expect(call[0].where.documentId_version.documentId).not.toBe('doc-other')
    }
  })
})

describe('Addendum request', () => {
  const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv12'
  beforeEach(() => {
    db.legalRequestLink.findUnique.mockResolvedValue({ id: 'link', scope: 'general', token: TOKEN, companyId: null, company: null, accepting: true })
    db.legalCompany.findFirst.mockResolvedValue({ id: 'co', name: 'PATS' })
    db.legalTemplate.findFirst.mockResolvedValue({
      id: 'tpl-add', name: 'Addendum', docType: 'ADD', companyId: null, currentVersion: 1,
      versions: [{ version: 1, fields: [{ name: 'PERUBAHAN', label: 'Perubahan', type: 'list', required: true, columns: [{ name: 'PASAL_DIUBAH', label: 'Pasal', type: 'text', required: true }, { name: 'ISI_BARU', label: 'Isi baru', type: 'longtext', required: true }] }] }],
    })
    let n = 0
    db.legalRequest.create.mockImplementation(async () => ({ id: `req-new-${++n}` }))
  })

  const send = (parentNumber: string) =>
    formPOST(
      req(`/api/legal-requests/form/legal-${TOKEN}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateId: 'tpl-add', companyId: 'co', parentNumber, values: { PERUBAHAN: [{ PASAL_DIUBAH: 'Pasal 3', ISI_BARU: 'Baru' }] } }),
      }),
      ctx({ linkId: `legal-${TOKEN}` }),
    )

  it('answers the same for a real-looking, a random and a garbage number, and never looks any of them up', async () => {
    const answers = []
    for (const number of ['PATS/PKS-UNIV/X/2026/001', 'ZZZ/999/NOPE', '<script>"; DROP TABLE x;--']) {
      const res = await send(number)
      answers.push({ status: res.status, keys: Object.keys(await res.json()).sort() })
    }
    expect(answers[0]).toEqual({ status: 201, keys: ['id', 'ok'] })
    expect(answers[1]).toEqual(answers[0])
    expect(answers[2]).toEqual(answers[0])
    expect(db.legalDocument.findFirst).not.toHaveBeenCalled()
    expect(db.legalDocument.findUnique).not.toHaveBeenCalled()
    expect(db.legalDocument.findMany).not.toHaveBeenCalled()
    expect(db.legalDocument.count).not.toHaveBeenCalled()
    // Stored as typed, for Legal to match by hand.
    const stored = db.legalRequest.create.mock.calls[1][0].data
    expect(stored).toMatchObject({ isAddendum: true, parentNumberText: 'ZZZ/999/NOPE' })
    expect(stored).not.toHaveProperty('parentDocumentId')
  })
})
