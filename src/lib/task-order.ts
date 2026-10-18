/**
 * One order for tasks everywhere (race audit 16 Oct 2026, PR 7 "a consistent tiebreak"). Positions tie — every
 * task the apps create is position 0, and two writers can still land on one number — and the readers broke the
 * tie differently: the project board by createdAt ASC, GET /api/tasks by createdAt DESC, subtasks and linked
 * placements not at all (Postgres then returns ties in whatever order the last write left). The same column
 * showed in a different order on different screens and cards jumped after unrelated writes. Every reader of a
 * section's or a parent's tasks uses this order, and POST /api/tasks/reorder rewrites positions from it.
 */
export const TASK_ORDER = [{ position: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }]

/** Sections (TaskList) and linked placements: position, then id. */
export const POSITION_ID_ORDER = [{ position: "asc" as const }, { id: "asc" as const }]
