/**
 * Per-project NAS file storage helpers.
 *
 * Each project gets a dedicated folder on the NAS:
 *   {NAS_PROJECT_FILES_ROOT}/{projectId}[/{subPath}]
 *
 * The client never sends absolute NAS paths — it only sends a project id (from the
 * route) plus an optional *relative* sub-path. We resolve the absolute path here and
 * validate it so a project can never reach outside its own folder.
 *
 * NAS_PROJECT_FILES_ROOT must live under one of NAS_ALLOWED_PATHS (default /volume1)
 * and should point at (or inside) an existing Synology shared folder. Default:
 *   /volume1/homes/berlin/nexus-projects
 * (the same home dir the backup uploads already use, so it is known-writable by the
 *  NAS service account — override with NAS_PROJECT_FILES_ROOT if the account differs).
 */

import {
  getNasSession,
  nasCreateFolder,
  nasList,
  validateNasPath,
  type NasListResult,
  NasError,
} from "@/lib/nas"

export function getProjectFilesRoot(): string {
  const root = (process.env.NAS_PROJECT_FILES_ROOT || "/volume1/homes/berlin/nexus-projects").trim()
  return root.replace(/\/+$/, "")
}

/** Sanitize a client-supplied relative sub-path. Returns "" for root. */
export function sanitizeSubPath(raw: string | null | undefined): string {
  if (!raw) return ""
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
  if (!normalized) return ""
  // Reject traversal / empty segments.
  const segments = normalized.split("/")
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new NasError(0, "Invalid path")
    }
  }
  return segments.join("/")
}

/** Absolute NAS folder for a project (+ optional relative sub-path), fully validated. */
export function resolveProjectFolder(projectId: string, subPath?: string | null): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new NasError(0, "Invalid project id")
  }
  const sub = sanitizeSubPath(subPath)
  const folder = `${getProjectFilesRoot()}/${projectId}${sub ? `/${sub}` : ""}`
  if (!validateNasPath(folder)) {
    throw new NasError(0, "Access denied: path not allowed")
  }
  return folder
}

/** Strip the project root prefix from an absolute NAS path → relative path within the project. */
export function toRelativePath(projectId: string, absPath: string): string {
  const base = `${getProjectFilesRoot()}/${projectId}`
  if (absPath === base) return ""
  if (absPath.startsWith(`${base}/`)) return absPath.slice(base.length + 1)
  return absPath
}

/**
 * List a project folder, lazily creating it (and any missing parents) the first time
 * it's accessed so an empty project shows an empty list instead of erroring.
 */
export async function listProjectFolder(
  projectId: string,
  subPath: string | undefined,
  opts: { offset?: number; limit?: number; sortBy?: "name" | "size" | "mtime"; sortDirection?: "asc" | "desc" } = {}
): Promise<NasListResult> {
  const folder = resolveProjectFolder(projectId, subPath)
  const sid = await getNasSession()
  try {
    return await nasList(sid, folder, opts.offset ?? 0, opts.limit ?? 100, opts.sortBy ?? "name", opts.sortDirection ?? "asc")
  } catch (err) {
    // Folder doesn't exist yet → create it and return empty. Synology "no such file" = 408.
    if (err instanceof NasError) {
      await ensureProjectFolder(projectId, subPath).catch(() => {})
      try {
        return await nasList(sid, folder, opts.offset ?? 0, opts.limit ?? 100, opts.sortBy ?? "name", opts.sortDirection ?? "asc")
      } catch {
        return { files: [], total: 0, offset: 0 }
      }
    }
    throw err
  }
}

/** Ensure a project folder (or sub-folder) exists, creating parents as needed. */
export async function ensureProjectFolder(projectId: string, subPath?: string | null): Promise<string> {
  const folder = resolveProjectFolder(projectId, subPath)
  const sid = await getNasSession()
  const parent = folder.slice(0, folder.lastIndexOf("/"))
  const name = folder.slice(folder.lastIndexOf("/") + 1)
  await nasCreateFolder(sid, parent, name, true)
  return folder
}
