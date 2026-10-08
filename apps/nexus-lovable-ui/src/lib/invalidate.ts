import type { QueryClient } from "@tanstack/react-query";

/**
 * Projects, folders and pins are cached under TWO query namespaces: the Mission Control page uses
 * bare keys (`["projects"]`, `["project-folders", wsId]`, `["project-pins"]`) while the sidebar uses
 * `["nexus", ...]` variants. A create/move/rename/delete on one surface MUST refresh both, otherwise
 * the other one stays stale until a hard page reload (the "I have to refresh to see my new folder" bug).
 *
 * We invalidate by predicate so any query key that mentions these collections — in either namespace —
 * refetches, and new query keys are covered automatically.
 */
export function invalidateProjectData(qc: QueryClient) {
  qc.invalidateQueries({
    predicate: (q) =>
      q.queryKey.some(
        (seg) =>
          seg === "projects" ||
          seg === "project-folders" ||
          seg === "project-pins" ||
          seg === "folder-pins",
      ),
  });
}

/** Key segments of every query that lists projects or folders, in either namespace (see above). */
const PROJECT_TREE_SEGMENTS = new Set(["projects", "project-folders", "project-pins", "folder-pins", "ws-projects"]);

/** The project a key is the header/detail or member list of: ["nexus","project",id], ["nexus","project-members",id], ["project-members",id]. */
function projectIdOfKey(key: readonly unknown[]): unknown {
  if (key.length === 3 && key[0] === "nexus" && (key[1] === "project" || key[1] === "project-members")) return key[2];
  if (key.length === 2 && key[0] === "project-members") return key[1];
  return undefined;
}

/**
 * A realtime `workspace-changed` ping (lib/realtime.tsx), or a reconnect that may have missed some.
 *
 * Refetches what draws the project tree: the sidebar (projects, folders, both pin lists), Mission
 * Control (`["projects"]`, `["project-folders", ws]`), folder pages, the project pickers, the Forms
 * page's per-workspace list and the Master Calendar's project → division structure. Plus the header/
 * detail and member list of the projects named, and only those: a project's detail carries its whole
 * board, so a folder rename must not refetch every board in the cache. `"all"` is for the reconnect.
 *
 * Exact segment matches, not the substring terms realtime.tsx uses for task events: a "project" term
 * would also sweep up `project-sheets`, whose refetch mid-edit loses what the user is typing.
 * Inactive queries are only marked stale, so this costs requests only for what is on screen.
 */
export function invalidateProjectViews(qc: QueryClient, projectIds: ReadonlySet<string> | "all") {
  qc.invalidateQueries({
    predicate: ({ queryKey }) => {
      if (queryKey.some((seg) => typeof seg === "string" && PROJECT_TREE_SEGMENTS.has(seg))) return true;
      if (queryKey.length === 3 && queryKey[0] === "nexus" && queryKey[1] === "calendar-tasks" && queryKey[2] === "structure") return true;
      const id = projectIdOfKey(queryKey);
      return typeof id === "string" && (projectIds === "all" || projectIds.has(id));
    },
  });
}

/**
 * A realtime `audit-changed` ping: Control Room → Audit's list (`["nexus","audit",search,action]`) and
 * the open entry drawer (`["nexus","audit-entry",id]`). The drawer's 60 s staleTime does not hold this
 * back: invalidating refetches every query on screen regardless of it, which is what flips its Restore
 * block to "Restored by …" when someone else restores the entry.
 */
export function invalidateAuditViews(qc: QueryClient) {
  qc.invalidateQueries({
    predicate: ({ queryKey }) => queryKey[0] === "nexus" && (queryKey[1] === "audit" || queryKey[1] === "audit-entry"),
  });
}
