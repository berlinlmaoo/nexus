import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { CornerDownRight, Eye, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { nexusApi } from "@/lib/nexus-api";
import { Face, fmtTime, PriorityChip } from "./bits";

/**
 * A task the viewer may read but not change (owner, 5 Oct 2026: someone outside the task's project can
 * open it and see its details, not edit it). Same data as the full panel (GET /api/tasks/:id), no
 * controls at all, so nothing can fail with "Forbidden" halfway through an edit.
 */
export function TaskPreview({ taskId, projectName, notMember, masked = false, onClose }: { taskId: string; projectName: string | null; notMember: boolean; masked?: boolean; onClose: () => void }) {
  const { t, lang, locale } = useLang();
  // A task of a private project the viewer is not in is never fetched (owner, decision 1).
  const q = useQuery({ queryKey: ["task", taskId], queryFn: () => nexusApi.taskDetail(taskId), retry: false, staleTime: 30_000, enabled: !masked });
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && dialogRef.current) {
        const f = dialogRef.current.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const task = q.data;
  const due = task?.dueDate ? new Date(task.dueDate) : null;
  const wib = due ? new Date(due.getTime() + 7 * 3_600_000) : null;
  const hasTime = !!due && due.getUTCHours() + due.getUTCMinutes() !== 0 && !(wib && wib.getUTCHours() === 0 && wib.getUTCMinutes() === 0);
  const dueDay = wib ? wib.toISOString().slice(0, 10) : null;
  const project = task?.taskList?.project?.name ?? projectName;
  const linked = (task?.taskProjects ?? []).map((l) => l.project?.name).filter((n): n is string => !!n && n !== project);
  const statusLabel = (s?: string | null) => s === "DONE" ? t("Done") : s === "IN_PROGRESS" ? t("In progress") : s === "IN_REVIEW" ? t("In review") : s === "CANCELLED" ? t("Cancelled") : t("To do");

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-end bg-foreground/30 backdrop-blur-sm sm:place-items-center sm:p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal aria-label={task?.title ?? t("Task")} onClick={(e) => e.stopPropagation()}
        className="flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-card shadow-pop sm:h-auto sm:max-h-[92dvh] sm:rounded-3xl sm:border sm:border-border">
        <div className="flex items-center gap-2 border-b border-border bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{project && notMember ? t("Read only · you are not a member of {project}", { project }) : t("Read only")}</span>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {masked && <div className="py-12 text-center text-sm text-muted-foreground">{t("This is an internal task of a private project. Only its members can open it.")}</div>}
          {!masked && q.isLoading && <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
          {!masked && q.isError && <div className="py-12 text-center text-sm text-muted-foreground">{t("This task could not be loaded.")}</div>}
          {!masked && task && (
            <div className="space-y-5">
              {task.parent && <div className="flex items-center gap-1 text-[12px] text-muted-foreground"><CornerDownRight className="h-3.5 w-3.5" />{t("from {task}", { task: task.parent.title })}</div>}
              <h2 className="font-display text-xl font-bold leading-snug tracking-tight [overflow-wrap:anywhere]">{task.title}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
                <dt className="text-muted-foreground">{t("Status")}</dt>
                <dd><span className={cn("rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold", task.status === "DONE" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-muted")}>{statusLabel(task.status)}</span></dd>
                <dt className="text-muted-foreground">{t("Due")}</dt>
                <dd>{dueDay ? new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${dueDay}T00:00:00Z`)) : t("No due date")}{hasTime && wib ? ` · ${fmtTime(wib.toISOString().slice(11, 16), lang)} WIB` : ""}</dd>
                <dt className="text-muted-foreground">{t("Priority")}</dt>
                <dd>{task.priority === "URGENT" || task.priority === "HIGH" ? <PriorityChip priority={task.priority} /> : <span>{task.priority === "LOW" ? t("Low") : task.priority === "NONE" ? t("None") : t("Medium")}</span>}</dd>
                {project && <><dt className="text-muted-foreground">{t("Project")}</dt><dd className="[overflow-wrap:anywhere]">{project}{linked.length > 0 ? ` · ${linked.join(", ")}` : ""}</dd></>}
                <dt className="text-muted-foreground">{t("People")}</dt>
                <dd className="flex flex-wrap gap-x-3 gap-y-1">
                  {(task.assignees ?? []).length === 0 && <span className="text-muted-foreground">{t("Nobody yet")}</span>}
                  {(task.assignees ?? []).map((a) => a.user && (
                    <span key={a.user.id} className="inline-flex items-center gap-1.5"><Face name={a.user.name ?? a.user.email ?? "?"} avatar={a.user.avatar ?? null} size={20} />{a.user.name ?? a.user.email}</span>
                  ))}
                </dd>
              </dl>
              {task.description && (
                <section>
                  <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{t("Description")}</h3>
                  <div className="whitespace-pre-wrap rounded-xl bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed [overflow-wrap:anywhere]">{task.description}</div>
                </section>
              )}
              {(task.subtasks ?? []).length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{t("Subtasks")}</h3>
                  <ul className="space-y-1">
                    {(task.subtasks ?? []).map((s) => (
                      <li key={s.id} className={cn("flex items-center gap-2 text-[13px]", s.status === "DONE" && "text-muted-foreground line-through")}>
                        <span className={cn("h-3.5 w-3.5 shrink-0 rounded-full border-2", s.status === "DONE" ? "border-emerald-600 bg-emerald-600" : "border-[#5a6b83]")} />{s.title}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {(task.comments ?? []).length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{t("Comments")}</h3>
                  <ul className="space-y-3">
                    {(task.comments ?? []).map((c) => (
                      <li key={c.id} className="flex gap-2.5">
                        <Face name={c.user?.name ?? "?"} avatar={c.user?.avatar ?? null} size={24} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px]"><span className="font-semibold">{c.user?.name ?? "?"}</span>{c.createdAt && <span className="text-muted-foreground"> · {new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(c.createdAt))}</span>}</div>
                          <div className="mt-0.5 whitespace-pre-wrap text-[13px] [overflow-wrap:anywhere]">{c.content}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
