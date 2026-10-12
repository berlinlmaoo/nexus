import { createContext, useContext } from "react";
import type { ProjectAccessLevel } from "@/lib/nexus-api";

/**
 * The viewer's level in the project on screen (GET /api/projects/:id viewerAccessLevel), for the views deep in
 * the tree: "+ New task", "Add task", "Add page" and the task popup's editing controls show only from Can edit
 * (QA round 2, N-02). Undefined (an older server, or outside a project) = allowed, as before.
 */
export const ProjectAccessContext = createContext<ProjectAccessLevel | undefined>(undefined);

export function canEditLevel(level: ProjectAccessLevel | undefined | null): boolean {
  return !level || level === "FULL" || level === "EDIT";
}

export function useProjectCanEdit(): boolean {
  return canEditLevel(useContext(ProjectAccessContext));
}
