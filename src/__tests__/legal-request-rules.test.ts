import { describe, expect, it } from 'vitest'
import { autoColumn, requestStage, requesterFileVersion, tokenFromLinkId } from '@/lib/legal/request-rules'

const doc = (status: string, currentVersion = 1, finalVersion: number | null = null, signedVersion: number | null = null) =>
  ({ status, currentVersion, finalVersion, signedVersion })

describe('Legal request rules', () => {
  it('tells the requester where the request stands', () => {
    expect(requestStage({ column: 'TODO', rejectedAt: null }, null)).toBe('RECEIVED')
    expect(requestStage({ column: 'IN_PROGRESS', rejectedAt: null }, null)).toBe('IN_PROGRESS')
    expect(requestStage({ column: 'IN_PROGRESS', rejectedAt: null }, doc('DRAFT'))).toBe('IN_PROGRESS')
    expect(requestStage({ column: 'IN_PROGRESS', rejectedAt: null }, doc('DRAFT', 2))).toBe('REVISION')
    expect(requestStage({ column: 'IN_PROGRESS', rejectedAt: null }, doc('FINAL', 2, 2))).toBe('FINAL')
    expect(requestStage({ column: 'DONE', rejectedAt: null }, doc('SIGNED', 3, 2, 3))).toBe('SIGNED')
    expect(requestStage({ column: 'DONE', rejectedAt: new Date() }, null)).toBe('REJECTED')
    expect(requestStage({ column: 'DONE', rejectedAt: null }, null)).toBe('DONE')
  })
  it('moves the card with its document', () => {
    expect(autoColumn('TODO', doc('DRAFT'))).toBe('IN_PROGRESS')
    expect(autoColumn('IN_PROGRESS', doc('SIGNED'))).toBe('DONE')
    expect(autoColumn('DONE', doc('DRAFT'))).toBe('DONE')
    expect(autoColumn('TODO', doc('VOID'))).toBe('TODO')
  })
  it('lets the requester download only a final or signed file', () => {
    expect(requesterFileVersion(doc('DRAFT', 2))).toBeNull()
    expect(requesterFileVersion(doc('FINAL', 3, 2))).toBe(2)
    expect(requesterFileVersion(doc('SIGNED', 4, 2, 4))).toBe(4)
    expect(requesterFileVersion(null)).toBeNull()
  })
  it('reads a link id', () => {
    expect(tokenFromLinkId('legal-AbCdEfGhIjKlMnOpQrStUv12')).toBe('AbCdEfGhIjKlMnOpQrStUv12')
    expect(tokenFromLinkId('legal-pengajuan')).toBeNull()
    expect(tokenFromLinkId('../etc')).toBeNull()
  })
})
