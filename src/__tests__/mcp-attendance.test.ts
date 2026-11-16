// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

// MCP attendance (17 Nov 2026, lib/mcp-attendance.ts): who a connection may see and correct (the Bagan Approval
// resolver), and the confirmation token that stands between a preview and a write (single use, expiry, bound to
// the person AND the connection). Also the OAuth scope grant and issuer fallback (lib/mcp-oauth.ts).

type Member = { userId: string; workspaceId: string; role: string; approverId: string | null; name: string }
type Confirmation = { id: string; tokenHash: string; userId: string; apiTokenId: string; usedAt: Date | null; expiresAt: Date; payload: unknown; preview: unknown; status: string; clientLabel: string; action: string; decidedAt: Date | null; decidedById: string | null; error: string | null }

const m = vi.hoisted(() => ({ members: [] as Member[], confirmations: [] as Confirmation[], ctx: new Map<string, unknown>() }))

vi.mock("@/lib/prisma", () => {
  const db = {
    workspaceMember: {
      findUnique: async ({ where }: { where: { userId_workspaceId: { userId: string; workspaceId: string } } }) =>
        m.members.find((r) => r.userId === where.userId_workspaceId.userId && r.workspaceId === where.userId_workspaceId.workspaceId) ?? null,
      findMany: async ({ where }: { where: { workspaceId: string; role?: string; userId?: { not: string } } }) =>
        m.members
          .filter((r) => r.workspaceId === where.workspaceId && (!where.role || r.role === where.role) && (!where.userId || r.userId !== where.userId.not))
          .map((r) => ({ userId: r.userId, role: r.role, approverId: r.approverId, user: { name: r.name, email: `${r.userId}@x.test` } })),
    },
    mcpConfirmation: {
      // One conditional UPDATE, as Postgres runs it: the match and the write happen together.
      updateMany: async ({ where, data }: { where: { id: string; status: string; expiresAt: { gt: Date } }; data: Partial<Confirmation> }) => {
        const rows = m.confirmations.filter((c) => c.id === where.id && c.status === where.status && c.expiresAt > where.expiresAt.gt)
        for (const r of rows) Object.assign(r, data)
        return { count: rows.length }
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Confirmation> }) => {
        const r = m.confirmations.find((c) => c.id === where.id)!
        Object.assign(r, data)
        return r
      },
      findUnique: async ({ where }: { where: { tokenHash?: string; id?: string } }) =>
        m.confirmations.find((c) => (where.tokenHash ? c.tokenHash === where.tokenHash : c.id === where.id)) ?? null,
    },
    // The connection: absent here, so an approval that gets through the claim stops at "disconnected" (FAILED).
    apiToken: { findUnique: async () => null },
  }
  return { default: db, prisma: db }
})

vi.mock("@/lib/attendance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attendance")>()),
  getAttendanceWorkspaceContext: async (userId: string) => m.ctx.get(userId),
}))
// The write paths are the web's own (tested with the routes); here only the gates in front of them.
vi.mock("@/lib/attendance-override", () => ({ applyAttendanceOverride: vi.fn(), resolveOverridePresentTimes: vi.fn() }))
vi.mock("@/lib/attendance-record-correction", () => ({ applyAttendanceRecordCorrection: vi.fn(), planAttendanceRecordCorrection: vi.fn() }))
vi.mock("@/lib/attendance-days", () => ({ classifyAttendanceDays: vi.fn() }))
vi.mock("@/lib/socket-emitter", () => ({ emitAttendanceChanged: vi.fn() }))

import { approvalCsrf, approvalView, assertMayCorrect, attendanceAudience, decideApproval, effectiveStatus, getCorrectionStatus, McpAttendanceError } from "@/lib/mcp-attendance"
import { hashToken } from "@/lib/mcp-token-auth"
import { grantedScopes, matchesRegisteredRedirectUriFromQuery, resolveMcpIssuer } from "@/lib/mcp-oauth"

const WS = "ws-1"
const ws = { id: WS, name: "Z", slug: "z" }
// The context shapes getAttendanceWorkspaceContext returns (see oaa-self-approve.test.ts).
const contexts = {
  oaa: { workspace: ws, workspaceRole: "ONE_ABOVE_ALL", canManageAttendance: true, approvalScopeUserIds: null, directReportIds: [] },
  bod: { workspace: ws, workspaceRole: "BOD", canManageAttendance: true, approvalScopeUserIds: ["mgr", "staff"], directReportIds: [] },
  bod2: { workspace: ws, workspaceRole: "BOD", canManageAttendance: true, approvalScopeUserIds: ["staff2"], directReportIds: [] },
  mgr: { workspace: ws, workspaceRole: "MANAGER", canManageAttendance: false, approvalScopeUserIds: ["staff"], directReportIds: ["staff"] },
  staff: { workspace: ws, workspaceRole: "STAFF", canManageAttendance: false, approvalScopeUserIds: [], directReportIds: [] },
}

beforeEach(() => {
  m.members = [
    { userId: "oaa", workspaceId: WS, role: "ONE_ABOVE_ALL", approverId: null, name: "Owner" },
    { userId: "bod", workspaceId: WS, role: "BOD", approverId: null, name: "Bod" },
    { userId: "bod2", workspaceId: WS, role: "BOD", approverId: null, name: "Bod Two" },
    { userId: "mgr", workspaceId: WS, role: "MANAGER", approverId: "bod", name: "Manager" },
    { userId: "staff", workspaceId: WS, role: "STAFF", approverId: "mgr", name: "Staff" },
    { userId: "staff2", workspaceId: WS, role: "STAFF", approverId: "bod2", name: "Staff Two" },
  ]
  m.ctx = new Map(Object.entries(contexts))
  m.confirmations = []
})

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    if (e instanceof McpAttendanceError) return e.code
    throw e
  }
}

describe("who a connection may correct (assertMayCorrect)", () => {
  it("One Above All: anyone in the workspace", async () => {
    expect(await code(assertMayCorrect("oaa", "staff", contexts.oaa as never))).toBe("OK")
    expect(await code(assertMayCorrect("oaa", "staff2", contexts.oaa as never))).toBe("OK")
  })
  it("a BoD: their own tree only, never another BoD's", async () => {
    expect(await code(assertMayCorrect("bod", "staff", contexts.bod as never))).toBe("OK")
    expect(await code(assertMayCorrect("bod", "staff2", contexts.bod as never))).toBe("OUTSIDE_APPROVAL_CHAIN")
  })
  it("a BoD cannot correct their own days (four-eyes)", async () => {
    expect(await code(assertMayCorrect("bod", "bod", contexts.bod as never))).toBe("SELF")
  })
  it("a Manager: no correction right at all (same as the web), even for a direct report", async () => {
    expect(await code(assertMayCorrect("mgr", "staff", contexts.mgr as never))).toBe("FORBIDDEN")
  })
  it("Staff: none", async () => {
    expect(await code(assertMayCorrect("staff", "staff", contexts.staff as never))).toBe("FORBIDDEN")
  })
  it("someone who is not a current member", async () => {
    expect(await code(assertMayCorrect("oaa", "ghost", contexts.oaa as never))).toBe("NOT_A_MEMBER")
  })
})

describe("who a connection may see (attendanceAudience)", () => {
  const ids = async (viewer: string) => (await attendanceAudience(viewer)).people.map((p) => p.id).sort()
  it("Staff sees only themself", async () => {
    expect(await ids("staff")).toEqual(["staff"])
  })
  it("a Manager sees themself and their direct reports, and may correct none", async () => {
    const { people } = await attendanceAudience("mgr")
    expect(people.map((p) => p.id).sort()).toEqual(["mgr", "staff"])
    expect(people.every((p) => !p.canCorrect)).toBe(true)
  })
  it("a BoD sees their tree, not another BoD's tree", async () => {
    expect(await ids("bod")).toEqual(["bod", "mgr", "staff"])
  })
  it("One Above All sees everyone and may correct everyone (their own days included)", async () => {
    const { people } = await attendanceAudience("oaa")
    expect(people.map((p) => p.id).sort()).toEqual(["bod", "bod2", "mgr", "oaa", "staff", "staff2"])
    expect(people.every((p) => p.canCorrect)).toBe(true)
  })
})

describe("web approval (approvalView / decideApproval / getCorrectionStatus)", () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret"
  const owner = { id: "oaa", name: "Owner" }
  const req = {} as never
  const seed = (secret: string, over: Partial<Confirmation> = {}) => {
    const row: Confirmation = {
      id: `c-${m.confirmations.length}`, tokenHash: hashToken(secret), userId: "oaa", apiTokenId: "tok-silk", usedAt: null,
      expiresAt: new Date(Date.now() + 600_000), payload: { kind: "FIX_TIMES" }, preview: { summary: "Fix times · Staff · 2026-11-10" },
      status: "PENDING", clientLabel: "Silk - AI Agent Berlin", action: "attendance:FIX_TIMES", decidedAt: null, decidedById: null, error: null, ...over,
    }
    m.confirmations.push(row)
    return row
  }
  const decide = (secret: string, decision: "APPROVE" | "REJECT", who = owner, csrf?: string) =>
    code(decideApproval({ secret, session: who, decision, csrf: csrf ?? approvalCsrf(m.confirmations.find((c) => c.tokenHash === hashToken(secret))?.id ?? "x", who.id), request: req }))

  it("the page shows the request to its owner only; another BoD (or anyone else) is refused", async () => {
    seed("s-view")
    expect((await approvalView("s-view", "oaa")).app).toBe("Silk - AI Agent Berlin")
    expect(await code(approvalView("s-view", "bod"))).toBe("WRONG_USER")
    expect(await code(approvalView("not-a-link", "oaa"))).toBe("NOT_FOUND")
  })
  it("another person's session cannot decide, even with a token of its own", async () => {
    seed("s-other")
    expect(await decide("s-other", "APPROVE", { id: "bod", name: "Bod" })).toBe("WRONG_USER")
    expect(m.confirmations[0].status).toBe("PENDING")
  })
  it("a decision without the page's CSRF token is refused", async () => {
    seed("s-csrf")
    expect(await decide("s-csrf", "APPROVE", owner, "forged")).toBe("CSRF")
    expect(m.confirmations[0].status).toBe("PENDING")
  })
  it("reject, then any further decision is refused", async () => {
    seed("s-rej")
    expect(await decide("s-rej", "REJECT")).toBe("OK")
    expect(await decide("s-rej", "APPROVE")).toBe("ALREADY_DECIDED")
    expect(m.confirmations[0].status).toBe("REJECTED")
  })
  it("expired after 10 minutes", async () => {
    seed("s-old", { expiresAt: new Date(Date.now() - 1000) })
    expect(await decide("s-old", "APPROVE")).toBe("EXPIRED")
    expect(effectiveStatus(m.confirmations[0])).toBe("EXPIRED")
  })
  it("double click: two approvals at once, exactly one is claimed (it runs; here it stops at the missing connection)", async () => {
    seed("s-race")
    const r = (await Promise.all([decide("s-race", "APPROVE"), decide("s-race", "APPROVE")])).sort()
    expect(r).toEqual(["ALREADY_DECIDED", "DISCONNECTED"])
    expect(m.confirmations[0].status).toBe("FAILED")
  })
  it("the assistant reads the outcome of its own requests only", async () => {
    const row = seed("s-status")
    const silk = { userId: "oaa", tokenId: "tok-silk", clientLabel: "Silk - AI Agent Berlin", scopes: ["attendance:read"] }
    expect((await getCorrectionStatus(silk, row.id)).status).toBe("PENDING")
    expect(await code(getCorrectionStatus({ ...silk, tokenId: "tok-other" }, row.id))).toBe("NOT_FOUND")
    expect(await code(getCorrectionStatus({ ...silk, userId: "bod" }, row.id))).toBe("NOT_FOUND")
  })
})

describe("OAuth scopes and issuer (lib/mcp-oauth.ts)", () => {
  it("asks for nothing → tasks only, as before", () => {
    expect(grantedScopes(null)).toEqual(["tasks:read", "tasks:write"])
    expect(grantedScopes("openid profile")).toEqual(["tasks:read", "tasks:write"])
  })
  it("attendance only when asked for; a write scope brings its read scope", () => {
    expect(grantedScopes("tasks:write attendance:write")).toEqual(["tasks:read", "tasks:write", "attendance:read", "attendance:write"])
    expect(grantedScopes("attendance:read")).toEqual(["attendance:read"])
  })
  it("a 127.0.0.1 callback still matches after Next.js rewrote it to localhost in the query; nothing else is loosened", () => {
    const reg = ["http://127.0.0.1:8765/callback"]
    expect(matchesRegisteredRedirectUriFromQuery("http://127.0.0.1:8765/callback", reg)).toBe(true)
    expect(matchesRegisteredRedirectUriFromQuery("http://localhost:8765/callback", reg)).toBe(true)
    expect(matchesRegisteredRedirectUriFromQuery("http://localhost:9999/callback", reg)).toBe(false)
    expect(matchesRegisteredRedirectUriFromQuery("https://evil.example/callback", reg)).toBe(false)
    expect(matchesRegisteredRedirectUriFromQuery("http://localhost/callback", ["https://claude.ai/api/mcp/auth_callback"])).toBe(false)
  })
  it("issuer: MCP_OAUTH_ISSUER, else NEXUS_PUBLIC_URL, else the production domain (never the retired patsgroup)", () => {
    expect(resolveMcpIssuer({ MCP_OAUTH_ISSUER: "https://dev.example:8443/", NEXUS_PUBLIC_URL: "https://x" })).toBe("https://dev.example:8443")
    expect(resolveMcpIssuer({ NEXUS_PUBLIC_URL: "https://nexus.znetworks.id" })).toBe("https://nexus.znetworks.id")
    expect(resolveMcpIssuer({})).toBe("https://nexus.znetworks.id")
  })
})
