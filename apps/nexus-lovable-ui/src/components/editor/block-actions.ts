import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { ctxOf, randomId } from "./editor-context";

/** The block menu's actions, on a top-level block at `pos` (what the drag handle points at). */

export type TurnTarget = "paragraph" | "h1" | "h2" | "h3" | "bullet" | "numbered" | "todo" | "toggle" | "quote" | "callout" | "code";

export const TURN_TARGETS: Array<{ id: TurnTarget; label: string }> = [
  { id: "paragraph", label: "Text" },
  { id: "h1", label: "Heading 1" },
  { id: "h2", label: "Heading 2" },
  { id: "h3", label: "Heading 3" },
  { id: "bullet", label: "Bulleted list" },
  { id: "numbered", label: "Numbered list" },
  { id: "todo", label: "To-do list" },
  { id: "toggle", label: "Toggle list" },
  { id: "quote", label: "Quote" },
  { id: "callout", label: "Callout" },
  { id: "code", label: "Code" },
];

/** Notion's colour names. `<name>` colours the text, `<name>_bg` the background. */
export const BLOCK_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;

export function blockAt(editor: Editor, pos: number): PMNode | null {
  const node = editor.state.doc.nodeAt(pos);
  return node ?? null;
}

/** The top-level block holding the selection: its position (for keyboard shortcuts and the mobile toolbar). */
export function currentBlockPos(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  if ($from.depth === 0) {
    const node = editor.state.selection.$from.nodeAfter;
    return node ? $from.pos : null;
  }
  return $from.before(1);
}

export function typeLabel(node: PMNode): string {
  switch (node.type.name) {
    case "paragraph": return "Text";
    case "heading": return `Heading ${node.attrs.level}`;
    case "bulletList": return "Bulleted list";
    case "orderedList": return "Numbered list";
    case "taskList": return "To-do list";
    case "details": return "Toggle list";
    case "blockquote": return "Quote";
    case "callout": return "Callout";
    case "codeBlock": return "Code";
    case "table": return "Table";
    case "image": return "Image";
    case "fileBlock": return "File";
    case "bookmark": return node.attrs.embed ? "Embed" : "Bookmark";
    case "horizontalRule": return "Divider";
    default: return "Block";
  }
}

export function canTurn(node: PMNode): boolean {
  return !node.isAtom && node.type.name !== "table";
}

export function turnInto(editor: Editor, pos: number, target: TurnTarget) {
  const node = blockAt(editor, pos);
  if (!node || !canTurn(node)) return;
  let chain = editor.chain().focus().setTextSelection({ from: pos + 1, to: Math.max(pos + 1, pos + node.nodeSize - 1) });
  chain = node.type.name === "details" ? chain.unsetDetails() : chain.clearNodes();
  switch (target) {
    case "paragraph": break;
    case "h1": chain = chain.setNode("heading", { level: 1 }); break;
    case "h2": chain = chain.setNode("heading", { level: 2 }); break;
    case "h3": chain = chain.setNode("heading", { level: 3 }); break;
    case "bullet": chain = chain.toggleBulletList(); break;
    case "numbered": chain = chain.toggleOrderedList(); break;
    case "todo": chain = chain.toggleTaskList(); break;
    case "toggle": chain = chain.setDetails(); break;
    case "quote": chain = chain.wrapIn("blockquote"); break;
    case "callout": chain = chain.wrapIn("callout"); break;
    case "code": chain = chain.setCodeBlock(); break;
  }
  chain.run();
}

export function setBlockColor(editor: Editor, pos: number, color: string | null) {
  const node = blockAt(editor, pos);
  if (!node || !("blockColor" in node.attrs)) return;
  editor.chain().command(({ tr }) => {
    tr.setNodeAttribute(pos, "blockColor", color);
    return true;
  }).run();
}

function stripIds(json: JSONContent): JSONContent {
  const out: JSONContent = { ...json };
  if (out.attrs && "blockId" in out.attrs) out.attrs = { ...out.attrs, blockId: null };
  if (out.content) out.content = out.content.map(stripIds);
  return out;
}

export function duplicateBlock(editor: Editor, pos: number) {
  const node = blockAt(editor, pos);
  if (!node) return;
  const at = pos + node.nodeSize;
  editor.chain().focus().insertContentAt(at, stripIds(node.toJSON() as JSONContent)).setTextSelection(Math.min(at + 1, editor.state.doc.content.size)).run();
}

export function moveBlock(editor: Editor, pos: number, dir: -1 | 1): boolean {
  const { doc } = editor.state;
  const $pos = doc.resolve(pos);
  const index = $pos.index($pos.depth);
  const parent = $pos.parent;
  const node = parent.child(index);
  const sibling = dir < 0 ? (index > 0 ? parent.child(index - 1) : null) : (index + 1 < parent.childCount ? parent.child(index + 1) : null);
  if (!sibling) return false;
  return editor.chain().command(({ tr }) => {
    tr.delete(pos, pos + node.nodeSize);
    const target = dir < 0 ? pos - sibling.nodeSize : pos + sibling.nodeSize;
    tr.insert(target, node);
    // The cursor moves with the block (Notion), so repeated ⌘⇧↑ keeps moving the same block.
    if (!node.isAtom) tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(target + 1, tr.doc.content.size))));
    return true;
  }).focus().run();
}

export function deleteBlock(editor: Editor, pos: number) {
  const node = blockAt(editor, pos);
  if (!node) return;
  editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
}

/** Gives the block an anchor id (once) and copies `<page>#block-<id>`. */
export async function copyBlockLink(editor: Editor, pos: number): Promise<string | null> {
  const node = blockAt(editor, pos);
  if (!node || !("blockId" in node.attrs)) return null;
  let id = node.attrs.blockId as string | null;
  if (!id) {
    id = randomId();
    const set = id;
    editor.chain().command(({ tr }) => { tr.setNodeAttribute(pos, "blockId", set); return true; }).run();
  }
  const base = ctxOf(editor)?.blockLinkBase ?? window.location.pathname;
  const url = `${window.location.origin}${base}#block-${id}`;
  try { await navigator.clipboard.writeText(url); } catch { /* the caller shows the link */ }
  return url;
}

/** Scroll to `#block-<id>` (a copied block link) and flash it. */
export function revealBlockFromHash(root: HTMLElement | null) {
  const m = /^#block-([A-Za-z0-9]+)$/.exec(window.location.hash);
  if (!m || !root) return;
  const el = root.querySelector<HTMLElement>(`[data-block-id="${m[1]}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("nx-flash");
  window.setTimeout(() => el.classList.remove("nx-flash"), 2200);
}
