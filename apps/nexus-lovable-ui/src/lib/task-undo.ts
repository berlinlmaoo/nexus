import { toast } from "sonner";
import { t } from "@/lib/lang";

/**
 * Undo for task edits in the project views (bug hunt C-BUG-16, 12 Oct 2026): a drag, a bulk move/edit, a
 * bulk duplicate or delete, a done-toggle. Each action shows a toast with Undo and goes on a small stack
 * that Ctrl/⌘+Z pops (TaskBulkProvider listens). One entry = one user action, however many tasks it touched.
 */
type Entry = { id: number; label: string; run: () => Promise<unknown> | void; at: number; toastId: string | number };

const MAX = 20;
const TTL_MS = 30 * 60 * 1000; // the server's own undo window for deletes
let seq = 0;
const stack: Entry[] = [];

async function runEntry(e: Entry) {
  const i = stack.indexOf(e);
  if (i === -1) return; // already undone (toast button and Ctrl+Z both)
  stack.splice(i, 1);
  toast.dismiss(e.toastId);
  try {
    await e.run();
  } catch (err) {
    toast.error(t("Couldn't undo"), { description: friendlyError(err) });
  }
}

/** Show `label` with an Undo button and remember it for Ctrl/⌘+Z. */
export function pushUndo(label: string, run: () => Promise<unknown> | void, opts: { duration?: number } = {}) {
  const e: Entry = { id: ++seq, label, run, at: Date.now(), toastId: `undo-${seq}` };
  stack.push(e);
  if (stack.length > MAX) stack.shift();
  toast(label, { id: e.toastId, duration: opts.duration ?? 10000, action: { label: t("Undo"), onClick: () => void runEntry(e) } });
}

/** Ctrl/⌘+Z: undo the latest action still in reach. True when there was one. */
export function undoLast(): boolean {
  while (stack.length && Date.now() - stack[stack.length - 1].at > TTL_MS) stack.pop();
  const e = stack[stack.length - 1];
  if (!e) return false;
  void runEntry(e).then(() => toast.success(t("Undone: {action}", { action: e.label })));
  return true;
}

/**
 * The text of a failed request, readable: "Failed to fetch" / NetworkError (offline, a blip) becomes
 * "No connection…" in the person's language instead of the browser's raw English (C-BUG-27).
 */
export function friendlyError(e: unknown): string | undefined {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!msg) return undefined;
  if (/failed to fetch|networkerror|network request failed|load failed|err_internet|fetch failed/i.test(msg) || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    return t("No connection. Check your internet and try again.");
  }
  // A server failure is not something to show raw ("Internal server error", QA R2 Manager B31).
  const status = (e as { status?: number } | null)?.status;
  if ((typeof status === "number" && status >= 500) || /^(internal server error|request failed|bad gateway|service unavailable)/i.test(msg)) {
    return t("Something went wrong on our side. Try again in a moment.");
  }
  // Access-level refusals (Notion levels, 13 Oct 2026), and the old role wording older servers still send.
  const code = (e as { payload?: { code?: string } } | null)?.payload?.code;
  if (code === "LAST_OWNER") return t("A project keeps at least one Project Owner. Give someone else Full access first.");
  if (code === "NEEDS_EDIT_ACCESS" || /Can edit access|MEMBER role/i.test(msg)) return t("You can view this project but not change it. Ask its Project Owner for Can edit access.");
  if (code === "NEEDS_COMMENT_ACCESS") return t("You can view this project but not comment. Ask its Project Owner for Can comment access.");
  if (code === "NEEDS_FULL_ACCESS" || /Full access|LEAD role/i.test(msg)) return t("Only people with Full access to the project can do this.");
  return msg;
}
