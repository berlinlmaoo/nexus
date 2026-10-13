// ─────────────────────────────────────────────────────────────────────────────
// Drag and drop in the project tree (sidebar + Mission Control), owner 10 Oct 2026: "gabisa drag and
// drop untuk masukin suatu project ke dalam folder". The rules live here; the only React is the one
// shared "what is being dragged" store, so a card dragged on Mission Control can land on a sidebar folder.
//
// Why the old sidebar drag never worked: it set React state inside `dragstart`, which grew the reorder
// slots and the "drop here" banner in the same frame. Chrome and Safari cancel a drag whose source moves
// under the pointer while the drag image is being taken, so `dragend` fired at once. `startTreeDrag`
// therefore defers the state change to the next frame.
// ─────────────────────────────────────────────────────────────────────────────
import { useSyncExternalStore } from "react";
import type { NexusProjectFolder } from "@/lib/nexus-api";
import { canMoveInto, folderDepthOf, MAX_FOLDER_DEPTH } from "@/lib/folder-tree-client";

/** The type a dragged tree row carries; its value is JSON {kind,id,from}. Other drags are ignored. */
export const TREE_DRAG_MIME = "application/x-nexus-project-tree";

/** `from` = the folder the item sits in now (null = no folder / root). */
export type TreeDrag = { kind: "project" | "folder"; id: string; from: string | null };

/** Is this browser drag one of ours? Only the types are readable before the drop. */
export function isTreeDrag(types: ReadonlyArray<string> | DOMStringList | null | undefined): boolean {
  if (!types) return false;
  return Array.from(types as ArrayLike<string>).includes(TREE_DRAG_MIME);
}

/**
 * Start a drag: fills dataTransfer now (it is only writable inside dragstart) and hands the drag to
 * React on the next frame, so the row is not re-laid-out while the browser takes its picture.
 */
export function startTreeDrag(e: { dataTransfer: DataTransfer | null; stopPropagation: () => void }, drag: TreeDrag, onStart: (d: TreeDrag) => void = setTreeDrag) {
  e.stopPropagation();
  try {
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(TREE_DRAG_MIME, JSON.stringify(drag));
      // Firefox will not start a drag without some data of a common type.
      e.dataTransfer.setData("text/plain", drag.id);
    }
  } catch { /* some browsers refuse custom types; the in-memory drag still works */ }
  const token = ++dragToken;
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f: () => void) => setTimeout(f, 0);
  // A drag the browser cancelled at once has already ended by the next frame: don't revive it.
  raf(() => { if (token === dragToken) onStart(drag); });
}

/** End the drag (dragend or drop), including one whose start is still waiting for its frame. */
export function endTreeDrag() {
  dragToken++;
  setTreeDrag(null);
}

/**
 * May `drag` be dropped INTO `target` (null = out of every folder)? Not where it already is; a folder
 * not into itself or below itself, and never deeper than MAX_FOLDER_DEPTH (the server checks again).
 */
export function canDropInto(drag: TreeDrag | null, target: string | null, folders: NexusProjectFolder[]): boolean {
  if (!drag) return false;
  if (drag.from === target) return false;
  return canMoveInto(drag, target, folders);
}

/** Can one more folder level go under `parentId`? (null = a new root folder, always.) */
export function canAddSubfolder(parentId: string | null, folders: NexusProjectFolder[]): boolean {
  if (parentId === null) return true;
  return folderDepthOf(parentId, new Map(folders.map((f) => [f.id, f]))) < MAX_FOLDER_DEPTH;
}

// ── The drag in progress, shared by every surface that shows the tree ──
let dragToken = 0;
let current: TreeDrag | null = null;
const listeners = new Set<() => void>();
export function setTreeDrag(d: TreeDrag | null) {
  if (current === d) return;
  current = d;
  listeners.forEach((f) => f());
}
export function getTreeDrag(): TreeDrag | null {
  return current;
}
/** The row being dragged right now (null when nothing is). Re-renders on start and end. */
export function useTreeDrag(): TreeDrag | null {
  return useSyncExternalStore(
    (f) => { listeners.add(f); return () => { listeners.delete(f); }; },
    () => current,
    () => null,
  );
}
/** The drag from a drop event: ours from memory, else from its data (a drag that began elsewhere). */
export function dragFromDrop(dt: DataTransfer | null): TreeDrag | null {
  if (current) return current;
  try {
    const raw = dt?.getData(TREE_DRAG_MIME);
    if (!raw) return null;
    const d = JSON.parse(raw) as TreeDrag;
    return d && (d.kind === "project" || d.kind === "folder") && typeof d.id === "string" ? { kind: d.kind, id: d.id, from: d.from ?? null } : null;
  } catch {
    return null;
  }
}
