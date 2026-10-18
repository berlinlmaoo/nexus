import { beforeEach, describe, expect, it } from 'vitest'
import {
  canonicalRoom,
  isLegacyIdCandidate,
  legacyFileRedirect,
  legacyIdOf,
  normalizeTokenUserId,
  resetLegacyIdsForTests,
  resolveLegacyIdsInText,
  rewriteLegacyIdsInArgs,
  setLegacyIdLookup,
} from '@/lib/legacy-ids'
import { uuidv7 } from '@/lib/uuid7'

const OLD_USER = 'cmnhcpw37000301n3g3nq8ff1'
const NEW_USER = '019d4a2b-1c3d-7abc-8def-0123456789ab'
const OLD_PROJECT = '2c11faead7e64f908f1f5c574105ec9c'
const NEW_PROJECT = '019d4a2b-1c3d-7abc-9def-0123456789ac'
const OLD_SHORT = 'fcat_1'
const NEW_SHORT = '019d4a2b-1c3d-7abc-adef-0123456789ad'
const MAP: Record<string, string> = { [OLD_USER]: NEW_USER, [OLD_PROJECT]: NEW_PROJECT, [OLD_SHORT]: NEW_SHORT }

let lookups = 0
let rows = true
function install() {
  setLegacyIdLookup(
    async (ids) => {
      lookups++
      return ids.filter((i) => MAP[i]).map((i) => ({ old_id: i, new_id: MAP[i] }))
    },
    async () => rows,
    async (n) => Object.keys(MAP).find((k) => MAP[k] === n) ?? null,
  )
}

beforeEach(() => {
  resetLegacyIdsForTests()
  lookups = 0
  rows = true
  install()
})

describe('legacy ids', () => {
  it('only non-UUID id-shaped strings are candidates', () => {
    expect(isLegacyIdCandidate(OLD_USER)).toBe(true)
    expect(isLegacyIdCandidate(NEW_USER)).toBe(false)
    expect(isLegacyIdCandidate('a@b.c')).toBe(false)
    expect(isLegacyIdCandidate('abc')).toBe(false)
  })

  it('rewrites ids under id-like keys, operators, arrays and compound uniques; leaves other strings', async () => {
    const args = {
      where: {
        id: OLD_USER,
        projectId: { in: [OLD_PROJECT, NEW_PROJECT] },
        userId_workspaceId: { userId: OLD_USER, workspaceId: 'unknown-ws-id' },
        title: OLD_USER, // not an id key: untouched
        credentialId: OLD_USER, // someone else's identifier: untouched
        OR: [{ assigneeIds: { has: OLD_USER } }, { createdById: OLD_SHORT }],
      },
      cursor: { id: OLD_PROJECT },
      data: { lastSeenAt: new Date(0), ownerId: OLD_USER },
    }
    await rewriteLegacyIdsInArgs(args)
    expect(args.where.id).toBe(NEW_USER)
    expect(args.where.projectId.in).toEqual([NEW_PROJECT, NEW_PROJECT])
    expect(args.where.userId_workspaceId).toEqual({ userId: NEW_USER, workspaceId: 'unknown-ws-id' })
    expect(args.where.title).toBe(OLD_USER)
    expect(args.where.credentialId).toBe(OLD_USER)
    expect(args.where.OR).toEqual([{ assigneeIds: { has: NEW_USER } }, { createdById: NEW_SHORT }])
    expect(args.cursor.id).toBe(NEW_PROJECT)
    expect(args.data.ownerId).toBe(NEW_USER)
    expect(args.data.lastSeenAt).toBeInstanceOf(Date)
  })

  it('caches hits and misses: one lookup per distinct string', async () => {
    await rewriteLegacyIdsInArgs({ where: { id: OLD_USER, ownerId: 'nope-not-an-old-id' } })
    await rewriteLegacyIdsInArgs({ where: { id: OLD_USER, ownerId: 'nope-not-an-old-id' } })
    expect(lookups).toBe(1)
  })

  it('UUID-only queries never look anything up', async () => {
    await rewriteLegacyIdsInArgs({ where: { id: NEW_USER, projectId: { in: [NEW_PROJECT] } } })
    expect(lookups).toBe(0)
  })

  it('stays off while the map is empty (before the conversion)', async () => {
    resetLegacyIdsForTests()
    rows = false
    install()
    const args = { where: { id: OLD_USER } }
    await rewriteLegacyIdsInArgs(args)
    expect(args.where.id).toBe(OLD_USER)
    expect(lookups).toBe(0)
  })

  it('JWT, rooms, links and file names', async () => {
    expect(await normalizeTokenUserId({ id: OLD_USER, sub: OLD_USER, sid: 'x' })).toEqual({ id: NEW_USER, sub: NEW_USER, sid: 'x' })
    expect(await canonicalRoom(`project:${OLD_PROJECT}`)).toBe(`project:${NEW_PROJECT}`)
    expect(await canonicalRoom(`project:${NEW_PROJECT}`)).toBe(`project:${NEW_PROJECT}`)
    expect(await resolveLegacyIdsInText(`/projects/${OLD_PROJECT}/tasks/${OLD_USER}?x=1`)).toBe(`/projects/${NEW_PROJECT}/tasks/${NEW_USER}?x=1`)
    const res = await legacyFileRedirect('/api/files', ['attendance', `checkin-${OLD_USER}-1776512880420-tanui6.jpg`], '?w=64')
    expect(res?.status).toBe(308)
    expect(res?.headers.get('Location')).toBe(`/api/files/attendance/checkin-${NEW_USER}-1776512880420-tanui6.jpg?w=64`)
    expect(await legacyFileRedirect('/api/files', ['avatars', `${NEW_USER}.jpg`])).toBeNull()
    expect(await legacyIdOf(NEW_PROJECT)).toBe(OLD_PROJECT)
  })

  it('uuidv7 has version 7, the RFC variant and the current time', () => {
    const now = Date.UTC(2026, 9, 18, 12, 0, 0, 123)
    const id = uuidv7(now)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now)
    expect(uuidv7(now + 1) > id).toBe(true)
  })
})
