import { useEffect, useMemo, useState } from "react";
import { SelectPicker } from "@/components/SelectPicker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Search, X } from "lucide-react";
import { ProjectMark } from "@/components/projects/ProjectIcon";
import { nexusApi } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";

/**
 * "Copy to project" — makes an INDEPENDENT copy of one or more tasks in another project.
 * Not the same as "Also in projects", which surfaces the very same task in a second place.
 *
 * Copies land in a chosen section (TaskList) because a project's board is organised by section;
 * dropping them into an arbitrary one would scatter them.
 */
export function CopyToProjectDialog({ taskIds, sourceProjectId, onClose, onDone }: {
  taskIds: string[];
  sourceProjectId?: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { t, tn } = useLang();
  const [q, setQ] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [listId, setListId] = useState<string>("");
  const [result, setResult] = useState<{ ok: number; failed: number; fields: string[]; assignees: number } | null>(null);

  // Esc closes this dialog only (captured first, so a task popup underneath stays open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const projectsQ = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false });
  // Sections live on the project payload, so only the CHOSEN project is fetched in full.
  const projectQ = useQuery({
    queryKey: ["nexus", "project", projectId],
    queryFn: () => nexusApi.project(projectId),
    enabled: !!projectId,
    retry: false,
  });

  const projects = useMemo(() => {
    const all = projectsQ.data ?? [];
    const s = q.trim().toLowerCase();
    // Copying into the project it already lives in is what plain Duplicate is for — hide it here so
    // the list only offers real destinations.
    const pool = all.filter((p) => p.id !== sourceProjectId);
    return s ? pool.filter((p) => p.name.toLowerCase().includes(s)) : pool;
  }, [projectsQ.data, q, sourceProjectId]);

  const lists = useMemo(
    () => (projectQ.data?.taskLists ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [projectQ.data],
  );
  const targetList = listId || lists[0]?.id || "";

  const copy = useMutation({
    mutationFn: async () => {
      const fields = new Set<string>();
      let assignees = 0, ok = 0, failed = 0;
      // Sequential on purpose: each copy appends to the destination list, and firing them in
      // parallel would race on position and scramble the order.
      for (const id of taskIds) {
        try {
          const r = await nexusApi.duplicateTask(id, undefined, targetList);
          ok += 1;
          r.copiedTo?.droppedFields?.forEach((f) => fields.add(f));
          assignees += r.copiedTo?.droppedAssignees ?? 0;
        } catch { failed += 1; }
      }
      return { ok, failed, fields: [...fields], assignees };
    },
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ predicate: (query) => query.queryKey.map(String).some((k) => k.includes("project") || k.includes("task")) });
      onDone?.();
    },
  });

  const many = taskIds.length > 1;

  return (
    <div className="fixed inset-0 z-[96] grid place-items-center bg-foreground/30 dark:bg-scrim p-4 backdrop-blur-sm" onClick={onClose}>
      {/* A real dialog (bug hunt C-BUG-24): role + aria-modal, Esc closes, and it sits above the selection bar. */}
      <div role="dialog" aria-modal="true" aria-labelledby="copy-to-project-title" className="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="copy-to-project-title" className="font-display text-lg font-bold tracking-tight">{t("Copy to another project")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {many ? t("{n} tasks are copied as new tasks. The originals stay in this project.", { n: taskIds.length }) : t("This task is copied as a new task. The original stays in this project.")}
            </p>
          </div>
          <button onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        {result ? (
          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-2 rounded-2xl border border-success/30 bg-success/10 p-3 text-sm font-semibold text-success">
              <Check className="h-4 w-4 shrink-0" />
              {tn(result.ok, "{n} task copied", "{n} tasks copied")}{result.failed > 0 ? `, ${t("{n} failed", { n: result.failed })}` : ""}
            </div>
            {/* Say plainly what did NOT come along, rather than letting it be discovered later. */}
            {(result.fields.length > 0 || result.assignees > 0) && (
              <div className="rounded-2xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                <div className="font-bold text-foreground">{t("Not copied:")}</div>
                {result.fields.length > 0 && (
                  <div className="mt-1">· {t("Custom field")} <b>{result.fields.join(", ")}</b> — {t("the target project has no field with the same name and type.")}</div>
                )}
                {result.assignees > 0 && (
                  <div className="mt-1">· {tn(result.assignees, "{n} assignee", "{n} assignees")} — {t("they aren't members of the target project.")}</div>
                )}
              </div>
            )}
            <button onClick={onClose} className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98]">{t("Done")}</button>
          </div>
        ) : (
          <>
            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search projects…")} className="w-full rounded-xl border border-border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:border-primary" />
            </div>

            <div className="mt-2 max-h-52 flex-1 space-y-1 overflow-y-auto rounded-xl border border-border p-1">
              {projectsQ.isLoading ? (
                <div className="grid place-items-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : projects.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{q.trim() ? t("No project “{q}”.", { q }) : t("No target projects.")}</p>
              ) : projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setProjectId(p.id); setListId(""); }}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors", projectId === p.id ? "bg-primary/10 font-semibold text-primary" : "hover:bg-accent")}
                >
                  <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", projectId === p.id ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {projectId === p.id && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span className="grid h-5 w-5 shrink-0 place-items-center"><ProjectMark icon={p.icon} color={p.color} className="max-h-5 max-w-5" /></span>
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>

            {projectId && (
              <div className="mt-3">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("Into section")}</label>
                {projectQ.isLoading ? (
                  <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
                ) : lists.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">{t("This project has no sections yet. Create one there first.")}</p>
                ) : (
                  <SelectPicker variant="field" value={targetList} onChange={setListId} ariaLabel={t("Into section")} options={lists.map((l) => ({ value: l.id, label: l.name }))} className="mt-1 flex w-full rounded-xl px-3 py-2" />
                )}
              </div>
            )}

            {copy.isError && <p className="mt-3 text-xs font-semibold text-destructive">{t("Couldn't copy. Try again.")}</p>}

            <button
              disabled={!targetList || copy.isPending}
              onClick={() => copy.mutate()}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
            >
              {copy.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              {copy.isPending ? t("Copying…") : many ? t("Copy {n} tasks", { n: taskIds.length }) : t("Copy task")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
