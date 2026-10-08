// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createServer, type Server as HTTPServer } from "http"
import type { AddressInfo } from "net"
import { io as connect, type Socket as ClientSocket } from "socket.io-client"
import { NextRequest } from "next/server"

// Realtime for projects, folders and the audit log (owner, 8 Oct 2026), end to end on a real Socket.IO
// server (pages/api/socket.ts) with real socket.io-client connections. Only the database and the session
// cookie are faked. What it proves: the server puts each socket in `workspace:<id>` from the user's
// WorkspaceMember rows and in `audit` only when resolveAuditAccess allows it; a route handler's emit
// crosses the event bus and reaches the right workspace and nobody else; and the payload is ids only.

type FakeUser = { name: string; email: string; role: "ADMIN" | "USER"; deactivatedAt: Date | null }

const m = vi.hoisted(() => ({
  users: new Map<string, FakeUser>(),
  memberships: [] as Array<{ userId: string; workspaceId: string; role: string }>,
  actor: "u-alice",
  projects: new Map<string, { workspaceId: string; name: string; members: string[] }>(),
  folders: new Map<string, { workspaceId: string }>(),
  vault: new Map<string, FakeVaultItem>(),
}))

// Z Vault rows, as far as the item route reads them.
type FakeVaultItem = {
  id: string; kind: "FOLDER" | "FILE"; name: string; parentId: string | null; workspaceId: string
  uploaderId: string; ownerId: string | null; deletedAt: Date | null; minReadRole: string | null; minWriteRole: string | null
}
type VaultWhere = { id?: string | { not?: string }; workspaceId?: string; parentId?: string | null | { in: string[] }; deletedAt?: null }
function vaultMatches(row: FakeVaultItem, where: VaultWhere): boolean {
  if (typeof where.id === "string" && row.id !== where.id) return false
  if (where.id && typeof where.id === "object" && where.id.not && row.id === where.id.not) return false
  if (where.workspaceId && row.workspaceId !== where.workspaceId) return false
  if ("deletedAt" in where && where.deletedAt === null && row.deletedAt !== null) return false
  if ("parentId" in where) {
    const p = where.parentId
    if (p && typeof p === "object") { if (!row.parentId || !p.in.includes(row.parentId)) return false }
    else if (row.parentId !== p) return false
  }
  return true
}
function vaultRow(row: FakeVaultItem) {
  return {
    ...row, position: 0, icon: null, color: null, mimeType: null, size: null, width: null, height: null,
    createdAt: new Date("2026-10-09T00:00:00Z"), updatedAt: new Date("2026-10-09T00:00:00Z"),
    uploader: null, owner: null, _count: { children: 0, shares: 0 },
  }
}

vi.mock("next-auth/jwt", () => ({
  // The handshake's cookie names the user; a real JWT is not the point here.
  getToken: async ({ req }: { req: { cookies: Record<string, string> } }) => {
    const id = req.cookies["test-user"]
    const user = id ? m.users.get(id) : undefined
    return user ? { id, name: user.name, sessionVersion: 1 } : null
  },
}))

vi.mock("@/lib/auth", () => ({
  auth: async () => ({ user: { id: m.actor, name: m.users.get(m.actor)?.name ?? "?" } }),
}))

vi.mock("@/lib/prisma", () => {
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const u = m.users.get(where.id)
        return u ? { email: u.email, sessionVersion: 1, deactivatedAt: u.deactivatedAt, role: u.role } : null
      },
    },
    workspaceMember: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        m.memberships.filter((x) => x.userId === where.userId).map(({ workspaceId, role }) => ({ workspaceId, role })),
      // orgRoleOf (lib/org.ts): the role in the company workspace, which is whose the vault is.
      findUnique: async ({ where }: { where: { userId_workspaceId: { userId: string; workspaceId: string } } }) => {
        const k = where.userId_workspaceId
        const row = m.memberships.find((x) => x.userId === k.userId && x.workspaceId === k.workspaceId)
        return row ? { role: row.role } : null
      },
    },
    vaultItem: {
      findFirst: async ({ where }: { where: VaultWhere }) => {
        const row = [...m.vault.values()].find((r) => vaultMatches(r, where))
        return row ? vaultRow(row) : null
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = m.vault.get(where.id)
        return row ? vaultRow(row) : null
      },
      findMany: async ({ where }: { where: VaultWhere }) => [...m.vault.values()].filter((r) => vaultMatches(r, where)).map(vaultRow),
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeVaultItem> }) => {
        const row = { ...m.vault.get(where.id)!, ...data }
        m.vault.set(where.id, row)
        return vaultRow(row)
      },
    },
    auditLog: {
      create: async () => ({ id: `audit-${Math.random().toString(36).slice(2)}` }),
      createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }),
      findFirst: async ({ where }: { where: { AND: Array<{ id?: string }> } }) => ({ id: where.AND[0].id, action: "delete" }),
    },
    project: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const p = m.projects.get(where.id)
        return p ? { id: where.id, name: p.name, workspaceId: p.workspaceId, members: p.members.map((userId) => ({ userId })) } : null
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = m.projects.get(where.id)!
        return { id: where.id, name: p.name, workspaceId: p.workspaceId, ...data, taskLists: [], members: [] }
      },
    },
    projectFolder: {
      findUnique: async ({ where }: { where: { id: string } }) => m.folders.get(where.id) ?? null,
    },
  }
  // lib/vault.ts takes the named export.
  return { default: prisma, prisma }
})

vi.mock("@/lib/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rbac")>()),
  isSystemAdminUser: async (id: string) => m.users.get(id)?.role === "ADMIN",
  checkProjectAccess: async () => ({ allowed: true, role: "LEAD" }),
  checkWorkspaceAccess: async () => ({ allowed: true }),
}))
vi.mock("@/lib/project-sheets", () => ({ resolveSheetAccess: async () => ({ allowed: false }) }))
vi.mock("@/lib/chat-access", () => ({ conversationMemberAccess: async () => ({ ok: false }) }))
vi.mock("@/lib/chat-membership", () => ({ syncProjectRoomSafe: async () => {}, syncUserRoomsSafe: async () => {} }))
vi.mock("@/lib/team-sync", () => ({ syncProjectLinkedTeamAccess: async () => {} }))
vi.mock("@/lib/webhook-dispatcher", () => ({ dispatchWebhookEvent: async () => {} }))
vi.mock("@/lib/deletion-snapshot", () => ({
  deleteKeepingSnapshot: async () => {},
  restorableDelete: async () => {},
  restorableSoftDelete: async () => {},
  restoreDeletion: async () => ({
    ok: true, entityType: "project", entityId: "p-alpha", entityName: "Alpha", fromBackup: false,
    result: { inserted: { Project: 1 }, foldersCreated: 1, skipped: [], relinked: [] },
  }),
}))

import { emitWorkspaceChanged } from "@/lib/socket-emitter"
import { logAudit } from "@/lib/audit"
import { PATCH as patchProject } from "@/app/api/projects/[projectId]/route"
import { PATCH as patchVaultItem } from "@/app/api/vault/items/[itemId]/route"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { POST as restoreEntry } from "@/app/api/audit/[id]/restore/route"

// W1: Alice (BoD → may read the audit), Bob (staff → may not). W2: Carol (staff). Erin is a system admin
// in no workspace at all. Dave was offboarded.
function seed() {
  m.users.clear()
  m.users.set("u-alice", { name: "Alice", email: "alice@x.test", role: "USER", deactivatedAt: null })
  m.users.set("u-bob", { name: "Bob", email: "bob@x.test", role: "USER", deactivatedAt: null })
  m.users.set("u-carol", { name: "Carol", email: "carol@x.test", role: "USER", deactivatedAt: null })
  m.users.set("u-erin", { name: "Erin", email: "erin@x.test", role: "ADMIN", deactivatedAt: null })
  m.users.set("u-dave", { name: "Dave", email: "dave@x.test", role: "USER", deactivatedAt: new Date() })
  m.memberships = [
    { userId: "u-alice", workspaceId: "W1", role: "BOD" },
    { userId: "u-bob", workspaceId: "W1", role: "STAFF" },
    { userId: "u-carol", workspaceId: "W2", role: "STAFF" },
    { userId: "u-dave", workspaceId: "W1", role: "STAFF" },
  ]
  m.projects.clear()
  m.projects.set("p-alpha", { workspaceId: "W1", name: "Alpha", members: ["u-alice"] })
  m.folders.clear()
  m.folders.set("f-2", { workspaceId: "W1" })
  // The company workspace, whose drive Z Vault is: Alice (BoD) and Bob are in it, Carol is not.
  m.memberships.push(
    { userId: "u-alice", workspaceId: ORG_WORKSPACE_ID, role: "BOD" },
    { userId: "u-bob", workspaceId: ORG_WORKSPACE_ID, role: "STAFF" },
  )
  // LOGO holds INTOO (Berlin's own case, 9 Oct 2026).
  const folder = (id: string, name: string, parentId: string | null): FakeVaultItem => ({
    id, kind: "FOLDER", name, parentId, workspaceId: ORG_WORKSPACE_ID,
    uploaderId: "u-alice", ownerId: "u-alice", deletedAt: null, minReadRole: null, minWriteRole: null,
  })
  m.vault.clear()
  m.vault.set("v-logo", folder("v-logo", "LOGO", null))
  m.vault.set("v-intoo", folder("v-intoo", "INTOO", "v-logo"))
}
seed()

let http: HTTPServer
let url = ""
const clients: ClientSocket[] = []

type Seen = { workspace: unknown[]; audit: unknown[] }
const seen = new Map<string, Seen>()

function connectAs(userId: string): Promise<ClientSocket> {
  const socket = connect(url, {
    path: "/api/socket",
    transports: ["websocket"],
    extraHeaders: { cookie: `test-user=${userId}` },
    forceNew: true,
    reconnection: false,
  })
  clients.push(socket)
  const log: Seen = { workspace: [], audit: [] }
  seen.set(userId, log)
  socket.on("workspace-changed", (p: unknown) => log.workspace.push(p))
  socket.on("audit-changed", (p: unknown) => log.audit.push(p))
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve(socket))
    socket.on("connect_error", (err) => reject(err))
  })
}

const settle = (ms = 450) => new Promise((r) => setTimeout(r, ms))
const clearSeen = () => { for (const log of seen.values()) { log.workspace.length = 0; log.audit.length = 0 } }

beforeAll(async () => {
  http = createServer()
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  const { initializeSocketServer } = await import("../../pages/api/socket")
  const res = { socket: { server: http }, status: () => ({ end: () => {} }) }
  initializeSocketServer({} as never, res as never)

  await Promise.all(["u-alice", "u-bob", "u-carol", "u-erin"].map(connectAs))
  // Carol's own user room (the web app joins it on every connect) for the per-user ping below.
  const carol = clients[2]
  await new Promise<void>((resolve) => {
    carol.emit("join-room", { room: "user:u-carol", userId: "u-carol", name: "Carol" })
    setTimeout(resolve, 100)
  })
})

afterAll(async () => {
  for (const c of clients) c.disconnect()
  const io = (http as unknown as { io?: { close: () => void } }).io
  io?.close()
  await new Promise((r) => http.close(() => r(undefined)))
})

beforeEach(() => {
  seed()
  m.actor = "u-alice"
  clearSeen()
})

describe("workspace rooms (server-assigned from WorkspaceMember)", () => {
  it("an emit from the route-handler side reaches its workspace and no other", async () => {
    emitWorkspaceChanged("W1", { kind: "folders", folderId: "f-1", actorId: "u-alice" })
    await settle()
    expect(seen.get("u-alice")!.workspace).toEqual([{ kind: "folders", folderId: "f-1", actorId: "u-alice" }])
    expect(seen.get("u-bob")!.workspace).toHaveLength(1)
    expect(seen.get("u-erin")!.workspace).toHaveLength(1) // system admin: sees every workspace's projects
    expect(seen.get("u-carol")!.workspace).toHaveLength(0) // W2 only

    clearSeen()
    emitWorkspaceChanged("W2", { kind: "projects", projectId: "p-other" })
    await settle()
    expect(seen.get("u-carol")!.workspace).toEqual([{ kind: "projects", projectId: "p-other" }])
    expect(seen.get("u-alice")!.workspace).toHaveLength(0)
    expect(seen.get("u-bob")!.workspace).toHaveLength(0)
  })

  it("carries ids only, whatever the caller passes", async () => {
    emitWorkspaceChanged("W1", { kind: "projects", projectId: "p-alpha", name: "Secret plan", members: ["x"] } as never)
    await settle()
    expect(seen.get("u-bob")!.workspace).toEqual([{ kind: "projects", projectId: "p-alpha" }])
  })

  it("a client cannot put itself in another workspace's room", async () => {
    const carol = clients[2]
    const denied = new Promise<unknown>((resolve) => carol.once("join-denied", resolve))
    carol.emit("join-room", { room: "workspace:W1", userId: "u-carol", name: "Carol" })
    carol.emit("join-room", { room: "audit", userId: "u-carol", name: "Carol" })
    expect(await denied).toEqual({ room: "workspace:W1" })
    emitWorkspaceChanged("W1", { kind: "projects" })
    await settle()
    expect(seen.get("u-carol")!.workspace).toHaveLength(0)
  })

  it("a per-user ping (pins) reaches only that user's own room", async () => {
    emitWorkspaceChanged(null, { kind: "folders", folderId: "f-9", actorId: "u-carol" }, ["u-carol"])
    await settle()
    expect(seen.get("u-carol")!.workspace).toEqual([{ kind: "folders", folderId: "f-9", actorId: "u-carol" }])
    expect(seen.get("u-alice")!.workspace).toHaveLength(0)
    expect(seen.get("u-erin")!.workspace).toHaveLength(0)
  })

  it("refuses an offboarded user, as the handshake always has", async () => {
    await expect(connectAs("u-dave")).rejects.toThrow(/Invalid session/)
  })
})

describe("audit room (resolveAuditAccess)", () => {
  it("logAudit pings only sockets allowed to read the audit, once per burst", async () => {
    await logAudit({ action: "update", entityType: "project", entityId: "p-alpha", userId: "u-bob" })
    await logAudit({ action: "update", entityType: "project", entityId: "p-alpha", userId: "u-bob" })
    await logAudit({ action: "update", entityType: "project", entityId: "p-alpha", userId: "u-bob" })
    await settle()
    expect(seen.get("u-alice")!.audit).toEqual([{ kind: "audit" }])
    expect(seen.get("u-erin")!.audit).toEqual([{ kind: "audit" }])
    expect(seen.get("u-bob")!.audit).toHaveLength(0) // staff: no audit access
    expect(seen.get("u-carol")!.audit).toHaveLength(0)
  })
})

describe("route handlers end to end", () => {
  it("PATCH /api/projects/[id] moving a project to another folder reaches the whole workspace live", async () => {
    const req = new NextRequest("http://localhost/api/projects/p-alpha", {
      method: "PATCH",
      body: JSON.stringify({ folderId: "f-2" }),
      headers: { "content-type": "application/json" },
    })
    const res = await patchProject(req, { params: Promise.resolve({ projectId: "p-alpha" }) })
    expect(res.status).toBe(200)
    await settle()
    const ping = { kind: "projects", projectId: "p-alpha", actorId: "u-alice" }
    expect(seen.get("u-alice")!.workspace).toEqual([ping]) // the actor's own other tabs too
    expect(seen.get("u-bob")!.workspace).toEqual([ping])   // Berlin's colleague on another Mac
    expect(seen.get("u-carol")!.workspace).toHaveLength(0)
    expect(seen.get("u-alice")!.audit).toHaveLength(1)     // the update's audit row
    expect(seen.get("u-bob")!.audit).toHaveLength(0)
  })

  it("PATCH /api/vault/items/[id] moving INTOO out of LOGO pings the company's vault screens, ids only", async () => {
    const req = new NextRequest("http://localhost/api/vault/items/v-intoo", {
      method: "PATCH",
      body: JSON.stringify({ parentId: null }),
      headers: { "content-type": "application/json" },
    })
    const res = await patchVaultItem(req, { params: Promise.resolve({ itemId: "v-intoo" }) })
    expect(res.status).toBe(200)
    expect((await res.json()).parentId).toBeNull()
    expect(m.vault.get("v-intoo")!.parentId).toBeNull()
    await settle()
    const ping = { kind: "vault", actorId: "u-alice" }
    expect(seen.get("u-alice")!.workspace).toEqual([ping]) // the mover's other tabs and devices
    expect(seen.get("u-bob")!.workspace).toEqual([ping])   // a colleague with LOGO open
    expect(seen.get("u-carol")!.workspace).toHaveLength(0) // not in the company workspace
  })

  it("a refused vault move sends nothing", async () => {
    const req = new NextRequest("http://localhost/api/vault/items/v-logo", {
      method: "PATCH",
      body: JSON.stringify({ parentId: "v-intoo" }), // LOGO into its own child
      headers: { "content-type": "application/json" },
    })
    const res = await patchVaultItem(req, { params: Promise.resolve({ itemId: "v-logo" }) })
    expect(res.status).toBe(400)
    await settle()
    expect(seen.get("u-bob")!.workspace).toHaveLength(0)
  })

  it("POST /api/audit/[id]/restore flips every open audit and brings the project and folder back live", async () => {
    const req = new NextRequest("http://localhost/api/audit/a-del/restore", { method: "POST" })
    const res = await restoreEntry(req, { params: Promise.resolve({ id: "a-del" }) })
    expect(res.status).toBe(200)
    await settle()
    expect(seen.get("u-bob")!.workspace).toEqual([
      { kind: "projects", projectId: "p-alpha", actorId: "u-alice" },
      { kind: "folders", actorId: "u-alice" },
    ])
    expect(seen.get("u-carol")!.workspace).toHaveLength(0)
    // The restore's own audit row and the explicit ping arrive as one.
    expect(seen.get("u-alice")!.audit).toEqual([{ kind: "audit" }])
    expect(seen.get("u-erin")!.audit).toEqual([{ kind: "audit" }])
    expect(seen.get("u-bob")!.audit).toHaveLength(0)
  })
})
