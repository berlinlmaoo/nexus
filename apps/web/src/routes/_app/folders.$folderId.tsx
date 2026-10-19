import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /folders/<id> — kept for links already out there (bookmarks, old notifications, the apps). A folder no
 * longer has a calendar of its own: there is ONE calendar (owner, 18 Oct 2026), so this opens /calendar
 * filtered to the folder (every project in it and its subfolders the viewer can see). Replaces the history
 * entry, so Back skips it. Links inside the app go to /calendar?folder= directly.
 */
export const Route = createFileRoute("/_app/folders/$folderId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/calendar", search: { folder: params.folderId }, replace: true });
  },
});
