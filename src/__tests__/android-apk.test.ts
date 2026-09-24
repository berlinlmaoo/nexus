// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

// The sideloaded APK download (nexus-android SERVER-REQUESTS R2): session gate, Range/If-Range through
// lib/file-response.ts, the release manifest, and the 426 exemption. Real files in a temp dir, no DB.

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: authMock }))
// version-policy.ts imports these for the iOS side; the Android paths never touch them.
vi.mock("@/lib/prisma", () => ({ default: { appReleaseSeen: { findMany: vi.fn(async () => []) } } }))
vi.mock("@/lib/app-store", () => ({ APP_STORE_URL: "https://apps.apple.com/app/id6807031457", latestIosVersion: vi.fn(async () => null) }))

const SIZE = 50_000
const byteAt = (i: number) => (i * 31 + 7) & 255
const APK = Buffer.from(Array.from({ length: SIZE }, (_, i) => byteAt(i)))

const dirs: string[] = []
function releaseDir(manifest: unknown | null, files: Record<string, Buffer> = { "nexus-0.1.6-1.apk": APK }) {
  const dir = mkdtempSync(path.join(tmpdir(), "nexus-apk-"))
  dirs.push(dir)
  for (const [name, data] of Object.entries(files)) writeFileSync(path.join(dir, name), data)
  if (manifest !== null) writeFileSync(path.join(dir, "current.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest))
  process.env.NEXUS_ANDROID_APK_DIR = dir
  return dir
}
const GOOD = { versionName: "0.1.6", versionCode: 1, file: "nexus-0.1.6-1.apk", sha256: "AB".repeat(32), releasedAt: "2026-09-26T03:00:00Z", notes: "First build\nSecond line" }

function req(headers: Record<string, string> = {}, url = "http://localhost/api/app/android/apk") {
  return new NextRequest(url, { headers })
}
async function bytes(res: Response) {
  return Buffer.from(await res.arrayBuffer())
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

beforeEach(() => {
  authMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "u1" } })
  delete process.env.NEXUS_ANDROID_MIN_VERSION
  delete process.env.NEXUS_ANDROID_STORE_URL
  delete process.env.NEXUS_ANDROID_LATEST_VERSION
  delete process.env.NEXUS_ANDROID_LATEST_RELEASED_AT
})

describe("GET /api/app/android/apk", () => {
  it("401 without a session, before looking at the disk", async () => {
    releaseDir(GOOD)
    authMock.mockResolvedValue(null)
    const { GET } = await import("@/app/api/app/android/apk/route")
    const res = await GET(req())
    expect(res.status).toBe(401)
    authMock.mockResolvedValue({ user: {} })
    expect((await GET(req())).status).toBe(401)
  })

  it("404 NO_ANDROID_RELEASE when nothing is published or the manifest names nothing servable", async () => {
    const { GET } = await import("@/app/api/app/android/apk/route")
    const cases: Array<[unknown, Record<string, Buffer>?]> = [
      [null],
      ["{not json"],
      [{ ...GOOD, versionName: "0.1" }],
      [{ ...GOOD, versionCode: 0 }],
      [{ ...GOOD, file: "../current.json" }],
      [{ ...GOOD, file: "sub/nexus.apk" }],
      [{ ...GOOD, file: "nexus.zip" }, { "nexus.zip": APK }],
      [{ ...GOOD, file: "missing.apk" }],
      [GOOD, { "nexus-0.1.6-1.apk": Buffer.alloc(0) }],
    ]
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    for (const [manifest, files] of cases) {
      releaseDir(manifest, files)
      const res = await GET(req())
      expect(res.status, JSON.stringify(manifest)).toBe(404)
      expect(await res.json()).toMatchObject({ code: "NO_ANDROID_RELEASE" })
    }
    warn.mockRestore()
  })

  it("200: the whole APK with the R2 headers", async () => {
    releaseDir(GOOD)
    const { GET } = await import("@/app/api/app/android/apk/route")
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/vnd.android.package-archive")
    expect(res.headers.get("content-length")).toBe(String(SIZE))
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="NEXUS-0.1.6.apk"; filename*=UTF-8''NEXUS-0.1.6.apk`)
    expect(res.headers.get("accept-ranges")).toBe("bytes")
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(res.headers.get("etag")).toMatch(/^"apk-1-50000-\d+"$/)
    expect(res.headers.get("last-modified")).toMatch(/GMT$/)
    expect((await bytes(res)).equals(APK)).toBe(true)
  })

  it("206 for a range, a suffix range and an open range; 416 past the end", async () => {
    releaseDir(GOOD)
    const { GET } = await import("@/app/api/app/android/apk/route")
    let res = await GET(req({ range: "bytes=1000-1999" }))
    expect(res.status).toBe(206)
    expect(res.headers.get("content-range")).toBe(`bytes 1000-1999/${SIZE}`)
    expect(res.headers.get("content-length")).toBe("1000")
    expect((await bytes(res)).equals(APK.subarray(1000, 2000))).toBe(true)

    res = await GET(req({ range: "bytes=-10" }))
    expect(res.status).toBe(206)
    expect((await bytes(res)).equals(APK.subarray(SIZE - 10))).toBe(true)

    res = await GET(req({ range: `bytes=${SIZE - 5}-` }))
    expect(res.status).toBe(206)
    expect(res.headers.get("content-range")).toBe(`bytes ${SIZE - 5}-${SIZE - 1}/${SIZE}`)

    res = await GET(req({ range: `bytes=${SIZE}-` }))
    expect(res.status).toBe(416)
    expect(res.headers.get("content-range")).toBe(`bytes */${SIZE}`)
  })

  it("If-Range: a matching ETag or Last-Modified resumes (206); a stale one gets the whole new file (200)", async () => {
    releaseDir(GOOD)
    const { GET } = await import("@/app/api/app/android/apk/route")
    const first = await GET(req())
    const etag = first.headers.get("etag")!
    const lastModified = first.headers.get("last-modified")!
    expect((await GET(req({ range: "bytes=10-19", "if-range": etag }))).status).toBe(206)
    expect((await GET(req({ range: "bytes=10-19", "if-range": lastModified }))).status).toBe(206)
    const stale = await GET(req({ range: "bytes=10-19", "if-range": '"apk-0-1-2"' }))
    expect(stale.status).toBe(200)
    expect((await bytes(stale)).length).toBe(SIZE)
  })

  it("a new build under a new name changes the ETag (the manifest is re-read, no restart)", async () => {
    const dir = releaseDir(GOOD)
    const { GET } = await import("@/app/api/app/android/apk/route")
    const a = (await GET(req())).headers.get("etag")
    const next = Buffer.concat([APK, Buffer.from("more")])
    writeFileSync(path.join(dir, "nexus-0.1.7-2.apk"), next)
    writeFileSync(path.join(dir, "current.json"), JSON.stringify({ ...GOOD, versionName: "0.1.7", versionCode: 2, file: "nexus-0.1.7-2.apk" }))
    const res = await GET(req())
    expect(res.headers.get("etag")).not.toBe(a)
    expect(res.headers.get("content-disposition")).toContain('filename="NEXUS-0.1.7.apk"')
    expect((await bytes(res)).length).toBe(SIZE + 4)
  })
})

describe("GET /api/app/android/release", () => {
  it("401 without a session; available:false before the first build; the facts after", async () => {
    const { GET } = await import("@/app/api/app/android/release/route")
    authMock.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    authMock.mockResolvedValue({ user: { id: "u1" } })

    releaseDir(null)
    expect(await (await GET()).json()).toEqual({ available: false, minSupported: "0.0.0", latest: null })

    releaseDir(GOOD)
    process.env.NEXUS_ANDROID_LATEST_VERSION = "0.1.6"
    const res = await GET()
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(await res.json()).toEqual({
      available: true, versionName: "0.1.6", versionCode: 1, sizeBytes: SIZE, sha256: "ab".repeat(32),
      releasedAt: "2026-09-26T03:00:00.000Z", notes: "First build\nSecond line", fileName: "NEXUS-0.1.6.apk",
      downloadUrl: "/api/app/android/apk", minSupported: "0.0.0", latest: "0.1.6",
    })
  })
})

describe("426 gate (lib/version-policy.ts)", () => {
  const as = (tag: string, method = "GET") => ({ method, headers: { get: (n: string) => (n.toLowerCase() === "x-nexus-client" ? tag : null) } })

  it("a locked Android build can still fetch its update; everything else is refused with the download page", async () => {
    process.env.NEXUS_ANDROID_MIN_VERSION = "0.1.6"
    const { appUpgradeGate, ANDROID_UPGRADE_DOWNLOAD_MESSAGE } = await import("@/lib/version-policy")
    expect(await appUpgradeGate(as("android/0.1.5/3"), "/api/app/android/apk")).toBeNull()
    expect(await appUpgradeGate(as("android/0.1.5/3"), "/api/app/android/release")).toBeNull()
    expect(await appUpgradeGate(as("android/0.1.5/3"), "/api/app/version-policy")).toBeNull()
    const refused = await appUpgradeGate(as("android/0.1.5/3"), "/api/user/profile")
    expect(refused).toEqual({
      status: 426,
      body: { error: ANDROID_UPGRADE_DOWNLOAD_MESSAGE, code: "UPGRADE_REQUIRED", minSupported: "0.1.6", storeUrl: "https://nexus.znetworks.id/download/android" },
    })
    // Not a prefix match: nothing else under /api/app/android/ is exempt.
    expect(await appUpgradeGate(as("android/0.1.5/3"), "/api/app/android/apk/x")).not.toBeNull()
    expect(await appUpgradeGate(as("android/0.1.6/4"), "/api/user/profile")).toBeNull()
  })

  it("on Play the 426 says Google Play; the rolled minimum refuses after the grace window", async () => {
    const { appUpgradeGate, ANDROID_UPGRADE_REQUIRED_MESSAGE } = await import("@/lib/version-policy")
    process.env.NEXUS_ANDROID_MIN_VERSION = "0.1.6"
    process.env.NEXUS_ANDROID_STORE_URL = "https://play.google.com/store/apps/details?id=id.znetworks.nexus"
    const play = await appUpgradeGate(as("android/0.1.5/3"), "/api/user/profile")
    expect(play?.body).toMatchObject({ error: ANDROID_UPGRADE_REQUIRED_MESSAGE, storeUrl: process.env.NEXUS_ANDROID_STORE_URL })
    delete process.env.NEXUS_ANDROID_STORE_URL

    process.env.NEXUS_ANDROID_LATEST_VERSION = "0.1.7"
    process.env.NEXUS_ANDROID_LATEST_RELEASED_AT = new Date(Date.now() - 60_000).toISOString()
    expect(await appUpgradeGate(as("android/0.1.6/4"), "/api/user/profile")).toBeNull() // inside the window
    process.env.NEXUS_ANDROID_LATEST_RELEASED_AT = new Date(Date.now() - 73 * 3600_000).toISOString()
    expect((await appUpgradeGate(as("android/0.1.6/4"), "/api/user/profile"))?.body.minSupported).toBe("0.1.7")
    expect(await appUpgradeGate(as("android/0.1.6/4"), "/api/app/android/apk")).toBeNull()
  })

  it("the APK paths are exempt for iOS header builds too (they are just exempt paths)", async () => {
    const { appUpgradeGate } = await import("@/lib/version-policy")
    expect(await appUpgradeGate(as("ios/0.0.1/1"), "/api/app/android/apk")).toBeNull()
  })
})

describe("serveFile without a validator is unchanged", () => {
  it("no ETag/Last-Modified, and If-Range is ignored (the Range still applies)", async () => {
    const dir = releaseDir(null, { "clip.mp4": APK })
    const { serveFile } = await import("@/lib/file-response")
    const res = await serveFile(req({ range: "bytes=0-9", "if-range": '"whatever"' }, "http://localhost/api/files/clip.mp4"), path.join(dir, "clip.mp4"))
    expect(res.status).toBe(206)
    expect(res.headers.get("etag")).toBeNull()
    expect(res.headers.get("last-modified")).toBeNull()
    expect(res.headers.get("content-type")).toBe("video/mp4")
  })
})
