import { describe, expect, it } from 'vitest'

/**
 * Social Media Report (owner, 14 Oct 2026): engagement = likes + comments + shares (views apart), a date's
 * own target else the month's share, and the Overview's month-to-date numbers against the targets to date.
 */

import {
  buildSocialDays,
  cutoffOf,
  defaultSocialConfig,
  engagementOf,
  mergeSocialConfig,
  readSocialConfig,
  summarizeSocial,
  type SocialDayRow,
  type SocialReportConfig,
} from '@/lib/social-media'

const cfg: SocialReportConfig = defaultSocialConfig()
const row = (date: string, platformId: string, f: Partial<SocialDayRow>): SocialDayRow => ({
  date, platformId, views: null, likes: null, comments: null, shares: null, posts: null, ...f,
})

describe('engagement', () => {
  it('adds likes, comments and shares, never views', () => {
    expect(engagementOf({ likes: 100, comments: 20, shares: 5 })).toBe(125)
    const [d] = buildSocialDays('2026-10', cfg, [row('2026-10-01', 'instagram', { views: 9000, likes: 10, comments: 2, shares: 1 })], [], [], [])
    expect(d.platforms.instagram.engagement).toBe(13)
    expect(d.platforms.instagram.views).toBe(9000)
  })

  it('counts what was filled and is null when none of the three was', () => {
    expect(engagementOf({ likes: 7, comments: null, shares: null })).toBe(7)
    expect(engagementOf({ likes: null, comments: null, shares: null })).toBeNull()
    const [d] = buildSocialDays('2026-10', cfg, [row('2026-10-01', 'tiktok', { views: 500, posts: 2 })], [], [], [])
    expect(d.platforms.tiktok.engagement).toBeNull()
    expect(d.recorded).toBe(true)
    expect(d.posts).toBe(2)
  })

  it('a zero is a real zero', () => {
    expect(engagementOf({ likes: 0, comments: 0, shares: 0 })).toBe(0)
  })
})

describe('daily targets and the fallback', () => {
  const monthly = [{ platformId: 'instagram', engagementTarget: 3100, postsTarget: 31 }]

  it('a date without its own target takes the month split evenly over its days', () => {
    const days = buildSocialDays('2026-10', cfg, [], [], monthly, [])
    expect(days).toHaveLength(31)
    expect(days[0].platforms.instagram.engagementTarget).toBe(100)
    expect(days[0].platforms.instagram.engagementTargetSource).toBe('month')
    expect(days[0].platforms.instagram.postsTarget).toBe(1)
    // TikTok has no monthly target: no target, not zero.
    expect(days[0].platforms.tiktok.engagementTarget).toBeNull()
    expect(days[0].platforms.tiktok.engagementTargetSource).toBeNull()
  })

  it("a date's own target wins, part by part", () => {
    const days = buildSocialDays('2026-10', cfg, [], [], monthly, [
      { date: '2026-10-05', platformId: 'instagram', engagementTarget: 500, postsTarget: null },
    ])
    const d = days[4].platforms.instagram
    expect(d.engagementTarget).toBe(500)
    expect(d.engagementTargetSource).toBe('day')
    expect(d.postsTarget).toBe(1)
    expect(d.postsTargetSource).toBe('month')
  })

  it('a date may have a target with no monthly target at all', () => {
    const days = buildSocialDays('2026-10', cfg, [], [], [], [
      { date: '2026-10-02', platformId: 'tiktok', engagementTarget: null, postsTarget: 3 },
    ])
    expect(days[1].platforms.tiktok.postsTarget).toBe(3)
    expect(days[0].platforms.tiktok.postsTarget).toBeNull()
  })
})

describe('the Overview, to date', () => {
  const monthly = [
    { platformId: 'instagram', engagementTarget: 3100, postsTarget: 31 },
    { platformId: 'tiktok', engagementTarget: null, postsTarget: 62 },
  ]
  const rows = [
    row('2026-10-01', 'instagram', { views: 1000, likes: 80, comments: 10, shares: 10, posts: 1 }),
    row('2026-10-02', 'instagram', { views: 2000, likes: 150, comments: 30, shares: 20, posts: 2 }),
    row('2026-10-02', 'tiktok', { views: 5000, likes: 300, posts: 3 }),
    // After the cutoff: not counted.
    row('2026-10-20', 'instagram', { likes: 9999, posts: 9 }),
  ]

  it('adds up to today against the sum of the targets in force up to today', () => {
    const days = buildSocialDays('2026-10', cfg, rows, [], monthly, [
      { date: '2026-10-03', platformId: 'instagram', engagementTarget: 400, postsTarget: null },
    ])
    const o = summarizeSocial('2026-10', '2026-10-03', cfg, days)
    expect(o.cutoff).toBe('2026-10-03')
    const ig = o.platforms.find((p) => p.platformId === 'instagram')!
    expect(ig.engagement).toBe(300) // 100 + 200, views apart
    expect(ig.views).toBe(3000)
    expect(ig.posts).toBe(3)
    expect(ig.engagementTargetToDate).toBe(600) // 100 + 100 + 400 (own)
    expect(ig.engagementPct).toBe(50)
    expect(ig.postsTargetToDate).toBe(3)
    expect(ig.postsPct).toBe(100)
    expect(ig.trend).toEqual([100, 200, 0])
    expect(ig.engagementTargetMonth).toBe(3400) // 30 × 100 + 400
    const tt = o.platforms.find((p) => p.platformId === 'tiktok')!
    expect(tt.engagement).toBe(300)
    expect(tt.engagementTargetToDate).toBeNull()
    expect(tt.engagementPct).toBeNull()
    expect(tt.postsTargetToDate).toBe(6)
    expect(tt.postsPct).toBe(50)
    expect(o.recordedDays).toBe(2)
  })

  it('a past month counts every day, a future one none', () => {
    expect(cutoffOf('2026-09', '2026-10-14')).toBe('2026-09-30')
    expect(cutoffOf('2026-11', '2026-10-14')).toBeNull()
    const future = summarizeSocial('2026-11', '2026-10-14', cfg, buildSocialDays('2026-11', cfg, [], [], [], []))
    expect(future.recordedDays).toBe(0)
    expect(future.platforms.every((p) => p.engagement === 0 && p.engagementTargetToDate === null)).toBe(true)
  })

  it('an archived platform shows only when the month has figures for it', () => {
    const c: SocialReportConfig = { version: 1, platforms: [...cfg.platforms, { id: 'p_yt', name: 'YouTube', archived: true }] }
    const empty = summarizeSocial('2026-10', '2026-10-14', c, buildSocialDays('2026-10', c, [], [], [], []))
    expect(empty.platforms.map((p) => p.platformId)).toEqual(['instagram', 'tiktok'])
    const some = summarizeSocial('2026-10', '2026-10-14', c, buildSocialDays('2026-10', c, [row('2026-10-01', 'p_yt', { likes: 1 })], [], [], []))
    expect(some.platforms.map((p) => p.platformId)).toEqual(['instagram', 'tiktok', 'p_yt'])
  })

  it('a note alone counts as a recorded day', () => {
    const days = buildSocialDays('2026-10', cfg, [], [{ date: '2026-10-01', worked: 'Reels at 7pm', didntWork: '' }], [], [])
    expect(summarizeSocial('2026-10', '2026-10-14', cfg, days).recordedDays).toBe(1)
  })
})

describe('platforms', () => {
  it('nothing stored is Instagram and TikTok', () => {
    expect(readSocialConfig(null).platforms.map((p) => p.id)).toEqual(['instagram', 'tiktok'])
    expect(readSocialConfig({ platforms: [] }).platforms).toHaveLength(2)
  })

  it('adds, renames and reorders, keeping ids', () => {
    const r = mergeSocialConfig({ platforms: [{ id: 'tiktok', name: 'TikTok' }, { id: 'instagram', name: 'IG' }, { name: 'YouTube' }] }, cfg, new Set())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.platforms.map((p) => p.name)).toEqual(['TikTok', 'IG', 'YouTube'])
    expect(r.config.platforms[1].id).toBe('instagram')
    expect(r.config.platforms[2].id).toMatch(/^p_[a-z0-9]{10}$/)
  })

  it('a platform left out with figures comes back archived; without, it is dropped', () => {
    const r = mergeSocialConfig({ platforms: [{ id: 'instagram', name: 'Instagram' }] }, cfg, new Set(['tiktok']))
    expect(r.ok && r.config.platforms).toEqual([{ id: 'instagram', name: 'Instagram' }, { id: 'tiktok', name: 'TikTok', archived: true }])
    const r2 = mergeSocialConfig({ platforms: [{ id: 'instagram', name: 'Instagram' }] }, cfg, new Set())
    expect(r2.ok && r2.config.platforms).toEqual([{ id: 'instagram', name: 'Instagram' }])
  })

  it('refuses no active platform, empty names and duplicate ids', () => {
    expect(mergeSocialConfig({ platforms: [{ id: 'instagram', name: 'Instagram', archived: true }] }, cfg, new Set()).ok).toBe(false)
    expect(mergeSocialConfig({ platforms: [{ name: '  ' }] }, cfg, new Set()).ok).toBe(false)
    expect(mergeSocialConfig({ platforms: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }, cfg, new Set()).ok).toBe(false)
  })
})
