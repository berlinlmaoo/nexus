/**
 * `aggregateProjectIds` in PATCH /api/project-folders/{id}: the curated project subset a folder's
 * aggregate view shows (iOS FolderAggregateView "Pick projects", web /folders/$folderId). `[]` means
 * "every project in the folder" — both clients send `[]` when everything is picked, so the folder
 * keeps including projects added later.
 *
 * Pure: no imports, so `node src/lib/folder-aggregate.test.mjs` can load it directly.
 */

/** Upper bound on the ids kept; far above any real folder, it only stops an absurd body. */
export const MAX_AGGREGATE_PROJECT_IDS = 500

/**
 * The ids to consider, de-duplicated, trimmed, in the order sent — or null when the value is not a
 * list of strings (null is read as "reset", i.e. []). Whether each id is a project of the folder's
 * workspace is the route's job (it needs the database).
 */
export function normalizeAggregateProjectIds(raw: unknown): string[] | null {
  if (raw === null) return []
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of raw) {
    if (typeof value !== "string") return null
    const id = value.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_AGGREGATE_PROJECT_IDS) break
  }
  return out
}
