import type { Editor } from "@tiptap/core";

/** What the editor's node views and menus need from the page they sit on. */
export type EditorCtx = {
  /** Uploads (images, files, covers) go to this project's storage. */
  projectId: string | null;
  me: { id: string; name: string; avatar?: string | null } | null;
  upload: (file: File, onProgress?: (pct: number) => void) => Promise<{ url: string; name: string; size: number; type: string }>;
  /** Path that "Copy link to block" appends `#block-<id>` to. */
  blockLinkBase: string;
  /** Open a mentioned task (the task popup); a plain link is used when absent. */
  openTask?: (taskId: string) => void;
};

export function ctxOf(editor: Editor | null | undefined): EditorCtx | null {
  const storage = (editor?.storage as unknown as { nexus?: { ctx: EditorCtx | null } } | undefined)?.nexus;
  return storage?.ctx ?? null;
}

/** Today in Asia/Jakarta as YYYY-MM-DD (+ days). */
export function jakartaDate(addDays = 0): string {
  const d = new Date(Date.now() + addDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}
