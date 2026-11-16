// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

// MCP attendance (17 Nov 2026, lib/mcp-attendance.ts): who a connection may see and correct (the Bagan Approval
// resolver), and the confirmation token that stands between a preview and a write (single use, expiry, bound to
// the person AND the connection). Also the OAuth scope grant and issuer fallback (lib/mcp-oauth.ts).

type Member = { userId: string; workspaceId: string; role: string; approverId: string | null; name: string }
type Confirmation = { id: string; tokenHash: string; userId: string; apiTokenId: string; usedAt: Date | null; expiresAt: Date; payload: unknown; preview: unknown }

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
      updateMany: async ({ where, data }: { where: { tokenHash: string; userId: string; apiTokenId: string; usedAt: null; expiresAt: { gt: Date } }; data: { usedAt: Date } }) => {
        const rows = m.confirmations.filter((c) => c.tokenHash === where.tokenHash && c.userId === where.userId && c.apiTokenId === where.apiTokenId && c.usedAt === null && c.expiresAt > where.expiresAt.gt)
        for (const r of rows) r.usedAt = data.usedAt
        return { count: rows.length }
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => m.confirmations.find((c) => c.tokenHash === where.tokenHash) ?? null,
    },
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

import { assertMayCorrect, attendanceAudience, claimConfirmation, McpAttendanceError } from "@/lib/mcp-attendance"
import { hashToken } from "@/lib/mcp-token-auth"
import { grantedScopes, resolveMcpIssuer } from "@/lib/mcp-oauth"

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

describe("confirmation token (claimConfirmation)", () => {
  const berlin = { userId: "oaa", tokenId: "tok-silk", clientLabel: "Silk", scopes: ["attendance:write"] }
  const seed = (token: string, over: Partial<Confirmation> = {}) => {
    const row: Confirmation = { id: `c-${m.confirmations.length}`, tokenHash: hashToken(token), userId: "oaa", apiTokenId: "tok-silk", usedAt: null, expiresAt: new Date(Date.now() + 600_000), payload: {}, preview: {}, ...over }
    m.confirmations.push(row)
    return row
  }

  it("works once", async () => {
    seed("nxk_one")
    expect(await code(claimConfirmation("nxk_one", berlin))).toBe("OK")
    expect(await code(claimConfirmation("nxk_one", berlin))).toBe("TOKEN_USED")
  })
  it("two applies at the same moment: exactly one wins", async () => {
    seed("nxk_race")
    const results = await Promise.all([code(claimConfirmation("nxk_race", berlin)), code(claimConfirmation("nxk_race", berlin))])
    expect(results.sort()).toEqual(["OK", "TOKEN_USED"])
  })
  it("expires after its 10 minutes", async () => {
    seed("nxk_old", { expiresAt: new Date(Date.now() - 1000) })
    expect(await code(claimConfirmation("nxk_old", berlin))).toBe("TOKEN_EXPIRED")
  })
  it("is bound to the person: someone else's connection cannot use it, and it stays usable for its owner", async () => {
    seed("nxk_bound")
    expect(await code(claimConfirmation("nxk_bound", { ...berlin, userId: "bod" }))).toBe("TOKEN_NOT_YOURS")
    expect(await code(claimConfirmation("nxk_bound", berlin))).toBe("OK")
  })
  it("is bound to the connection: the same person through another token cannot use it", async () => {
    seed("nxk_conn")
    expect(await code(claimConfirmation("nxk_conn", { ...berlin, tokenId: "tok-other" }))).toBe("TOKEN_NOT_YOURS")
  })
  it("refuses anything that is not a token it issued", async () => {
    expect(await code(claimConfirmation("nxk_never", berlin))).toBe("TOKEN_INVALID")
    expect(await code(claimConfirmation("hello", berlin))).toBe("TOKEN_INVALID")
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
  it("issuer: MCP_OAUTH_ISSUER, else NEXUS_PUBLIC_URL, else the production domain (never the retired patsgroup)", () => {
    expect(resolveMcpIssuer({ MCP_OAUTH_ISSUER: "https://dev.example:8443/", NEXUS_PUBLIC_URL: "https://x" })).toBe("https://dev.example:8443")
    expect(resolveMcpIssuer({ NEXUS_PUBLIC_URL: "https://nexus.znetworks.id" })).toBe("https://nexus.znetworks.id")
    expect(resolveMcpIssuer({})).toBe("https://nexus.znetworks.id")
  })
})
