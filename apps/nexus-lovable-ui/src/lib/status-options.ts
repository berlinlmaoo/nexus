/**
 * A project's status options (owner, 12 Oct 2026, Notion's logic). The options ARE the project's sections
 * (board columns): each stands for a task status (TaskList.taskStatus) and so belongs to one of three
 * groups — To-do, In progress, Complete. People add, rename, recolour, reorder and delete options; the
 * five-value enum underneath stays for the released apps (server: src/lib/status-sections.ts).
 */
export type StatusGroupKey = "todo" | "in_progress" | "complete";
export type TaskStatusEnum = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED";

/** English labels; the UI translates them with t(). */
export const STATUS_GROUPS: Array<{ key: StatusGroupKey; label: string; statuses: TaskStatusEnum[] }> = [
  { key: "todo", label: "To-do", statuses: ["TODO"] },
  { key: "in_progress", label: "In progress", statuses: ["IN_PROGRESS", "IN_REVIEW"] },
  { key: "complete", label: "Complete", statuses: ["DONE", "CANCELLED"] },
];

export function statusGroupOf(status: string | null | undefined): StatusGroupKey {
  for (const g of STATUS_GROUPS) if ((g.statuses as string[]).includes(status ?? "")) return g.key;
  return "todo";
}
export function groupIndex(status: string | null | undefined): number {
  return STATUS_GROUPS.findIndex((g) => g.key === statusGroupOf(status));
}

/** The enum a NEW option in a group stands for: "Review" / "Revisi" in progress → IN_REVIEW, "Cancelled" / "Batal" complete → CANCELLED. */
export function statusForNewOption(group: StatusGroupKey, name: string): TaskStatusEnum {
  const n = name.toLowerCase();
  if (group === "in_progress") return /(review|revisi|approval|\bcek\b|check|\bqc\b)/.test(n) ? "IN_REVIEW" : "IN_PROGRESS";
  if (group === "complete") return /(cancel|batal|gagal)/.test(n) ? "CANCELLED" : "DONE";
  return "TODO";
}

export type StatusOption = { id: string; name: string; position?: number | null; taskStatus?: string | null; color?: string | null };

/** Options in display order: by group (To-do, In progress, Complete), then by the project's own order. */
export function orderedOptions<T extends StatusOption>(sections: T[]): T[] {
  return [...sections].sort((a, b) => groupIndex(a.taskStatus) - groupIndex(b.taskStatus) || (a.position ?? 0) - (b.position ?? 0));
}

/** Does the project work with status options (any section bound to a status)? */
export function usesStatusOptions(sections: StatusOption[]): boolean {
  return sections.some((s) => !!s.taskStatus);
}

/** The option a new task starts in: the first To-do option, else the first option. */
export function defaultOption<T extends StatusOption>(sections: T[]): T | undefined {
  const o = orderedOptions(sections);
  return o.find((s) => statusGroupOf(s.taskStatus) === "todo") ?? o[0];
}
