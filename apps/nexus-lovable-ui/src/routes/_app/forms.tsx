import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { nexusApi, type NexusForm, type NexusProject } from "@/lib/nexus-api";
import { Reveal } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { FormCard, FormBuilder } from "@/components/forms/form-kit";

export const Route = createFileRoute("/_app/forms")({ component: Forms });

function Forms() {
  const [filter, setFilter] = useState("all");
  const [builder, setBuilder] = useState<{ form?: NexusForm; projectId: string } | null>(null);
  // Member-scoped projects → derive workspaces → fetch ALL projects per workspace
  // (workspace owners/admins can access forms in projects they aren't a member of).
  const memberProjects = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false });
  const wsIds = Array.from(new Set((memberProjects.data ?? []).map((p) => p.workspaceId).filter(Boolean))) as string[];
  const projectsQuery = useQuery({
    queryKey: ["nexus", "ws-projects", wsIds.join(",")],
    enabled: wsIds.length > 0,
    retry: false,
    queryFn: async () => {
      const lists = await Promise.all(wsIds.map((ws) => nexusApi.workspaceProjects(ws).catch(() => [] as NexusProject[])));
      const map = new Map<string, NexusProject>();
      for (const p of lists.flat()) map.set(p.id, p);
      return Array.from(map.values());
    },
  });
  const projectList = (projectsQuery.data?.length ? projectsQuery.data : memberProjects.data) ?? [];
  const projectName = (id?: string) => projectList.find((p) => p.id === id)?.name ?? "Project";

  // Aggregate forms across ALL projects (live /api/forms is project-scoped & requires projectId,
  // so we fan out per project) — this is why forms looked "not synced" before.
  const forms = useQuery({
    queryKey: ["nexus", "forms", "all", projectList.map((p) => p.id).join(",")],
    enabled: projectList.length > 0,
    retry: false,
    queryFn: async () => {
      const lists = await Promise.all(
        projectList.map((p) => nexusApi.forms(p.id).then((fs) => fs.map((f) => ({ ...f, projectId: f.projectId ?? p.id }))).catch(() => [] as NexusForm[])),
      );
      return lists.flat();
    },
  });
  const allRows = forms.data ?? [];
  const rows = filter === "all" ? allRows : allRows.filter((f) => f.projectId === filter);
  const builderProjectId = filter !== "all" ? filter : projectList[0]?.id ?? "";

  return (
    <div>
      <PageHeader
        title="Forms"
        subtitle="Intake forms that spin up real tasks on submit."
        actions={
          <>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold outline-none focus:border-primary">
              <option value="all">All projects</option>
              {projectList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button disabled={!builderProjectId} onClick={() => setBuilder({ projectId: builderProjectId })} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> New form</button>
          </>
        }
      />
      <div className="p-4 md:p-8">
        {forms.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                <div className="flex items-start gap-2"><Skeleton className="h-5 w-5 rounded" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div></div>
                <Skeleton className="mt-4 h-3 w-1/3" /><Skeleton className="mt-3 h-8 w-full rounded-xl" />
              </div>
            ))}
          </div>
        )}
        {!forms.isLoading && rows.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">No forms yet</div><p className="mt-2 text-sm text-muted-foreground">{filter === "all" ? "Belum ada form di project mana pun." : "Belum ada form di project ini."}</p></div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((f, i) => <Reveal key={f.id} delay={Math.min(i, 8) * 0.05} className="h-full"><FormCard form={f} projectName={projectName(f.projectId)} onEdit={() => setBuilder({ form: f, projectId: f.projectId ?? builderProjectId })} /></Reveal>)}
        </div>
      </div>
      {builder && <FormBuilder projectId={builder.projectId} form={builder.form} onClose={() => setBuilder(null)} />}
    </div>
  );
}

