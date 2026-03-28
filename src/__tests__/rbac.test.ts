import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma before importing rbac
vi.mock('@/lib/prisma', () => ({
  default: {
    projectMember: {
      findUnique: vi.fn(),
    },
  },
}))

import { checkProjectAccess } from '@/lib/rbac'
import prisma from '@/lib/prisma'

const mockFindUnique = vi.mocked(prisma.projectMember.findUnique)

describe('checkProjectAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns allowed=false when user is not a member', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await checkProjectAccess('user-1', 'project-1', ['MEMBER'])
    expect(result.allowed).toBe(false)
    expect(result.role).toBeNull()
  })

  it('allows LEAD when MEMBER is required', async () => {
    mockFindUnique.mockResolvedValue({
      id: '1',
      role: 'LEAD',
      source: 'direct',
      joinedAt: new Date(),
      userId: 'user-1',
      projectId: 'project-1',
    })

    const result = await checkProjectAccess('user-1', 'project-1', ['MEMBER'])
    expect(result.allowed).toBe(true)
    expect(result.role).toBe('LEAD')
  })

  it('allows MEMBER when MEMBER is required', async () => {
    mockFindUnique.mockResolvedValue({
      id: '2',
      role: 'MEMBER',
      source: 'direct',
      joinedAt: new Date(),
      userId: 'user-1',
      projectId: 'project-1',
    })

    const result = await checkProjectAccess('user-1', 'project-1', ['MEMBER'])
    expect(result.allowed).toBe(true)
    expect(result.role).toBe('MEMBER')
  })

  it('denies VIEWER when MEMBER is required', async () => {
    mockFindUnique.mockResolvedValue({
      id: '3',
      role: 'VIEWER',
      source: 'direct',
      joinedAt: new Date(),
      userId: 'user-1',
      projectId: 'project-1',
    })

    const result = await checkProjectAccess('user-1', 'project-1', ['MEMBER'])
    expect(result.allowed).toBe(false)
    expect(result.role).toBe('VIEWER')
  })

  it('denies GUEST when VIEWER is required', async () => {
    mockFindUnique.mockResolvedValue({
      id: '4',
      role: 'GUEST',
      source: 'direct',
      joinedAt: new Date(),
      userId: 'user-1',
      projectId: 'project-1',
    })

    const result = await checkProjectAccess('user-1', 'project-1', ['VIEWER'])
    expect(result.allowed).toBe(false)
    expect(result.role).toBe('GUEST')
  })

  it('allows GUEST when GUEST is required', async () => {
    mockFindUnique.mockResolvedValue({
      id: '5',
      role: 'GUEST',
      source: 'direct',
      joinedAt: new Date(),
      userId: 'user-1',
      projectId: 'project-1',
    })

    const result = await checkProjectAccess('user-1', 'project-1', ['GUEST'])
    expect(result.allowed).toBe(true)
    expect(result.role).toBe('GUEST')
  })

  it('allows when user meets any of multiple required roles', async () => {
    mockFindUnique.mockResolvedValue({
      id: '6',
      role: 'VIEWER',
      source: 'direct',
      joinedAt: new Date(),
      userId: 'user-1',
      projectId: 'project-1',
    })

    const result = await checkProjectAccess('user-1', 'project-1', ['VIEWER', 'MEMBER'])
    expect(result.allowed).toBe(true)
  })
})
