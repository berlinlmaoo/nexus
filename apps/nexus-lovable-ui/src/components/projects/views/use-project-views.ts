import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { nexusApi, type NexusProjectView } from "@/lib/nexus-api";
import { t } from "@/lib/lang";

/**
 * A project's saved views (owner, 12 Oct 2026): the list, and every change to it — optimistic, so a tab,
 * a group-by or a hidden property moves at once and settles with the server's answer. Realtime: a
 * `workspace-changed` ping for the project invalidates ["nexus","project-views",id] (lib/invalidate.ts).
 */
export function projectViewsKey(projectId: string) {
  return ["nexus", "project-views", projectId] as const;
}

type ViewsData = { views: NexusProjectView[]; canEditShared: boolean };

export function useProjectViews(projectId: string, enabled: boolean) {
  const qc = useQueryClient();
  const key = projectViewsKey(projectId);
  const query = useQuery({ queryKey: key, queryFn: () => nexusApi.projectViews(projectId), enabled, staleTime: 30_000, retry: false });

  const setViews = (fn: (views: NexusProjectView[]) => NexusProjectView[]) =>
    qc.setQueryData<ViewsData>(key, (cur) => (cur ? { ...cur, views: fn(cur.views) } : cur));
  const fail = (e: unknown) => toast.error(t("Couldn't save the view"), { description: e instanceof Error ? e.message : undefined });
  const snapshot = async () => {
    await qc.cancelQueries({ queryKey: key });
    return qc.getQueryData<ViewsData>(key);
  };
  const restore = (prev: ViewsData | undefined) => { if (prev) qc.setQueryData(key, prev); };

  const create = useMutation({
    mutationFn: (payload: Parameters<typeof nexusApi.createProjectView>[1]) => nexusApi.createProjectView(projectId, payload),
    onSuccess: ({ view }) => setViews((vs) => (vs.some((v) => v.id === view.id) ? vs : [...vs, view])),
    onError: fail,
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  /** `patch` merges top-level config keys; the rest (name, layout, shared) replace. */
  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Parameters<typeof nexusApi.updateProjectView>[2]) => nexusApi.updateProjectView(projectId, id, payload),
    onMutate: async ({ id, patch, config, name, layout, shared }) => {
      const prev = await snapshot();
      setViews((vs) => vs.map((v) => (v.id !== id ? v : {
        ...v,
        ...(name !== undefined ? { name } : {}),
        ...(layout !== undefined ? { layout } : {}),
        ...(shared !== undefined ? { shared, ownerId: shared ? null : v.ownerId } : {}),
        config: config ?? (patch ? { ...v.config, ...patch } : v.config),
      })));
      return { prev };
    },
    onError: (e, _v, ctx) => { restore(ctx?.prev); fail(e); },
    onSuccess: ({ view }) => setViews((vs) => vs.map((v) => (v.id === view.id ? view : v))),
  });

  const remove = useMutation({
    mutationFn: (id: string) => nexusApi.deleteProjectView(projectId, id),
    onMutate: async (id) => {
      const prev = await snapshot();
      setViews((vs) => vs.filter((v) => v.id !== id));
      return { prev };
    },
    onError: (e, _v, ctx) => { restore(ctx?.prev); fail(e); },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const reorder = useMutation({
    mutationFn: (order: string[]) => nexusApi.reorderProjectViews(projectId, order),
    onMutate: async (order) => {
      const prev = await snapshot();
      setViews((vs) => order.map((id, i) => vs.find((v) => v.id === id) && { ...vs.find((v) => v.id === id)!, position: i }).filter(Boolean) as NexusProjectView[]);
      return { prev };
    },
    onError: (e, _v, ctx) => { restore(ctx?.prev); fail(e); },
    onSuccess: ({ views }) => qc.setQueryData<ViewsData>(key, (cur) => (cur ? { ...cur, views } : cur)),
  });

  return { query, views: query.data?.views ?? [], canEditShared: query.data?.canEditShared ?? false, create, update, remove, reorder };
}
