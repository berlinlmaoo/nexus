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
import { FolderPlus, Pencil, FolderInput, FolderOutput, Pin, PinOff, Trash2, Maximize2 } from "lucide-react";
import type { NexusProject, NexusProjectFolder } from "@/lib/nexus-api";
import { folderPath, descendantFolderIds } from "@/lib/folder-tree-client";
import { ProjectIcon } from "@/components/projects/ProjectIcon";

export type SidebarActions = {
  folders: NexusProjectFolder[];
  isPinned: (projectId: string) => boolean;
  isPinnedFolder: (folderId: string) => boolean;
  renameProject: (p: NexusProject) => void;
  moveProject: (projectId: string, folderId: string | null) => void;
  removeProject: (p: NexusProject) => void;
  togglePin: (projectId: string) => void;
  toggleFolderPin: (folderId: string) => void;
  openFolderView: (folderId: string) => void;
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
        <ContextMenuItem disabled>(no other folders)</ContextMenuItem>
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
          <ContextMenuSubTrigger><FolderInput className="mr-2 h-3.5 w-3.5" /> Move to folder</ContextMenuSubTrigger>
          <MoveTargets
            folders={actions.folders}
            currentFolderId={project.folderId ?? null}
            onPick={(fid) => actions.moveProject(project.id, fid)}
            rootLabel="Remove from folder"
          />
        </ContextMenuSub>
        <ContextMenuItem onClick={() => actions.togglePin(project.id)}>
          {pinned ? <PinOff className="mr-2 h-3.5 w-3.5" /> : <Pin className="mr-2 h-3.5 w-3.5" />}
          {pinned ? "Unpin" : "Pin to top"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => actions.removeProject(project)}>
          <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete project
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
        <ContextMenuLabel className="flex items-center gap-1.5 truncate">
          <span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded text-xs">
            <ProjectIcon icon={folder.icon || "📁"} className="max-h-4 max-w-4 rounded object-cover" />
          </span>
          <span className="truncate">{folder.name}</span>
        </ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => actions.openFolderView(folder.id)}>
          <Maximize2 className="mr-2 h-3.5 w-3.5" /> Open folder view
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.createSubfolder(folder)}>
          <FolderPlus className="mr-2 h-3.5 w-3.5" /> New subfolder
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.renameFolder(folder)}>
          <Pencil className="mr-2 h-3.5 w-3.5" /> Rename folder
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger><FolderInput className="mr-2 h-3.5 w-3.5" /> Move folder to</ContextMenuSubTrigger>
          <MoveTargets
            folders={actions.folders}
            currentFolderId={folder.parentFolderId ?? null}
            excludeIds={exclude}
            onPick={(fid) => actions.moveFolder(folder.id, fid)}
            rootLabel="To the top (root)"
          />
        </ContextMenuSub>
        <ContextMenuItem onClick={() => actions.toggleFolderPin(folder.id)}>
          {actions.isPinnedFolder(folder.id) ? <PinOff className="mr-2 h-3.5 w-3.5" /> : <Pin className="mr-2 h-3.5 w-3.5" />}
          {actions.isPinnedFolder(folder.id) ? "Unpin folder" : "Pin folder to top"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => actions.removeFolder(folder)}>
          <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
