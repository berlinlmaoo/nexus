import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuLabel,
} from "@/components/ui/context-menu";
import { FolderPlus, Pencil, FolderInput, FolderOutput, Pin, PinOff, Trash2 } from "lucide-react";
import type { NexusProject, NexusProjectFolder } from "@/lib/nexus-api";
import { folderPath, descendantFolderIds } from "@/lib/folder-tree-client";

export type SidebarActions = {
  folders: NexusProjectFolder[];
  isPinned: (projectId: string) => boolean;
  renameProject: (p: NexusProject) => void;
  moveProject: (projectId: string, folderId: string | null) => void;
  removeProject: (p: NexusProject) => void;
  togglePin: (projectId: string) => void;
  createSubfolder: (parent: NexusProjectFolder | null) => void;
  renameFolder: (f: NexusProjectFolder) => void;
  moveFolder: (folderId: string, parentFolderId: string | null) => void;
  removeFolder: (f: NexusProjectFolder) => void;
};

function MoveTargets({ folders, currentFolderId, excludeIds, onPick, rootLabel }: {
  folders: NexusProjectFolder[];
  currentFolderId: string | null;
  excludeIds?: Set<string>;
  onPick: (folderId: string | null) => void;
  rootLabel: string;
}) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const targets = folders
    .filter((f) => !excludeIds?.has(f.id))
    .map((f) => ({ id: f.id, path: folderPath(f, byId) }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
  return (
    <ContextMenuSubContent className="max-h-72 w-56 overflow-y-auto">
      <ContextMenuItem disabled={currentFolderId === null} onClick={() => onPick(null)}>
        <FolderOutput className="mr-2 h-3.5 w-3.5 shrink-0" /> {rootLabel}
      </ContextMenuItem>
      <ContextMenuSeparator />
      {targets.length === 0 ? (
        <ContextMenuItem disabled>(tidak ada folder lain)</ContextMenuItem>
      ) : (
        targets.map((t) => (
          <ContextMenuItem key={t.id} disabled={t.id === currentFolderId} onClick={() => onPick(t.id)}>
            <FolderInput className="mr-2 h-3.5 w-3.5 shrink-0" /> <span className="truncate">{t.path}</span>
          </ContextMenuItem>
        ))
      )}
    </ContextMenuSubContent>
  );
}

export function ProjectRowMenu({ project, actions, children }: { project: NexusProject; actions: SidebarActions; children: ReactNode }) {
  const pinned = actions.isPinned(project.id);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuLabel className="truncate">{project.name}</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => actions.renameProject(project)}>
          <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger><FolderInput className="mr-2 h-3.5 w-3.5" /> Pindah ke folder</ContextMenuSubTrigger>
          <MoveTargets
            folders={actions.folders}
            currentFolderId={project.folderId ?? null}
            onPick={(fid) => actions.moveProject(project.id, fid)}
            rootLabel="Keluarkan dari folder"
          />
        </ContextMenuSub>
        <ContextMenuItem onClick={() => actions.togglePin(project.id)}>
          {pinned ? <PinOff className="mr-2 h-3.5 w-3.5" /> : <Pin className="mr-2 h-3.5 w-3.5" />}
          {pinned ? "Lepas pin" : "Pin ke atas"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => actions.removeProject(project)}>
          <Trash2 className="mr-2 h-3.5 w-3.5" /> Hapus project
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function FolderRowMenu({ folder, actions, children }: { folder: NexusProjectFolder; actions: SidebarActions; children: ReactNode }) {
  const exclude = descendantFolderIds(folder.id, actions.folders);
  exclude.add(folder.id); // can't move a folder into itself or its own subtree
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuLabel className="truncate">{folder.icon || "📁"} {folder.name}</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => actions.createSubfolder(folder)}>
          <FolderPlus className="mr-2 h-3.5 w-3.5" /> Subfolder baru
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.renameFolder(folder)}>
          <Pencil className="mr-2 h-3.5 w-3.5" /> Rename folder
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger><FolderInput className="mr-2 h-3.5 w-3.5" /> Pindah folder ke</ContextMenuSubTrigger>
          <MoveTargets
            folders={actions.folders}
            currentFolderId={folder.parentFolderId ?? null}
            excludeIds={exclude}
            onPick={(fid) => actions.moveFolder(folder.id, fid)}
            rootLabel="Ke paling atas (root)"
          />
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => actions.removeFolder(folder)}>
          <Trash2 className="mr-2 h-3.5 w-3.5" /> Hapus folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
