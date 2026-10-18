import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { decideGideonProposal, type GideonProposal } from "@/lib/gideon";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { PROPOSAL_APPLY, PROPOSAL_DISCARD } from "./GideonProposalParts";

/**
 * GIDEON's delete_task card (owner, 18 Oct 2026). Always shown, in every approval mode: the task as it was when GIDEON
 * proposed it (title, project, status, due, assignees), a destructive "Delete task" button, and after it the
 * "Task deleted" line with where to restore it. Apply sends the task id back (`confirm`): the server refuses a delete
 * from a card that did not show it, and checks Can edit, a task deleted or changed meanwhile, and a double tap.
 */
export function GideonDeleteTaskCard({ proposal, onDecided }: { proposal: GideonProposal; onDecided: (p: GideonProposal) => void }) {
  const { t, locale } = useLang();
  const d = proposal.taskDelete!;
  const open = proposal.status === "PENDING";
  const [pending, setPending] = useState<"apply" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "apply" | "discard") => {
    if (pending) return;
    setPending(decision);
    setError(null);
    try {
      onDecided(await decideGideonProposal(proposal.id, decision, undefined, decision === "apply" ? { taskId: d.taskId } : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't do that."));
    } finally {
      setPending(null);
    }
  };

  const dueText = d.dueDay
    ? new Date(`${d.dueDay}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(/,/g, "") + (d.due?.match(/\b\d{2}:\d{2}$/) ? ` ${d.due.match(/\b\d{2}:\d{2}$/)![0]}` : "")
    : t("No due date");
  const status = [d.status, d.progress && d.progress !== d.status ? t(d.progress) : null].filter(Boolean).join(" · ");
  const rows: [string, string][] = [
    [t("Project"), d.projectName ?? "—"],
    [t("Status"), status || "—"],
    [t("Due"), dueText],
    [t("Assignees"), d.assignees.length ? d.assignees.join(", ") : t("Unassigned")],
  ];
  const deleted = proposal.status === "APPLIED";
  const statusLine =
    deleted ? null :
    proposal.status === "DISCARDED" ? t("Discarded") :
    proposal.status === "FAILED" ? t("Couldn't apply: {reason}", { reason: proposal.error ?? "" }) :
    proposal.status === "APPLYING" ? t("Deleting…") : null;

  return (
    <div className={cn("overflow-hidden rounded-2xl border bg-card", open ? "border-destructive/40 shadow-soft" : "border-border opacity-90")}>
      <div className="flex items-start gap-2.5 px-3 pb-2 pt-2.5">
        <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border", open ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-background text-muted-foreground")}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm font-semibold", open && "text-destructive")}>{deleted ? t("Task deleted") : t("Delete task")}</span>
          <span className={cn("mt-0.5 block break-words text-[13px] font-medium", deleted && "line-through opacity-70")}>{d.title}</span>
        </span>
        {open && <span className="mt-1 flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />{t("Waiting for your approval")}</span>}
      </div>
      <dl className={cn("space-y-1 px-3 pb-2.5 text-[13px]", deleted && "opacity-70")}>
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-2 rounded-md bg-muted/40 px-2 py-1">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {open && <div className="px-3 pb-2.5 text-xs text-muted-foreground">{t("Deleting removes it for everyone in the project, with its subtasks, comments and files. It can be restored from the Audit.")}</div>}
      {deleted && <div className="px-3 pb-3 text-xs font-medium text-muted-foreground">{t("It can be restored from Control Room → Audit.")}</div>}
      {statusLine && <div className={cn("px-3 py-2 text-xs font-medium", proposal.status === "FAILED" ? "text-destructive" : "text-muted-foreground")}>{statusLine}</div>}
      {error && <div className="px-3 pb-2 text-xs font-medium text-destructive">{error}</div>}
      {open && (
        <div className="flex justify-end gap-1.5 border-t border-border/60 px-2.5 py-2">
          <button type="button" onClick={() => void decide("discard")} disabled={!!pending} className={PROPOSAL_DISCARD}>
            {pending === "discard" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("Keep task")}
          </button>
          <button type="button" onClick={() => void decide("apply")} disabled={!!pending} className={cn(PROPOSAL_APPLY, "bg-destructive text-destructive-foreground hover:bg-destructive/90")}>
            {pending === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} {t("Delete task")}
          </button>
        </div>
      )}
    </div>
  );
}
