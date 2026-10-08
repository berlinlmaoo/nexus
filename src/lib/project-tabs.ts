/**
 * Project types and per-project tabs (owner, 9 Oct 2026).
 *
 * "tiap kali buat project tuh ada dikasih pilihan ada Task Project, Finance Dashboard, Content Planner,
 * Pipeline Dashboard" — every project has a type. Only TASK exists today; the other three are shown as
 * "coming soon" and creating one is refused with 400 TYPE_COMING_SOON, so a client that offers them
 * early cannot make a half-built project.
 *
 * "ada bbrp project yg ga butuh spreadsheets/automation/list" — each project chooses which tabs it
 * shows. The project stores the keys it HIDES (Project.hiddenTabs), not the ones it shows: a tab added
 * later then appears on every existing project without a backfill. Hiding is presentational only;
 * nothing a tab holds is deleted or locked, and its API keeps working.
 *
 * Finance and P&L are not in this list. Each is an opt-in flag of its own (financeEnabled,
 * enablePnlDashboard), off by default, because they hold money data and are switched on by BoD.
 *
 * The same keys are used by web (apps/nexus-lovable-ui) and iOS (ProjectTab.key). A client must ignore
 * a key it does not know, so this list can grow without breaking an older app.
 */

export const PROJECT_TYPES = ["TASK", "FINANCE", "CONTENT", "PIPELINE"] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

/** The types that can be created today. The rest answer TYPE_COMING_SOON. */
export const CREATABLE_PROJECT_TYPES: readonly ProjectType[] = ["TASK"]

/** Every tab a project can hide, in tab-bar order. "table" exists on web only; iOS ignores it. */
export const PROJECT_TAB_KEYS = [
  "overview",
  "board",
  "list",
  "table",
  "sheet",
  "calendar",
  "timeline",
  "sprints",
  "automations",
  "pages",
  "forms",
  "chat",
] as const
export type ProjectTabKey = (typeof PROJECT_TAB_KEYS)[number]

/** A project must keep at least one of these visible: it is still a task project. */
export const TASK_VIEW_TAB_KEYS: readonly ProjectTabKey[] = ["board", "list"]

export type ProjectTypeCheck =
  | { ok: true; type: ProjectType }
  | { ok: false; code: "TYPE_COMING_SOON"; error: string }

/** POST /api/projects: no type (every client before 9 Oct 2026) is a Task Project. */
export function checkCreatableProjectType(raw: unknown): ProjectTypeCheck {
  if (raw === undefined || raw === null || raw === "") return { ok: true, type: "TASK" }
  if (typeof raw === "string" && (CREATABLE_PROJECT_TYPES as readonly string[]).includes(raw)) {
    return { ok: true, type: raw as ProjectType }
  }
  return {
    ok: false,
    code: "TYPE_COMING_SOON",
    error: "Tipe project ini belum tersedia. Untuk sekarang hanya Task Project yang bisa dibuat.",
  }
}

export type HiddenTabsCheck =
  | { ok: true; hiddenTabs: ProjectTabKey[] }
  | { ok: false; code: "INVALID_TABS" | "UNKNOWN_TAB" | "TASK_VIEW_REQUIRED"; error: string; tab?: string }

/**
 * PATCH /api/projects/:id { hiddenTabs }. The whole set is sent each time (the settings screen holds
 * it). Duplicates are dropped and the result is stored in tab-bar order, so two clients that hide the
 * same tabs store the same array.
 */
export function normalizeHiddenTabs(raw: unknown): HiddenTabsCheck {
  if (!Array.isArray(raw) || raw.some((k) => typeof k !== "string")) {
    return { ok: false, code: "INVALID_TABS", error: "hiddenTabs harus berupa daftar nama tab." }
  }
  const known = new Set<string>(PROJECT_TAB_KEYS)
  const unknown = (raw as string[]).find((k) => !known.has(k))
  if (unknown !== undefined) {
    return { ok: false, code: "UNKNOWN_TAB", error: `Tab "${unknown}" tidak dikenal.`, tab: unknown }
  }
  const hidden = new Set(raw as string[])
  if (TASK_VIEW_TAB_KEYS.every((k) => hidden.has(k))) {
    return {
      ok: false,
      code: "TASK_VIEW_REQUIRED",
      error: "Board atau List harus tetap tampil — minimal satu tampilan task.",
    }
  }
  return { ok: true, hiddenTabs: PROJECT_TAB_KEYS.filter((k) => hidden.has(k)) }
}
