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
