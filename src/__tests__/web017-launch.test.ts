import { describe, expect, it, vi } from 'vitest'

/**
 * The web's 0.1.7 launch switch (owner, 22 Oct 2026): flags.web017Launch hides the iPhone 0.1.7 features on the
 * web until it is turned on. Fail closed (hidden until the config says true), default off on the server, a
 * platforms.web override turns it on without a deploy, and the Excel export keeps the pre-v8 columns on request.
 */

const store = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('@/lib/app-setting', () => ({ getAppSetting: vi.fn(async () => store.value) }))

import {
  LEGACY_LINK_TYPES, WEB017_FLAG, announcementOriginFor, linkTypesFor, meetingNotesOn, web017On,
} from '../../apps/web/src/lib/web-launch'
import { APP_CONFIG_DEFAULTS, getAppConfig } from '@/lib/app-config'
import { LEGACY_MASTER_COLUMN_COUNT, MASTER_COLUMNS, masterColumnsFor, parseColumnsParam } from '@/lib/pipeline-export'

const ALL_LINK_TYPES = ['Deck', 'Quotation', 'Kontrak', 'SPK', 'MOU', 'Invoice', 'Report', 'Lainnya'] as const

describe('web017On (fail closed)', () => {
  it('is on only for an explicit true', () => {
    expect(web017On({ flags: { web017Launch: true } })).toBe(true)
  })
  it('is off while loading, on an error, on an older server, or for anything but true', () => {
    expect(web017On(undefined)).toBe(false)
    expect(web017On(null)).toBe(false)
    expect(web017On({})).toBe(false)
    expect(web017On({ flags: null })).toBe(false)
    expect(web017On({ flags: {} })).toBe(false)
    expect(web017On({ flags: { web017Launch: false } })).toBe(false)
    expect(web017On({ flags: { web017Launch: 'true' } })).toBe(false)
    expect(web017On({ flags: { web017Launch: 1 } })).toBe(false)
  })
  it('reads the same key the server sends', () => {
    expect(WEB017_FLAG).toBe('web017Launch')
    expect(WEB017_FLAG in APP_CONFIG_DEFAULTS.flags).toBe(true)
  })
})

describe('gated pieces', () => {
  it('document types: the pre-v8 list while off, every type when on', () => {
    expect(linkTypesFor(false, ALL_LINK_TYPES)).toEqual(['SPK', 'Kontrak', 'MOU', 'Invoice', 'Lainnya'])
    expect(linkTypesFor(true, ALL_LINK_TYPES)).toEqual(ALL_LINK_TYPES)
    // The old list is a subset of the stored keys, so documents saved either way still label.
    for (const k of LEGACY_LINK_TYPES) expect(ALL_LINK_TYPES as readonly string[]).toContain(k)
  })
  it('announcements: one combined list while off, the picked origin when on', () => {
    expect(announcementOriginFor(false, 'system')).toBeUndefined()
    expect(announcementOriginFor(false, 'manual')).toBeUndefined()
    expect(announcementOriginFor(true, 'system')).toBe('system')
    expect(announcementOriginFor(true, 'manual')).toBe('manual')
  })
  it('meeting notes: need both the server switch and the launch switch', () => {
    expect(meetingNotesOn(undefined)).toBe(false)
    expect(meetingNotesOn({ flags: { meetingNotesEnabled: true } })).toBe(false)
    expect(meetingNotesOn({ flags: { meetingNotesEnabled: true, web017Launch: true } })).toBe(true)
    expect(meetingNotesOn({ flags: { web017Launch: true } })).toBe(true)
    expect(meetingNotesOn({ flags: { meetingNotesEnabled: false, web017Launch: true } })).toBe(false)
  })
})

describe('server config', () => {
  it('defaults off', async () => {
    expect(APP_CONFIG_DEFAULTS.flags.web017Launch).toBe(false)
    store.value = null
    expect((await getAppConfig('web')).flags.web017Launch).toBe(false)
  })
  it('turns on from the AppSetting row for the web only (no deploy)', async () => {
    store.value = { platforms: { web: { flags: { web017Launch: true } } } }
    expect((await getAppConfig('web')).flags.web017Launch).toBe(true)
    expect((await getAppConfig('ios')).flags.web017Launch).toBe(false)
    // Other flags keep their defaults.
    expect((await getAppConfig('web')).flags.meetingNotesEnabled).toBe(true)
  })
  it('a shared-block value works too, and an explicit false wins', async () => {
    store.value = { flags: { web017Launch: true }, platforms: { web: { flags: { web017Launch: false } } } }
    expect((await getAppConfig('web')).flags.web017Launch).toBe(false)
    store.value = { flags: { web017Launch: true } }
    expect((await getAppConfig('web')).flags.web017Launch).toBe(true)
  })
})

describe('Excel export columns', () => {
  it('legacy = the 34 columns from before v8, default = all of them', () => {
    expect(LEGACY_MASTER_COLUMN_COUNT).toBe(34)
    const legacy = masterColumnsFor('legacy')
    expect(legacy).toHaveLength(34)
    expect(legacy[33].en).toBe('Updated By')
    expect(legacy.map((c) => c.en)).not.toContain('Barter Value')
    expect(masterColumnsFor('all')).toBe(MASTER_COLUMNS)
    expect(masterColumnsFor(undefined)).toBe(MASTER_COLUMNS)
  })
  it('?columns=legacy is the only way to ask for them', () => {
    expect(parseColumnsParam('legacy')).toBe('legacy')
    expect(parseColumnsParam(null)).toBe('all')
    expect(parseColumnsParam('all')).toBe('all')
    expect(parseColumnsParam('LEGACY')).toBe('all')
  })
})
