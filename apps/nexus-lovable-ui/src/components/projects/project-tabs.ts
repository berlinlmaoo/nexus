import type { NexusProject } from "@/lib/nexus-api";

/**
 * Per-project tabs and project types (owner, 9 Oct 2026). The server's rules are in
 * src/lib/project-tabs.ts of the Next app; these keys must match them, and iOS uses the same ones.
 *
 * A project stores the tabs it HIDES. Hiding only hides: nothing in the tab is deleted, its API keeps
 * working, and switching it back on brings everything back. The Finance and P&L tabs were retired on
 * 11 Oct 2026 (financeEnabled / enablePnlDashboard always read false).
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
 * Project types offered when creating a project. TASK; since 9 Oct 2026 PIPELINE (the GM's pipeline board —
 * components/pipeline); since 10 Oct 2026 OUTLET_SALES (owner, for Ryan: one project per outlet —
 * components/outlet-sales), in the place the Finance Dashboard card had. Content Planner waits for
 * Berlin's references.
 */
export const PROJECT_TYPES = [
  { id: "TASK", available: true },
  { id: "OUTLET_SALES", available: true },
  { id: "CONTENT", available: false },
  { id: "PIPELINE", available: true },
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
    case "TYPE_COMING_SOON":
      return "That project type is coming soon. For now you can create a Task Project, a Pipeline Dashboard or an Outlet Sales Dashboard.";
    // The company's one pipeline (owner/GM, 9 Oct 2026). PIPELINE_EXISTS opens the board when the answer
    // names it; without a projectId the person is not one of its members (owner, 9 Oct 2026 evening:
    // the board's lead adds people, like any project).
    case "PIPELINE_COMPANY_ONLY":
      return "The Pipeline Dashboard lives in the company workspace only.";
    case "PIPELINE_EXISTS":
      return "The company's pipeline already exists. Ask its project lead to add you.";
    default:
      return null;
  }
}
