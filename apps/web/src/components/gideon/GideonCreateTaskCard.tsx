import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { decideGideonProposal, gideonTaskTargetOptions, type GideonProposal } from "@/lib/gideon";
import { SelectPicker } from "@/components/SelectPicker";
import { DateField } from "@/components/DateField";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { PROPOSAL_APPLY, PROPOSAL_DISCARD, ProposalHead } from "./GideonProposalParts";

/**
 * GIDEON's create_task card when no project was named (owner, 18 Oct 2026): instead of asking "which project?" in
 * the chat, the card carries a project picker — only projects the person can edit, as the server listed them —
 * preselected when the context made one obvious. Picking a project loads its columns and members (PIC = members of
 * that project only; a PIC who is not in the new project is dropped). Apply stays off until a project is chosen;
 * the server checks the project, column and PIC again and creates exactly one task.
 */
export function GideonCreateTaskCard({ proposal, onDecided }: { proposal: GideonProposal; onDecided: (p: GideonProposal) => void }) {
  const { t } = useLang();
  const tt = proposal.taskTarget!;
  const [projectId, setProjectId] = useState<string | null>(tt.projectId);
  const [taskListId, setTaskListId] = useState<string | null>(tt.taskListId);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(tt.assigneeIds);
  const [due, setDue] = useState<string | null>(tt.dueDay);
  const [pending, setPending] = useState<"apply" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["gideon-task-targets", projectId],
    queryFn: () => gideonTaskTargetOptions(projectId as string),
    enabled: !!projectId,
    staleTime: 30_000,
    retry: 1,
  });
  const sections = q.data?.sections ?? [];
  const members = q.data?.members ?? [];

  // A new project: its own columns and people. Keep only the PIC who are members there; the column resets to the
  // project's first one matching the proposed status (else its first).
  useEffect(() => {
    if (!q.data) return;
    const ids = new Set(q.data.members.map((m) => m.id));
    setAssigneeIds((cur) => cur.filter((id) => ids.has(id)));
    setTaskListId((cur) => (cur && q.data.sections.some((s) => s.id === cur) ? cur : (q.data.sections.find((s) => tt.status && s.taskStatus === tt.status)?.id ?? q.data.sections[0]?.id ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const projectOptions = useMemo(() => tt.projects.map((p) => ({ value: p.id, label: p.name })), [tt.projects]);
  const memberOptions = members.filter((m) => !assigneeIds.includes(m.id)).map((m) => ({ value: m.id, label: m.name }));
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "…";
  const canApply = !!projectId && !q.isError && !q.isLoading;

  const decide = async (d: "apply" | "discard") => {
    if (pending) return;
    setPending(d);
    setError(null);
    try {
      onDecided(await decideGideonProposal(proposal.id, d, undefined, d === "apply" && projectId ? { task: { projectId, taskListId, assigneeIds, dueDate: due } } : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't do that."));
    } finally {
      setPending(null);
    }
  };

  const row = "grid grid-cols-[6.5rem_1fr] items-center gap-2 rounded-md bg-muted/40 px-2 py-1";
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <ProposalHead open title={t("Create a task")} summary={proposal.summary} />
      <div className="space-y-1.5 px-3 pb-2.5 text-[13px]">
        <div className={row}>
          <span className="text-muted-foreground">{t("Title")}</span>
          <span className="min-w-0 break-words font-medium">{tt.title}</span>
        </div>
        <div className={cn(row, !projectId && "ring-1 ring-amber-500/50")}>
          <span className="text-muted-foreground">{t("Project")}</span>
          <SelectPicker value={projectId} onChange={(v) => { setProjectId(v || null); setError(null); }} options={projectOptions} placeholder={t("Choose a project")} ariaLabel={t("Project")} searchable searchPlaceholder={t("Search projects")} size="sm" disabled={!!pending} />
        </div>
        {projectId && (
          <>
            <div className={row}>
              <span className="text-muted-foreground">{t("Status")}</span>
              {q.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : (
                <SelectPicker value={taskListId} onChange={(v) => setTaskListId(v || null)} options={sections.map((s) => ({ value: s.id, label: s.name }))} placeholder={t("Choose a column")} ariaLabel={t("Status")} size="sm" disabled={!!pending || !sections.length} />
              )}
            </div>
            <div className={cn(row, "items-start")}>
              <span className="pt-0.5 text-muted-foreground">{t("PIC")}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {assigneeIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs font-medium ring-1 ring-border">
                    {nameOf(id)}
                    <button type="button" aria-label={t("Remove {name}", { name: nameOf(id) })} onClick={() => setAssigneeIds((cur) => cur.filter((x) => x !== id))} disabled={!!pending} className="rounded-full text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                  </span>
                ))}
                {!q.isLoading && memberOptions.length > 0 && (
                  <SelectPicker value="" onChange={(v) => v && setAssigneeIds((cur) => (cur.includes(v) ? cur : [...cur, v]))} options={memberOptions} placeholder={assigneeIds.length ? t("Add") : t("Unassigned")} ariaLabel={t("PIC")} searchable size="sm" disabled={!!pending} />
                )}
              </span>
            </div>
          </>
        )}
        <div className={row}>
          <span className="text-muted-foreground">{t("Due")}</span>
          <DateField value={due} onChange={(v) => setDue(v ? v.slice(0, 10) : null)} placeholder={t("No due date")} ariaLabel={t("Due")} disabled={!!pending} />
        </div>
        {q.isError && <div className="text-xs font-medium text-destructive">{t("You can't add tasks to that project. Pick another.")}</div>}
        {proposal.error && <div className="text-xs font-medium text-destructive">{proposal.error}</div>}
        {!projectId && <div className="text-xs text-muted-foreground">{t("Pick the project for this task. Only projects you can edit are listed.")}</div>}
      </div>
      {error && <div className="px-3 pb-2 text-xs font-medium text-destructive">{error}</div>}
      <div className="flex justify-end gap-1.5 border-t border-border/60 px-2.5 py-2">
        <button type="button" onClick={() => void decide("discard")} disabled={!!pending} className={PROPOSAL_DISCARD}>
          {pending === "discard" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("Discard")}
        </button>
        <button type="button" onClick={() => void decide("apply")} disabled={!!pending || !canApply} title={!projectId ? t("Choose a project") : undefined} className={PROPOSAL_APPLY}>
          {pending === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t("Apply")}
        </button>
      </div>
    </div>
  );
}
