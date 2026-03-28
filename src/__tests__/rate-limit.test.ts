import { describe, it, expect, beforeEach, vi } from 'vitest'
import { checkRateLimit } from '@/lib/rate-limit'

function mockRequest(path: string, ip = '127.0.0.1') {
  return {
    nextUrl: { pathname: path },
    headers: new Map([['x-forwarded-for', ip]]),
  } as unknown as Parameters<typeof checkRateLimit>[0]
}

describe('checkRateLimit', () => {
  it('allows requests under the limit', () => {
    const req = mockRequest('/api/test-allow', '10.0.0.1')
    const result = checkRateLimit(req, undefined, { limit: 5, windowSeconds: 60 })
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks requests over the limit', () => {
    const req = mockRequest('/api/test-block', '10.0.0.2')
    for (let i = 0; i < 3; i++) {
      checkRateLimit(req, undefined, { limit: 3, windowSeconds: 60 })
    }
    const result = checkRateLimit(req, undefined, { limit: 3, windowSeconds: 60 })
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('tracks different IPs separately', () => {
    const req1 = mockRequest('/api/test-ip', '10.0.0.3')
    const req2 = mockRequest('/api/test-ip', '10.0.0.4')

    for (let i = 0; i < 3; i++) {
      checkRateLimit(req1, undefined, { limit: 3, windowSeconds: 60 })
    }

    const result1 = checkRateLimit(req1, undefined, { limit: 3, windowSeconds: 60 })
    const result2 = checkRateLimit(req2, undefined, { limit: 3, windowSeconds: 60 })

    expect(result1.allowed).toBe(false)
    expect(result2.allowed).toBe(true)
  })

  it('tracks by userId when provided', () => {
    const req = mockRequest('/api/test-user', '10.0.0.5')

    for (let i = 0; i < 3; i++) {
      checkRateLimit(req, 'user-1', { limit: 3, windowSeconds: 60 })
    }

    const blocked = checkRateLimit(req, 'user-1', { limit: 3, windowSeconds: 60 })
    const otherUser = checkRateLimit(req, 'user-2', { limit: 3, windowSeconds: 60 })

    expect(blocked.allowed).toBe(false)
    expect(otherUser.allowed).toBe(true)
  })

  it('tracks different paths separately', () => {
    const req1 = mockRequest('/api/path-a', '10.0.0.6')
    const req2 = mockRequest('/api/path-b', '10.0.0.6')

    for (let i = 0; i < 3; i++) {
      checkRateLimit(req1, undefined, { limit: 3, windowSeconds: 60 })
    }

    const blockedA = checkRateLimit(req1, undefined, { limit: 3, windowSeconds: 60 })
    const allowedB = checkRateLimit(req2, undefined, { limit: 3, windowSeconds: 60 })

    expect(blockedA.allowed).toBe(false)
    expect(allowedB.allowed).toBe(true)
  })

  it('uses default limit of 60 when not specified', () => {
    const req = mockRequest('/api/test-default', '10.0.0.7')
    const result = checkRateLimit(req)
    expect(result.remaining).toBe(59)
  })
})
