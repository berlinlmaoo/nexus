import { describe, it, expect, vi, beforeEach } from 'vitest'

// Project access levels (owner decision 13 Oct 2026, Notion's model): FULL / EDIT / COMMENT / VIEW.
vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    user: { findUnique: vi.fn() },
    projectMember: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    $transaction: vi.fn((queries) => Promise.all(queries)),
  }
  return { default: mockPrisma }
})

import { checkProjectAccess, memberAccessLevel, projectAccessLevel, roleForLevel } from '@/lib/rbac'
import prisma from '@/lib/prisma'

const user = vi.mocked(prisma.user.findUnique)
const member = vi.mocked(prisma.projectMember.findUnique)
const project = vi.mocked(prisma.project.findUnique)

type Setup = { sys?: 'ADMIN' | 'USER'; ws?: string | null; type?: string; m?: { role: string; accessLevel?: string } | null }
function setup({ sys = 'USER', ws = 'STAFF', type = 'TASK', m = null }: Setup) {
  user.mockResolvedValue({ role: sys } as never)
  member.mockResolvedValue((m ? { accessLevel: 'EDIT', ...m } : null) as never)
  project.mockResolvedValue({ type, workspace: { members: ws ? [{ role: ws }] : [] } } as never)
}

describe('project access levels', () => {
  beforeEach(() => vi.clearAllMocks())

  it('BoD and One Above All: Full everywhere, also without membership', async () => {
    for (const ws of ['BOD', 'ONE_ABOVE_ALL']) {
      setup({ ws })
      expect(await projectAccessLevel('u', 'p')).toBe('FULL')
    }
  })

  it('Manager and Staff: nothing without membership', async () => {
    for (const ws of ['MANAGER', 'STAFF']) {
      setup({ ws })
      expect(await projectAccessLevel('u', 'p')).toBeNull()
    }
  })

  it('members get their level; the Project Owner (LEAD) is Full', async () => {
    const cases: Array<[{ role: string; accessLevel?: string }, string]> = [
      [{ role: 'LEAD' }, 'FULL'],
      [{ role: 'MEMBER', accessLevel: 'EDIT' }, 'EDIT'],
      [{ role: 'MEMBER', accessLevel: 'COMMENT' }, 'COMMENT'],
      [{ role: 'MEMBER', accessLevel: 'VIEW' }, 'VIEW'],
      [{ role: 'GUEST' }, 'COMMENT'],
      [{ role: 'VIEWER' }, 'VIEW'],
    ]
    for (const ws of ['MANAGER', 'STAFF']) {
      for (const [m, want] of cases) {
        setup({ ws, m })
        expect(await projectAccessLevel('u', 'p')).toBe(want)
      }
    }
  })

  it('a PIPELINE project follows the same rules (owner, 16 Oct 2026)', async () => {
    for (const ws of ['BOD', 'ONE_ABOVE_ALL']) {
      setup({ ws, type: 'PIPELINE' })
      expect(await projectAccessLevel('u', 'p')).toBe('FULL')
    }
    for (const ws of ['MANAGER', 'STAFF']) {
      setup({ ws, type: 'PIPELINE' })
      expect(await projectAccessLevel('u', 'p')).toBeNull()
      setup({ ws, type: 'PIPELINE', m: { role: 'MEMBER', accessLevel: 'VIEW' } })
      expect(await projectAccessLevel('u', 'p')).toBe('VIEW')
    }
  })

  it('not in the workspace: nothing; the retired ADMIN flag grants nothing', async () => {
    setup({ ws: null, m: { role: 'LEAD' } })
    expect(await projectAccessLevel('u', 'p')).toBeNull()
    setup({ sys: 'ADMIN', ws: null })
    expect(await projectAccessLevel('u', 'p')).toBeNull()
    setup({ sys: 'ADMIN', ws: 'STAFF' })
    expect(await projectAccessLevel('u', 'p')).toBeNull()
  })

  it('checkProjectAccess: LEAD needs Full, MEMBER needs Edit, VIEWER needs View', async () => {
    setup({ ws: 'STAFF', m: { role: 'MEMBER', accessLevel: 'EDIT' } })
    expect((await checkProjectAccess('u', 'p', ['LEAD'])).allowed).toBe(false)
    expect((await checkProjectAccess('u', 'p', ['MEMBER'])).allowed).toBe(true)
    setup({ ws: 'STAFF', m: { role: 'VIEWER' } })
    expect((await checkProjectAccess('u', 'p', ['MEMBER'])).allowed).toBe(false)
    expect((await checkProjectAccess('u', 'p', ['VIEWER'])).allowed).toBe(true)
    setup({ ws: 'STAFF', m: { role: 'LEAD' } })
    expect((await checkProjectAccess('u', 'p', ['LEAD'])).allowed).toBe(true)
  })

  it('role and level stay in step', () => {
    for (const l of ['FULL', 'EDIT', 'COMMENT', 'VIEW'] as const) {
      expect(memberAccessLevel({ role: roleForLevel(l), accessLevel: l })).toBe(l)
    }
  })
})
