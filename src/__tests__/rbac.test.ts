import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma before importing rbac
vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
    },
    projectMember: {
      findUnique: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((queries) => Promise.all(queries)),
  }
  return { default: mockPrisma }
})

import { checkProjectAccess } from '@/lib/rbac'
import prisma from '@/lib/prisma'

const mockUser = vi.mocked(prisma.user.findUnique)
const mockMember = vi.mocked(prisma.projectMember.findUnique)
const mockProject = vi.mocked(prisma.project.findUnique)

/** The workspace role decides (rbac.ts, since the BoD > Manager > Staff model): set the three reads. */
function given(opts: { systemRole?: string; workspaceRole?: string | null; projectRole?: string | null; type?: string }) {
  mockUser.mockResolvedValue({ role: opts.systemRole ?? 'USER' } as never)
  mockMember.mockResolvedValue((opts.projectRole ? { role: opts.projectRole } : null) as never)
  mockProject.mockResolvedValue({
    workspaceId: 'ws-1',
    type: opts.type ?? 'TASK',
    workspace: { members: opts.workspaceRole ? [{ role: opts.workspaceRole }] : [] },
  } as never)
}

describe('checkProjectAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('denies someone outside the project workspace', async () => {
    given({ workspaceRole: null, projectRole: 'LEAD' })
    expect(await checkProjectAccess('user-1', 'project-1', ['MEMBER'])).toEqual({ allowed: false, role: null })
  })

  it('lets a system ADMIN manage anything', async () => {
    given({ systemRole: 'ADMIN', workspaceRole: null })
    expect(await checkProjectAccess('user-1', 'project-1', ['LEAD'])).toEqual({ allowed: true, role: 'LEAD' })
  })

  it('lets BoD and One Above All manage every project in the workspace', async () => {
    for (const role of ['BOD', 'ONE_ABOVE_ALL']) {
      given({ workspaceRole: role })
      expect(await checkProjectAccess('user-1', 'project-1', ['LEAD'])).toEqual({ allowed: true, role: 'LEAD' })
    }
  })

  it('lets a Manager manage every project, member or not', async () => {
    given({ workspaceRole: 'MANAGER' })
    expect(await checkProjectAccess('user-1', 'project-1', ['LEAD'])).toEqual({ allowed: true, role: 'LEAD' })
  })

  it('lets a Staff member view and contribute to a project they are in', async () => {
    given({ workspaceRole: 'STAFF', projectRole: 'MEMBER' })
    expect(await checkProjectAccess('user-1', 'project-1', ['MEMBER'])).toEqual({ allowed: true, role: 'MEMBER' })
    expect(await checkProjectAccess('user-1', 'project-1', ['VIEWER'])).toEqual({ allowed: true, role: 'MEMBER' })
  })

  it('does not let Staff manage, even as the project lead', async () => {
    given({ workspaceRole: 'STAFF', projectRole: 'LEAD' })
    expect(await checkProjectAccess('user-1', 'project-1', ['LEAD'])).toEqual({ allowed: false, role: 'MEMBER' })
  })

  it('denies Staff on a project they are not in', async () => {
    given({ workspaceRole: 'STAFF', projectRole: null })
    expect(await checkProjectAccess('user-1', 'project-1', ['VIEWER'])).toEqual({ allowed: false, role: null })
  })

  it('keeps a Pipeline project to its own members, BoD included', async () => {
    given({ workspaceRole: 'BOD', projectRole: null, type: 'PIPELINE' })
    expect(await checkProjectAccess('user-1', 'project-1', ['VIEWER'])).toEqual({ allowed: false, role: null })
    given({ workspaceRole: 'BOD', projectRole: 'MEMBER', type: 'PIPELINE' })
    expect(await checkProjectAccess('user-1', 'project-1', ['LEAD'])).toEqual({ allowed: true, role: 'LEAD' })
  })

  it('allows when any of several required roles is met', async () => {
    given({ workspaceRole: 'STAFF', projectRole: 'MEMBER' })
    expect((await checkProjectAccess('user-1', 'project-1', ['VIEWER', 'MEMBER'])).allowed).toBe(true)
  })
})
