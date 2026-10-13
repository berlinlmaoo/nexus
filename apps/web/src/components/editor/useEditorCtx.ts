import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { nexusApi } from "@/lib/nexus-api";
import { t } from "@/lib/lang";
import type { EditorCtx } from "./editor-context";

/** The page context every block editor needs: who I am, where uploads go, what block links point at. */
export function useEditorCtx(projectId: string | null | undefined, blockLinkBase: string, openTask?: (taskId: string) => void): EditorCtx {
  const profile = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 60_000 });
  const u = profile.data?.user;
  return useMemo<EditorCtx>(() => ({
    projectId: projectId ?? null,
    me: u?.id ? { id: u.id, name: u.name ?? "", avatar: (u as { avatar?: string | null }).avatar ?? null } : null,
    upload: async (file, onProgress) => {
      if (!projectId) throw new Error(t("Uploads need a project."));
      const res = await nexusApi.uploadBlockFile(projectId, file, onProgress);
      return { url: res.url, name: res.name ?? file.name, size: res.size ?? file.size, type: res.type ?? file.type };
    },
    blockLinkBase,
    openTask,
  }), [projectId, u?.id, u?.name, u, blockLinkBase, openTask]);
}
