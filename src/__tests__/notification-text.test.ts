import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ default: { user: { findMany: vi.fn(async () => []), update: vi.fn(), updateMany: vi.fn() } } }))

import { bi, langFromRequest, recipientLang } from '@/lib/notification-text'

const h = (o: Record<string, string>) => new Headers(o)

describe('notification language (owner, 13 Oct 2026: English unless the person picked Indonesian)', () => {
  it('bi() keeps both languages and defaults the plain pair to English', () => {
    const x = bi(['Hello', 'World'], ['Halo', 'Dunia'])
    expect(x.title).toBe('Hello')
    expect(x.texts.id).toEqual({ title: 'Halo', message: 'Dunia' })
  })

  it('an unknown person gets English', async () => {
    expect(await recipientLang('nobody')).toBeNull() // → createInAppNotification uses "en"
  })

  it('records only what reveals a choice', () => {
    expect(langFromRequest(h({ 'x-nexus-lang': 'id' }))).toBe('id')
    expect(langFromRequest(h({ 'x-nexus-lang': 'en', 'accept-language': 'id-ID' }))).toBe('en')
    // The web in Indonesian is a choice; the web in English is only its default.
    expect(langFromRequest(h({ 'x-nexus-client': 'web/1', 'accept-language': 'id' }))).toBe('id')
    expect(langFromRequest(h({ 'x-nexus-client': 'web/1', 'accept-language': 'en' }))).toBeNull()
    // Released apps send the PHONE's languages, not the in-app picker: ignored.
    expect(langFromRequest(h({ 'x-nexus-client': 'ios/0.1.6/12', 'accept-language': 'id-ID;q=1, en-US;q=0.9' }))).toBeNull()
    expect(langFromRequest(h({ 'x-nexus-client': 'android/0.1.6/1' }))).toBeNull()
    // The pipeline export carries the in-app language.
    expect(langFromRequest(h({ 'x-nexus-client': 'ios/0.1.6/12' }), 'https://x/api/projects/p/pipeline/export?lang=id')).toBe('id')
  })
})
