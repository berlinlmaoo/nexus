import type { NexusProject } from "@/lib/nexus-api";

/**
 * Per-project tabs and project types (owner, 9 Oct 2026). The server's rules are in
 * src/lib/project-tabs.ts of the Next app; these keys must match them, and iOS uses the same ones.
 *
 * A project stores the tabs it HIDES. Hiding only hides: nothing in the tab is deleted, its API keeps
 * working, and switching it back on brings everything back. Finance and P&L are not hideable tabs —
 * each has its own opt-in flag (financeEnabled, enablePnlDashboard), BoD and above.
 */
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
] as const;
export type ProjectTabKey = (typeof PROJECT_TAB_KEYS)[number];

/** English names, as the project's tab bar shows them (translated with t()). */
export const PROJECT_TAB_LABELS: Record<ProjectTabKey, string> = {
  overview: "Overview",
  board: "Board",
  list: "List",
  table: "Table",
  sheet: "Spreadsheet",
  calendar: "Calendar",
  timeline: "Timeline",
  sprints: "Sprints",
  automations: "Automations",
  pages: "Pages",
  forms: "Forms",
  chat: "Chat",
};

/** At least one of these stays visible (the server answers 400 TASK_VIEW_REQUIRED otherwise). */
export const TASK_VIEW_TAB_KEYS: readonly ProjectTabKey[] = ["board", "list"];

export function hiddenTabsOf(project?: Pick<NexusProject, "hiddenTabs"> | null): Set<string> {
  return new Set(Array.isArray(project?.hiddenTabs) ? project.hiddenTabs : []);
}

/**
 * The Finance tab is opt-in like P&L. A server from before 9 Oct 2026 does not send the flag; then
 * the old rule (the project's name contains "finance") still applies, so deploying the SPA first
 * changes nothing.
 */
export function financeTabEnabled(project?: Pick<NexusProject, "financeEnabled" | "name"> | null): boolean {
  if (!project) return false;
  if (typeof project.financeEnabled === "boolean") return project.financeEnabled;
  return /finance/i.test(project.name ?? "");
}

/** Project types offered when creating a project. Only TASK can be created today. */
export const PROJECT_TYPES = [
  { id: "TASK", available: true },
  { id: "FINANCE", available: false },
  { id: "CONTENT", available: false },
  { id: "PIPELINE", available: false },
] as const;
export type ProjectTypeId = (typeof PROJECT_TYPES)[number]["id"];

/** English text for a refusal code from PATCH/POST /api/projects (translated with t()). */
export function projectSettingsErrorText(code: unknown): string | null {
  switch (code) {
    case "TASK_VIEW_REQUIRED":
      return "Board or List has to stay on — at least one way to see the tasks.";
    case "UNKNOWN_TAB":
    case "INVALID_TABS":
      return "That tab can't be changed here. Refresh the page and try again.";
    case "BOD_REQUIRED":
      return "Only BoD and above can turn Finance on or off.";
    case "TYPE_COMING_SOON":
      return "That project type is coming soon. For now you can create a Task Project.";
    default:
      return null;
  }
}
