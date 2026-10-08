// ─────────────────────────────────────────────────────────────────────────────
// Z Vault drag and drop on the web (owner, 9 Oct 2026): files from the desktop upload where they are
// dropped, and an item dragged onto a folder or a crumb of the path moves there. The rules live here,
// with no React, so they can be run outside the page (a browser harness does).
// ─────────────────────────────────────────────────────────────────────────────

/** The type a dragged vault item carries; its value is the item's id. Desktop files carry "Files". */
export const VAULT_ITEM_MIME = "application/x-nexus-vault-item";

export type VaultDragKind = "files" | "item" | null;

/** What is being dragged, from the types alone — the data itself is only readable on drop. */
export function dragKind(types: ReadonlyArray<string> | DOMStringList | null | undefined): VaultDragKind {
  if (!types) return null;
  const list = Array.from(types as ArrayLike<string>);
  if (list.includes(VAULT_ITEM_MIME)) return "item";
  if (list.includes("Files")) return "files";
  return null;
}

export type DraggedVaultItem = { id: string; kind: "FOLDER" | "FILE"; parentId: string | null; name: string };

export type MoveCheck = "ok" | "self" | "same" | "descendant";

/**
 * May `dragged` go into `targetId` (null = the top of the vault)? `targetTrail`: the folders above the
 * target, top first, as far as the page knows them. The server checks all of it again and has the
 * last word; this only stops a drop the page can already tell is pointless or impossible.
 */
export function canMoveInto(dragged: DraggedVaultItem, targetId: string | null, targetTrail: ReadonlyArray<string>): MoveCheck {
  if (dragged.id === targetId) return "self";
  if (dragged.parentId === targetId) return "same";
  if (dragged.kind === "FOLDER" && targetTrail.includes(dragged.id)) return "descendant";
  return "ok";
}

type EntryLike = { isDirectory?: boolean; name?: string } | null;
type ItemLike = { kind: string; getAsFile(): File | null; webkitGetAsEntry?: () => EntryLike };
type DropLike = { items?: ArrayLike<ItemLike> | null; files?: ArrayLike<File> | null };

/**
 * The files of a drop, and the names of the folders in it, which are set aside: reading a dropped
 * folder's contents is a different API in every browser, and uploading half a folder would be worse
 * than saying so. Must be called inside the drop event — the browser empties the list afterwards.
 */
export function filesOfDrop(dt: DropLike): { files: File[]; folders: string[] } {
  const files: File[] = [];
  const folders: string[] = [];
  const items = dt.items ? Array.from(dt.items) : [];
  if (items.length > 0 && items.some((it) => typeof it.webkitGetAsEntry === "function")) {
    for (const it of items) {
      if (it.kind !== "file") continue;
      const entry = it.webkitGetAsEntry?.() ?? null;
      const file = it.getAsFile();
      if (entry?.isDirectory) {
        folders.push(entry.name || file?.name || "");
        continue;
      }
      if (file) files.push(file);
    }
    return { files, folders };
  }
  // No entries API: a folder shows up as a size-0 file without a type, which no upload can use.
  for (const f of dt.files ? Array.from(dt.files) : []) {
    if (f.size === 0 && !f.type && !/\.[^.]+$/.test(f.name)) folders.push(f.name);
    else files.push(f);
  }
  return { files, folders };
}

/** The key of a drop target, so one piece of state can say which one is lit. */
export const dropKey = {
  folder: (id: string) => `folder:${id}`,
  crumb: (id: string | null) => `crumb:${id ?? ""}`,
};
