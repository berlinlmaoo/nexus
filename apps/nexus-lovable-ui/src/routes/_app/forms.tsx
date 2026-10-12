import { useState } from "react";
import { SelectPicker } from "@/components/SelectPicker";
import { EmptyState } from "@/components/EmptyState";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { nexusApi, type NexusForm, type NexusProject } from "@/lib/nexus-api";
import { Reveal } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/lib/lang";
import { FormCard, FormBuilder, useFormBuilderParam } from "@/components/forms/form-kit";

export const Route = createFileRoute("/_app/forms")({
  component: Forms,
  // The open builder (?form=<id> | new): Back closes it, refresh reopens it (useFormBuilderParam).
  validateSearch: (s: Record<string, unknown>): { form?: string } => ({ form: typeof s.form === "string" && s.form.length > 0 && s.form.length <= 64 ? s.form : undefined }),
});

function Forms() {
  const { t } = useLang();
  const [filter, setFilter] = useState("all");
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
  const projectName = (id?: string) => projectList.find((p) => p.id === id)?.name ?? t("Project");

  // Aggregate forms across ALL projects (live /api/forms is project-scoped & requires projectId,
  // so we fan out per project) — this is why forms looked "not synced" before.
  const forms = useQuery({
    queryKey: ["nexus", "forms", "all", projectList.map((p) => p.id).join(",")],
    enabled: projectList.length > 0,
    retry: false,
    queryFn: async () => {
      // One request per 300 projects (perf pass, 12 Oct 2026) instead of one per project; a server without
      // `projectIds` answers 400 for the missing projectId, and then the old fan-out runs.
      const ids = projectList.map((p) => p.id);
      try {
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 300) chunks.push(ids.slice(i, i + 300));
        return (await Promise.all(chunks.map((c) => nexusApi.formsMany(c)))).flat();
      } catch {
        const lists = await Promise.all(
          projectList.map((p) => nexusApi.forms(p.id).then((fs) => fs.map((f) => ({ ...f, projectId: f.projectId ?? p.id }))).catch(() => [] as NexusForm[])),
        );
        return lists.flat();
      }
    },
  });
  const allRows = forms.data ?? [];
  const rows = filter === "all" ? allRows : allRows.filter((f) => f.projectId === filter);
  const builderProjectId = filter !== "all" ? filter : projectList[0]?.id ?? "";
  const { builder, open, close, onCreated } = useFormBuilderParam(forms.data, forms.isSuccess || forms.isError);
  // A new form goes into the filtered project (or the first), remembered while its builder is open.
  const [newProjectId, setNewProjectId] = useState("");

  return (
    <div>
      <PageHeader
        title={t("Forms")}
        subtitle={t("Forms that create a task each time someone submits them.")}
        actions={
          <>
            <SelectPicker
              variant="field"
              value={filter}
              onChange={setFilter}
              ariaLabel={t("Project")}
              options={[{ value: "all", label: t("All projects") }, ...projectList.map((p) => ({ value: p.id, label: p.name }))]}
              className="min-w-0 flex-1 rounded-md px-3 font-semibold sm:max-w-[16rem] sm:flex-none"
            />
            <button disabled={!builderProjectId} onClick={() => { setNewProjectId(builderProjectId); open(); }} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> {t("New form")}</button>
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
          <EmptyState icon={FileText} title={t("No forms yet")}
            message={t("A form is a page people fill in, like a request, a reimbursement or a report. Each answer becomes a task. Make the first one and it shows up here for everyone to fill in.")} />
        )}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((f, i) => <Reveal key={f.id} delay={Math.min(i, 8) * 0.05} className="h-full min-w-0"><FormCard form={f} projectName={projectName(f.projectId)} onEdit={() => open(f)} /></Reveal>)}
        </div>
      </div>
      {builder && (builder.form?.projectId || newProjectId || builderProjectId) && <FormBuilder projectId={builder.form?.projectId ?? (newProjectId || builderProjectId)} form={builder.form} onClose={close} onCreated={onCreated} />}
    </div>
  );
}

