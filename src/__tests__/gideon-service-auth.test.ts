import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
  },
}))

import prisma from '@/lib/prisma'
import { authenticateGideonService } from '@/lib/gideon-service-auth'

const mockFindUnique = vi.mocked(prisma.user.findUnique)

function requestWithToken(token?: string) {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  return new Request('http://localhost/api/gideon/tools', { headers })
}

describe('authenticateGideonService', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.NEXUS_GIDEON_SERVICE_TOKEN
    delete process.env.NEXUS_GIDEON_ACTOR_EMAIL
  })

  it('returns 503 when the service token is not configured', async () => {
    const result = await authenticateGideonService(requestWithToken('secret'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(503)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('returns 401 when the bearer token is missing or wrong', async () => {
    process.env.NEXUS_GIDEON_SERVICE_TOKEN = 'correct-token'

    const missing = await authenticateGideonService(requestWithToken())
    const wrong = await authenticateGideonService(requestWithToken('wrong-token'))

    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.response.status).toBe(401)
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.response.status).toBe(401)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('returns 503 when the actor email is not configured', async () => {
    process.env.NEXUS_GIDEON_SERVICE_TOKEN = 'correct-token'

    const result = await authenticateGideonService(requestWithToken('correct-token'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(503)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('returns 503 when the configured actor user cannot be found', async () => {
    process.env.NEXUS_GIDEON_SERVICE_TOKEN = 'correct-token'
    process.env.NEXUS_GIDEON_ACTOR_EMAIL = 'gideon@patsgroup.id'
    mockFindUnique.mockResolvedValue(null)

    const result = await authenticateGideonService(requestWithToken('correct-token'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(503)
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { email: 'gideon@patsgroup.id' },
    })
  })

  it('returns the service actor when the configured token is valid', async () => {
    process.env.NEXUS_GIDEON_SERVICE_TOKEN = 'correct-token'
    process.env.NEXUS_GIDEON_ACTOR_EMAIL = 'gideon@patsgroup.id'
    const actor = { id: 'user-1', name: 'GIDEON', email: 'gideon@patsgroup.id', role: 'ADMIN' }
    mockFindUnique.mockResolvedValue(actor as never)

    const result = await authenticateGideonService(requestWithToken('correct-token'))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.actor).toEqual(actor)
  })
})
