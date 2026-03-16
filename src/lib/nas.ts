/**
 * Synology NAS File Station API client
 * Communicates with DSM via HTTP API at /webapi/entry.cgi
 */

const NAS_HOST = process.env.NAS_HOST || "192.168.223.92"
const NAS_PORT = process.env.NAS_PORT || "5000"
const NAS_PROTOCOL = process.env.NAS_PROTOCOL || "http"
const NAS_BASE = `${NAS_PROTOCOL}://${NAS_HOST}:${NAS_PORT}`
const NAS_API = `${NAS_BASE}/webapi/entry.cgi`

// Allowed base paths — prevent directory traversal
const ALLOWED_PATHS = (process.env.NAS_ALLOWED_PATHS || "/volume1").split(",").map((p) => p.trim())

export interface NasFile {
  name: string
  path: string
  isdir: boolean
  size: number
  modified: string
  type: string // extension or "folder"
}

export interface NasListResult {
  files: NasFile[]
  total: number
  offset: number
}

export interface NasAuthResult {
  sid: string
  did?: string
}

// ── Path validation ──────────────────────────────────

export function validateNasPath(path: string): boolean {
  // Normalize and check for traversal
  const normalized = path.replace(/\\/g, "/")
  if (normalized.includes("..") || normalized.includes("//")) return false
  return ALLOWED_PATHS.some((allowed) => normalized.startsWith(allowed))
}

// ── Auth ─────────────────────────────────────────────

export async function nasLogin(account: string, passwd: string): Promise<NasAuthResult> {
  const params = new URLSearchParams({
    api: "SYNO.API.Auth",
    version: "6",
    method: "login",
    account,
    passwd,
    format: "sid",
  })

  const res = await fetch(`${NAS_API}?${params}`, {
    method: "GET",
    signal: AbortSignal.timeout(10000),
  })

  const data = await res.json()
  if (!data.success) {
    throw new NasError(data.error?.code || 0, "Authentication failed")
  }

  return { sid: data.data.sid, did: data.data.did }
}

export async function nasLogout(sid: string): Promise<void> {
  const params = new URLSearchParams({
    api: "SYNO.API.Auth",
    version: "6",
    method: "logout",
    _sid: sid,
  })

  await fetch(`${NAS_API}?${params}`, { signal: AbortSignal.timeout(5000) }).catch(() => {})
}

// ── List files ───────────────────────────────────────

export async function nasList(
  sid: string,
  folderPath: string,
  offset = 0,
  limit = 50,
  sortBy: "name" | "size" | "mtime" = "name",
  sortDirection: "asc" | "desc" = "asc"
): Promise<NasListResult> {
  if (!validateNasPath(folderPath)) {
    throw new NasError(0, "Access denied: path not allowed")
  }

  const params = new URLSearchParams({
    api: "SYNO.FileStation.List",
    version: "2",
    method: "list",
    folder_path: folderPath,
    offset: String(offset),
    limit: String(limit),
    sort_by: sortBy,
    sort_direction: sortDirection,
    additional: '["size","time","type"]',
    _sid: sid,
  })

  const res = await fetch(`${NAS_API}?${params}`, {
    signal: AbortSignal.timeout(15000),
  })

  const data = await res.json()
  if (!data.success) {
    throw new NasError(data.error?.code || 0, "Failed to list files")
  }

  const files: NasFile[] = (data.data.files || []).map((f: Record<string, unknown>) => ({
    name: f.name as string,
    path: f.path as string,
    isdir: f.isdir as boolean,
    size: (f.additional as Record<string, unknown>)?.size as number || 0,
    modified: formatNasTime((f.additional as Record<string, Record<string, unknown>>)?.time?.mtime as number),
    type: f.isdir ? "folder" : getFileExtension(f.name as string),
  }))

  return {
    files,
    total: data.data.total || 0,
    offset: data.data.offset || offset,
  }
}

// ── Search files ─────────────────────────────────────

export async function nasSearch(
  sid: string,
  folderPath: string,
  pattern: string,
  recursive = true
): Promise<NasFile[]> {
  if (!validateNasPath(folderPath)) {
    throw new NasError(0, "Access denied: path not allowed")
  }

  // Start search task
  const startParams = new URLSearchParams({
    api: "SYNO.FileStation.Search",
    version: "2",
    method: "start",
    folder_path: folderPath,
    pattern: `*${pattern}*`,
    recursive: String(recursive),
    _sid: sid,
  })

  const startRes = await fetch(`${NAS_API}?${startParams}`, {
    signal: AbortSignal.timeout(10000),
  })
  const startData = await startRes.json()
  if (!startData.success) {
    throw new NasError(startData.error?.code || 0, "Failed to start search")
  }

  const taskId = startData.data.taskid

  // Poll for results (max 10 attempts, 1s apart)
  let files: NasFile[] = []
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000))

    const listParams = new URLSearchParams({
      api: "SYNO.FileStation.Search",
      version: "2",
      method: "list",
      taskid: taskId,
      limit: "100",
      additional: '["size","time","type"]',
      _sid: sid,
    })

    const listRes = await fetch(`${NAS_API}?${listParams}`, {
      signal: AbortSignal.timeout(10000),
    })
    const listData = await listRes.json()

    if (listData.success && listData.data?.finished) {
      files = (listData.data.files || []).map((f: Record<string, unknown>) => ({
        name: f.name as string,
        path: f.path as string,
        isdir: f.isdir as boolean,
        size: (f.additional as Record<string, unknown>)?.size as number || 0,
        modified: formatNasTime((f.additional as Record<string, Record<string, unknown>>)?.time?.mtime as number),
        type: f.isdir ? "folder" : getFileExtension(f.name as string),
      }))
      break
    }
  }

  // Clean up search task
  const stopParams = new URLSearchParams({
    api: "SYNO.FileStation.Search",
    version: "2",
    method: "stop",
    taskid: taskId,
    _sid: sid,
  })
  await fetch(`${NAS_API}?${stopParams}`).catch(() => {})

  return files
}

// ── Upload file ──────────────────────────────────────

export async function nasUpload(
  sid: string,
  folderPath: string,
  filename: string,
  fileBuffer: Buffer,
  overwrite = true
): Promise<{ path: string; size: number }> {
  if (!validateNasPath(folderPath)) {
    throw new NasError(0, "Access denied: path not allowed")
  }

  const uploadUrl = `${NAS_BASE}/webapi/entry.cgi?api=SYNO.FileStation.Upload&version=2&method=upload&_sid=${sid}`

  const formData = new FormData()
  formData.append("path", folderPath)
  formData.append("create_parents", "true")
  formData.append("overwrite", overwrite ? "true" : "false")
  formData.append("file", new Blob([fileBuffer] as BlobPart[]), filename)

  const res = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(120000), // 2min for large files
  })

  const data = await res.json()
  if (!data.success) {
    throw new NasError(data.error?.code || 0, "Upload failed")
  }

  return {
    path: `${folderPath}/${filename}`,
    size: fileBuffer.byteLength,
  }
}

// ── Download file (returns readable stream info) ─────

export async function nasDownload(
  sid: string,
  filePath: string
): Promise<{ stream: ReadableStream; contentType: string; filename: string; size: number }> {
  if (!validateNasPath(filePath)) {
    throw new NasError(0, "Access denied: path not allowed")
  }

  const params = new URLSearchParams({
    api: "SYNO.FileStation.Download",
    version: "2",
    method: "download",
    path: filePath,
    mode: "download",
    _sid: sid,
  })

  const res = await fetch(`${NAS_API}?${params}`, {
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok || !res.body) {
    throw new NasError(0, "Download failed")
  }

  const contentType = res.headers.get("content-type") || "application/octet-stream"
  const contentLength = parseInt(res.headers.get("content-length") || "0", 10)
  const filename = filePath.split("/").pop() || "file"

  return {
    stream: res.body,
    contentType,
    filename,
    size: contentLength,
  }
}

// ── Create folder ────────────────────────────────────

export async function nasCreateFolder(
  sid: string,
  folderPath: string,
  name: string
): Promise<void> {
  if (!validateNasPath(folderPath)) {
    throw new NasError(0, "Access denied: path not allowed")
  }

  const params = new URLSearchParams({
    api: "SYNO.FileStation.CreateFolder",
    version: "2",
    method: "create",
    folder_path: folderPath,
    name,
    _sid: sid,
  })

  const res = await fetch(`${NAS_API}?${params}`, {
    signal: AbortSignal.timeout(10000),
  })

  const data = await res.json()
  if (!data.success) {
    throw new NasError(data.error?.code || 0, "Failed to create folder")
  }
}

// ── Thumbnail / preview ──────────────────────────────

export function nasThumbnailUrl(sid: string, filePath: string, size: "small" | "medium" | "large" = "small"): string {
  const params = new URLSearchParams({
    api: "SYNO.FileStation.Thumb",
    version: "2",
    method: "get",
    path: filePath,
    size,
    _sid: sid,
  })
  return `${NAS_API}?${params}`
}

// ── Helpers ──────────────────────────────────────────

function getFileExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || ""
  return ext
}

function formatNasTime(timestamp: number | undefined): string {
  if (!timestamp) return ""
  return new Date(timestamp * 1000).toISOString()
}

// ── Simple in-memory session cache ───────────────────

const sessionCache = new Map<string, { sid: string; expires: number }>()
const CACHE_TTL = 15 * 60 * 1000 // 15 minutes

export async function getNasSession(): Promise<string> {
  const cacheKey = "default"
  const cached = sessionCache.get(cacheKey)

  if (cached && cached.expires > Date.now()) {
    return cached.sid
  }

  const account = process.env.NAS_USERNAME
  const passwd = process.env.NAS_PASSWORD

  if (!account || !passwd) {
    throw new NasError(0, "NAS credentials not configured")
  }

  const result = await nasLogin(account, passwd)
  sessionCache.set(cacheKey, { sid: result.sid, expires: Date.now() + CACHE_TTL })

  return result.sid
}

// ── Folder listing cache ─────────────────────────────

const listCache = new Map<string, { data: NasListResult; expires: number }>()
const LIST_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function getCachedList(key: string): NasListResult | null {
  const cached = listCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.data
  listCache.delete(key)
  return null
}

export function setCachedList(key: string, data: NasListResult): void {
  listCache.set(key, { data, expires: Date.now() + LIST_CACHE_TTL })
}

export function invalidateListCache(folder: string): void {
  listCache.forEach((_, key) => {
    if (key.startsWith(folder)) listCache.delete(key)
  })
}

// ── Error class ──────────────────────────────────────

export class NasError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.name = "NasError"
    this.code = code
  }
}
