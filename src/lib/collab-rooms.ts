import { randomUUID } from "crypto"
import * as Y from "yjs"
import type { Server as IOServer, Socket } from "socket.io"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { eventBus, BUS_EVENTS } from "@/lib/event-bus"
import { createLogger } from "@/lib/logger"
import { canonicalDoc, sanitizeDoc, type BlockDoc, type BlockNode } from "@/lib/blockdoc"
import { bodyAccess, loadBody, parseRoomKey, saveBody, type BodyKind } from "@/lib/block-bodies"
import { FRAGMENT, fragmentBlocks, nodesToY, ydocFromJson, ydocToJson } from "@/lib/collab-ydoc"
import { planBlockMerge } from "@/lib/block-merge"

/**
 * Live editing rooms for the block editor (Yjs over the existing Socket.IO server).
 *
 * One room per open body ("doc:<docId>" | "taskbody:<taskId>"). The SERVER holds the room's Y.Doc:
 *   - it seeds it from the stored JSON (or the kept CollabState when that still matches the JSON), so
 *     two people opening a page at once can never both seed it;
 *   - it applies every editor's update, relays it to the others, and persists the result itself
 *     (JSON + text, debounced) — no browser has to be the one that saves;
 *   - before each save it checks the stored body is still what the room last saved. If something else
 *     wrote it (an older app editing the description, a REST save, GIDEON), that write wins: the room
 *     is dropped and the editors reload ("ydoc:reset"). Last write wins, never a silent overwrite.
 *
 * Protocol (all payloads carry `room`, the key above):
 *   client → "ydoc:join" {room, clientId} + ack({ ok, epoch, canWrite, state } | { ok:false, error })
 *   client ↔ "ydoc:update" {room, update}       a Yjs update (binary)
 *   client ↔ "ydoc:awareness" {room, update}    a y-protocols awareness update (cursors, who is here)
 *   client → "ydoc:leave" {room}
 *   server → "ydoc:hello" {room}                someone joined: send your awareness state again
 *   server → "ydoc:gone" {room, clientIds}      those editors left: drop their cursors
 *   server → "ydoc:saved" {room, at}            persisted
 *   server → "ydoc:reset" {room, reason}        rejoin with a fresh document ("external" | "deleted")
 * `epoch` names one lineage of the Y.Doc: a client that reconnects with another epoch must start over
 * instead of merging (its old state would duplicate the content).
 *
 * State lives on globalThis (the socket server and the API routes are separate module instances).
 */

const log = createLogger("collab")
const SAVE_DEBOUNCE_MS = 1200
const SAVE_MAX_WAIT_MS = 5000
const MAX_UPDATE_BYTES = 2_000_000

type Member = { userId: string; canWrite: boolean; clientIds: Set<number> }
type Room = {
  key: string
  kind: BodyKind
  id: string
  ydoc: Y.Doc
  epoch: string
  members: Map<string, Member>
  persisted: BlockDoc
  persistedCanon: string
  dirty: boolean
  firstDirtyAt: number
  timer: ReturnType<typeof setTimeout> | null
  saving: Promise<void> | null
  lastEditorId: string | null
  editors: Set<string>
  title: string
  dead: boolean
}

type CollabGlobal = {
  rooms: Map<string, Room>; loading: Map<string, Promise<Room | null>>; io: IOServer | null; busBound: boolean
  /**
   * applyBlockEdit as the SOCKET server's module instance has it. The API routes are a separate bundle with
   * their own copy of yjs; touching a room's Y.Doc with another copy breaks (instanceof checks fail, inserted
   * items are refused). So a route hands the edit to the instance that owns the rooms.
   */
  applyEdit?: (opts: BlockEditOptions) => Promise<BlockEditResult>
}
const g = globalThis as unknown as { __nexusCollab?: CollabGlobal }
const state: CollabGlobal = g.__nexusCollab ?? (g.__nexusCollab = { rooms: new Map(), loading: new Map(), io: null, busBound: false })

const ioRoom = (key: string) => `collab:${key}`

function toU8(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (Array.isArray(v) && v.length < MAX_UPDATE_BYTES) return Uint8Array.from(v as number[])
  return null
}

async function createRoom(key: string): Promise<Room | null> {
  const parsed = parseRoomKey(key)
  if (!parsed) return null
  const body = await loadBody(parsed.kind, parsed.id)
  if (!body) return null
  const canon = canonicalDoc(body.json)
  let ydoc: Y.Doc | null = null
  let epoch: string = randomUUID()
  const kept = await prisma.collabState.findUnique({ where: { key } }).catch(() => null)
  if (kept) {
    try {
      const y = new Y.Doc()
      Y.applyUpdate(y, new Uint8Array(kept.state))
      const json = sanitizeDoc(ydocToJson(y))
      if (json && canonicalDoc(json) === canon) {
        ydoc = y
        epoch = kept.epoch
      } else y.destroy()
    } catch (error) {
      log.warn("kept state unreadable; reseeding", { key, error: String(error) })
    }
  }
  if (!ydoc) {
    ydoc = ydocFromJson(body.json)
    // Keep this lineage from the first join, not only from the first save: a room that unloads before anyone
    // typed online (everyone went offline, a blue-green switch) then comes back in the SAME epoch, so a
    // client reconnecting with edits kept offline can still merge them (bughunt E-BUG-2).
    await prisma.collabState.upsert({
      where: { key },
      create: { key, state: Buffer.from(Y.encodeStateAsUpdate(ydoc)), epoch },
      update: { state: Buffer.from(Y.encodeStateAsUpdate(ydoc)), epoch },
    }).catch((error) => log.warn("could not keep the seeded lineage", { key, error: String(error) }))
  }
  return {
    key, kind: parsed.kind, id: parsed.id, ydoc, epoch,
    members: new Map(), persisted: body.json, persistedCanon: canon,
    dirty: false, firstDirtyAt: 0, timer: null, saving: null,
    lastEditorId: null, editors: new Set(), title: body.title, dead: false,
  }
}

async function getRoom(key: string): Promise<Room | null> {
  const live = state.rooms.get(key)
  if (live && !live.dead) return live
  let p = state.loading.get(key)
  if (!p) {
    p = createRoom(key).then((room) => {
      if (room) state.rooms.set(key, room)
      return room
    }).finally(() => state.loading.delete(key))
    state.loading.set(key, p)
  }
  return p
}

function schedule(room: Room) {
  if (room.timer) clearTimeout(room.timer)
  const wait = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, room.firstDirtyAt + SAVE_MAX_WAIT_MS - Date.now()))
  room.timer = setTimeout(() => { room.timer = null; void persist(room) }, wait)
}

/** Drop a room and tell its editors to rejoin (they get whatever is stored now). */
function resetRoom(room: Room, reason: "external" | "deleted") {
  if (room.dead) return
  room.dead = true
  if (room.timer) clearTimeout(room.timer)
  state.rooms.delete(room.key)
  state.io?.to(ioRoom(room.key)).emit("ydoc:reset", { room: room.key, reason })
  state.io?.in(ioRoom(room.key)).socketsLeave(ioRoom(room.key))
  room.ydoc.destroy()
  log.info("room reset", { key: room.key, reason })
}

async function persistOnce(room: Room) {
  if (!room.dirty || room.dead) return
  room.dirty = false
  const json = sanitizeDoc(ydocToJson(room.ydoc))
  if (!json) {
    log.warn("room document over the limits; not saved", { key: room.key })
    return
  }
  const canon = canonicalDoc(json)
  const stored = await loadBody(room.kind, room.id)
  if (!stored) return resetRoom(room, "deleted")
  if (canonicalDoc(stored.json) !== room.persistedCanon) return resetRoom(room, "external")
  if (canon !== room.persistedCanon) {
    await saveBody(stored, json, { actorId: room.lastEditorId, prev: room.persisted, fromRoom: true })
    room.persisted = json
    room.persistedCanon = canon
  }
  const update = Buffer.from(Y.encodeStateAsUpdate(room.ydoc))
  await prisma.collabState.upsert({
    where: { key: room.key },
    create: { key: room.key, state: update, epoch: room.epoch },
    update: { state: update, epoch: room.epoch },
  })
  state.io?.to(ioRoom(room.key)).emit("ydoc:saved", { room: room.key, at: new Date().toISOString() })
}

/**
 * Save now (one at a time per room); re-runs while edits keep arriving during a save.
 *
 * Nothing to save = no promise kept. Before 12 Oct 2026 a call with a clean room ran the async body to its
 * `finally` synchronously (no await was reached), cleared `saving` and only THEN stored the already-settled
 * promise in it — so `saving` stayed set forever and every later edit in that room was never saved (found
 * by the app-edit test: a debounce timer firing just after another save had cleaned the room).
 */
function persist(room: Room): Promise<void> {
  if (room.saving) return room.saving
  if (!room.dirty || room.dead) return Promise.resolve()
  const holder: { run?: Promise<void> } = {}
  holder.run = (async () => {
    await Promise.resolve() // `saving` is assigned before anything below runs
    try {
      while (room.dirty && !room.dead) await persistOnce(room)
    } catch (error) {
      log.error("room save failed", { key: room.key, error: String(error) })
      room.dirty = true
      if (!room.dead) schedule(room)
    } finally {
      if (room.saving === holder.run) room.saving = null
    }
  })()
  room.saving = holder.run
  return holder.run
}

async function closeIfEmpty(room: Room) {
  if (room.members.size > 0) return
  if (room.timer) { clearTimeout(room.timer); room.timer = null }
  await persist(room)
  if (room.members.size > 0 || room.dead) return
  state.rooms.delete(room.key)
  room.dead = true
  room.ydoc.destroy()
  if (room.editors.size && room.lastEditorId) {
    // One audit row per editing session, not one per autosave.
    logAudit({
      action: "update",
      entityType: room.kind === "doc" ? "doc" : "task",
      entityId: room.id,
      entityName: room.title,
      userId: room.lastEditorId,
      metadata: { changes: [room.kind === "doc" ? "content" : "description"], via: "block-editor", editors: [...room.editors] },
    }).catch(() => undefined)
  }
}

function removeMember(socket: Socket, key: string) {
  const room = state.rooms.get(key)
  socket.leave(ioRoom(key))
  ;(socket.data.collabRooms as Set<string> | undefined)?.delete(key)
  if (!room) return
  const member = room.members.get(socket.id)
  room.members.delete(socket.id)
  if (member?.clientIds.size) socket.to(ioRoom(key)).emit("ydoc:gone", { room: key, clientIds: [...member.clientIds] })
  void closeIfEmpty(room)
}

/** Wire the collab events on one connected socket (pages/api/socket.ts). */
export function attachCollabSocket(io: IOServer, socket: Socket) {
  state.io = io
  state.applyEdit = applyBlockEdit
  bindBus()
  socket.data.collabRooms = new Set<string>()

  socket.on("ydoc:join", async (data: { room?: unknown; clientId?: unknown }, ack?: (res: unknown) => void) => {
    const reply = typeof ack === "function" ? ack : () => undefined
    try {
      const userId = socket.data.userId as string
      const parsed = parseRoomKey(data?.room)
      if (!parsed) return reply({ ok: false, error: "bad_room" })
      const access = await bodyAccess(userId, parsed.kind, parsed.id)
      if (!access.read) return reply({ ok: false, error: "forbidden" })
      const key = `${parsed.kind}:${parsed.id}`
      const room = await getRoom(key)
      if (!room) return reply({ ok: false, error: "not_found" })
      const clientIds = new Set<number>()
      if (typeof data?.clientId === "number" && Number.isFinite(data.clientId)) clientIds.add(data.clientId)
      room.members.set(socket.id, { userId, canWrite: access.write, clientIds })
      ;(socket.data.collabRooms as Set<string>).add(key)
      await socket.join(ioRoom(key))
      // The others resend their cursor/presence so the newcomer sees them at once.
      socket.to(ioRoom(key)).emit("ydoc:hello", { room: key })
      reply({ ok: true, room: key, epoch: room.epoch, canWrite: access.write, state: Buffer.from(Y.encodeStateAsUpdate(room.ydoc)) })
    } catch (error) {
      log.warn("join failed", { error: String(error) })
      reply({ ok: false, error: "failed" })
    }
  })

  socket.on("ydoc:update", (data: { room?: unknown; update?: unknown }) => {
    const key = typeof data?.room === "string" ? data.room : ""
    const room = state.rooms.get(key)
    const member = room?.members.get(socket.id)
    if (!room || room.dead || !member) return
    if (!member.canWrite) {
      socket.emit("ydoc:reset", { room: key, reason: "readonly" })
      return
    }
    const update = toU8(data?.update)
    if (!update || update.byteLength > MAX_UPDATE_BYTES) return
    try {
      Y.applyUpdate(room.ydoc, update, socket.id)
    } catch (error) {
      log.warn("bad update ignored", { key, error: String(error) })
      return
    }
    socket.to(ioRoom(key)).emit("ydoc:update", { room: key, update })
    if (!room.dirty) room.firstDirtyAt = Date.now()
    room.dirty = true
    room.lastEditorId = member.userId
    room.editors.add(member.userId)
    schedule(room)
  })

  socket.on("ydoc:awareness", (data: { room?: unknown; update?: unknown; clientId?: unknown }) => {
    const key = typeof data?.room === "string" ? data.room : ""
    const room = state.rooms.get(key)
    const member = room?.members.get(socket.id)
    if (!room || !member) return
    const update = toU8(data?.update)
    if (!update || update.byteLength > 64_000) return
    if (typeof data?.clientId === "number") member.clientIds.add(data.clientId)
    socket.to(ioRoom(key)).emit("ydoc:awareness", { room: key, update })
  })

  socket.on("ydoc:leave", (data: { room?: unknown }) => {
    if (typeof data?.room === "string") removeMember(socket, data.room)
  })

  socket.on("disconnect", () => {
    for (const key of [...((socket.data.collabRooms as Set<string> | undefined) ?? [])]) removeMember(socket, key)
  })
}

function bindBus() {
  if (state.busBound) return
  state.busBound = true
  eventBus.on(BUS_EVENTS.COLLAB_EXTERNAL_WRITE, (data: { key?: string }) => {
    const room = data?.key ? state.rooms.get(data.key) : undefined
    if (room) resetRoom(room, "external")
  })
}

/** For a REST save: is someone editing this body live right now? */
export function liveEditors(key: string): number {
  return state.rooms.get(key)?.members.size ?? 0
}

// ---------------------------------------------------------------- edits that do not come from a live editor

export type BlockEditResult =
  | { status: 200; doc: BlockDoc; changed: boolean; epoch: string }
  | { status: 409; doc: BlockDoc; conflicts: number[]; epoch: string }
  | { status: 404 }

const blockCanon = (b: unknown) => canonicalDoc({ type: "doc", content: [b] })

/**
 * Applies an edit made outside the live editor (the iOS app, 12 Oct 2026) to the LIVE document: the room's
 * Y.Doc, opened for it when nobody has the page open. `base` is the document the app started from, `mine`
 * what it ended with. The app's changes are planned block by block against what the room holds now
 * (lib/block-merge.ts), applied in one Yjs transaction, relayed to every open editor as a normal Yjs
 * update (they see it at once, nothing is reloaded or overwritten), and saved through the room's own
 * persistence. A block the app changed that someone else also changed is a conflict (409 with the live
 * document) unless `keepBoth`, which keeps their version and adds the app's beside it.
 */
export type BlockEditOptions = { kind: BodyKind; id: string; userId: string; base: BlockDoc; mine: BlockDoc; keepBoth: boolean }

/** What API routes call: the socket server's instance when it is running in this process (see applyEdit). */
export function requestBlockEdit(opts: BlockEditOptions): Promise<BlockEditResult> {
  return state.applyEdit ? state.applyEdit(opts) : applyBlockEdit(opts)
}

export async function applyBlockEdit(opts: BlockEditOptions): Promise<BlockEditResult> {
  const key = `${opts.kind}:${opts.id}`
  const room = await getRoom(key)
  if (!room || room.dead) return { status: 404 }
  const fragment = room.ydoc.getXmlFragment(FRAGMENT)
  const live = fragmentBlocks(fragment)
  const plan = planBlockMerge(opts.base.content, opts.mine.content, live, blockCanon, opts.keepBoth)
  const liveDoc = (): BlockDoc => sanitizeDoc(ydocToJson(room.ydoc)) ?? { type: "doc", content: [{ type: "paragraph" }] }
  if (plan.conflicts.length) {
    if (room.members.size === 0) void closeIfEmpty(room)
    return { status: 409, doc: liveDoc(), conflicts: plan.conflicts, epoch: room.epoch }
  }
  if (plan.changed) {
    const before = Y.encodeStateVector(room.ydoc)
    room.ydoc.transact(() => {
      for (const op of plan.ops) {
        if (op.type === "delete") {
          if (op.liveIndex < fragment.length) fragment.delete(op.liveIndex, 1)
        } else {
          const items = nodesToY(op.nodes as BlockNode[])
          if (items.length) fragment.insert(Math.min(op.liveIndex, fragment.length), items)
        }
      }
    }, "app-edit")
    const update = Y.encodeStateAsUpdate(room.ydoc, before)
    // Every open editor applies it like a collaborator's keystrokes.
    state.io?.to(ioRoom(key)).emit("ydoc:update", { room: key, update: Buffer.from(update) })
    if (!room.dirty) room.firstDirtyAt = Date.now()
    room.dirty = true
    room.lastEditorId = opts.userId
    room.editors.add(opts.userId)
    await persist(room)
  }
  const doc = liveDoc()
  const epoch = room.epoch
  if (room.members.size === 0) await closeIfEmpty(room)
  return { status: 200, doc, changed: plan.changed, epoch }
}
