export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getVaultActor, effectiveThresholds, roleMeets, storagePath } from "@/lib/vault"
import { VAULT_ZIP_MAX_BYTES, VAULT_ZIP_MAX_FILES, zipStream, zipSegment, type ZipEntry } from "@/lib/vault-zip"

// POST /api/vault/zip — several vault items (files and folders) as one .zip, for the signed-in
// "Download" on a multi-selection (owner, 9 Oct 2026). Body: JSON `{ ids: string[] }`, or a plain
// form post with `ids` (comma-separated or repeated) — the web submits a form so the browser streams
// the archive to disk instead of holding up to 1 GB in memory.
//
// The same rules as opening each item one by one: only this workspace, nothing in the trash, and
// read access resolved by climbing (lib/vault.ts) — a selected item the caller may not read is left
// out, and inside a folder anything behind a lock their role doesn't clear is left out too. Same
// ceilings as a shared folder's "Download all" (VAULT_ZIP_MAX_FILES / VAULT_ZIP_MAX_BYTES), refused
// with 413 ZIP_TOO_BIG; the streaming itself is lib/vault-zip.ts, shared with that route.
// `?check=1` answers with the totals instead of the archive.

const MAX_IDS = 500

type Row = {
  id: string
  name: string
  kind: string
  storageKey: string | null
  size: number | null
  minReadRole: string | null
  updatedAt: Date
}
const SELECT = { id: true, name: true, kind: true, storageKey: true, size: true, minReadRole: true, updatedAt: true } as const

async function readIds(request: NextRequest): Promise<string[]> {
  const type = request.headers.get("content-type") || ""
  let raw: unknown[] = []
  if (type.includes("application/json")) {
    const body = await request.json().catch(() => null)
    raw = Array.isArray(body?.ids) ? body.ids : []
  } else {
    const form = await request.formData().catch(() => null)
    raw = form ? form.getAll("ids").flatMap((v) => (typeof v === "string" ? v.split(",") : [])) : []
  }
  const ids = raw.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
  return [...new Set(ids)].slice(0, MAX_IDS)
}

function tooBig() {
  return NextResponse.json(
    {
      error: "Too big for one zip. Download fewer items at a time.",
      code: "ZIP_TOO_BIG",
      limits: { files: VAULT_ZIP_MAX_FILES, bytes: VAULT_ZIP_MAX_BYTES },
    },
    { status: 413 },
  )
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const ids = await readIds(request)
    if (!ids.length) return NextResponse.json({ error: "Nothing selected", code: "EMPTY" }, { status: 400 })

    const picked: Row[] = await prisma.vaultItem.findMany({
      where: { id: { in: ids }, workspaceId: actor.workspaceId, deletedAt: null },
      select: SELECT,
    })
    // The page's order, not the database's.
    picked.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))

    const entries: ZipEntry[] = []
    let files = 0
    let bytes = 0
    const addFile = (row: Row, name: string): boolean => {
      if (!row.storageKey) return true
      files += 1
      bytes += row.size ?? 0
      if (files > VAULT_ZIP_MAX_FILES || bytes > VAULT_ZIP_MAX_BYTES) return false
      entries.push({ kind: "file", name, path: storagePath(row.storageKey), modified: row.updatedAt })
      return true
    }
    /** A name not yet used in one folder of the archive: "a.pdf", then "a (2).pdf". */
    const claim = (taken: Set<string>, row: Row): string => {
      const safe = zipSegment(row.name)
      const dot = row.kind === "FILE" ? safe.lastIndexOf(".") : -1
      const [stem, ext] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ""]
      let segment = safe
      for (let n = 2; taken.has(segment.toLowerCase()); n++) segment = `${stem} (${n})${ext}`
      taken.add(segment.toLowerCase())
      return segment
    }

    const rootTaken = new Set<string>()
    let frontier: { id: string; prefix: string; read: string | null }[] = []
    let included = 0
    for (const row of picked) {
      // The selected item's own threshold, inherited from wherever it is set above it.
      const { read } = await effectiveThresholds(row.id)
      if (!roleMeets(actor.orgRole, read)) continue
      included += 1
      const segment = claim(rootTaken, row)
      if (row.kind === "FOLDER") {
        entries.push({ kind: "folder", name: `${segment}/`, modified: row.updatedAt })
        frontier.push({ id: row.id, prefix: segment, read })
      } else if (!addFile(row, segment)) {
        return tooBig()
      }
    }
    if (!included) return NextResponse.json({ error: "Not found", code: "NONE_READABLE" }, { status: 404 })

    // Breadth-first under the selected folders. A child's threshold is its own, or the one it
    // inherits from the folder it sits in — a lock only ever tightens on the way down.
    for (let depth = 0; frontier.length && depth < 40; depth++) {
      const next: typeof frontier = []
      for (const folder of frontier) {
        const children: Row[] = await prisma.vaultItem.findMany({
          where: { parentId: folder.id, workspaceId: actor.workspaceId, deletedAt: null },
          select: SELECT,
          orderBy: [{ kind: "desc" }, { position: "asc" }, { name: "asc" }],
        })
        const taken = new Set<string>()
        for (const child of children) {
          const read = child.minReadRole ?? folder.read
          if (!roleMeets(actor.orgRole, read)) continue
          const name = `${folder.prefix}/${claim(taken, child)}`
          if (child.kind === "FOLDER") {
            entries.push({ kind: "folder", name: `${name}/`, modified: child.updatedAt })
            next.push({ id: child.id, prefix: name, read })
          } else if (!addFile(child, name)) {
            return tooBig()
          }
        }
      }
      frontier = next
    }

    // `?check=1`: the same answer without the archive — 200 { ok, files, bytes } or the 413 above — so
    // the page can say "too big" before the browser is sent to a download that would only refuse.
    if (request.nextUrl.searchParams.get("check") === "1") {
      return NextResponse.json({ ok: true, files, bytes }, { headers: { "Cache-Control": "no-store" } })
    }

    const single = picked.length === 1 && included === 1 && picked[0].kind === "FOLDER" ? picked[0].name : null
    const base = (single ?? `Z Vault – ${included} ${included === 1 ? "item" : "items"}`).replace(/[\r\n"\\/]/g, "").trim() || "Z Vault"
    const filename = `${base}.zip`
    const ascii = filename.replace(/[^\x20-\x7E]/g, "_")
    return new NextResponse(zipStream(entries), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("[vault] zip failed:", error)
    return NextResponse.json({ error: "Failed to make the zip" }, { status: 500 })
  }
}
