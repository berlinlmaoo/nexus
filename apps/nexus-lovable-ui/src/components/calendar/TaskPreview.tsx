import { useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { CornerDownRight, Eye, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { nexusApi } from "@/lib/nexus-api";
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { SLATE, STATUS, statusTone } from "@/lib/calendar/tone";
import { CAPS, Face, FOCUS_PILL, fmtTime, PriorityChip, TOUCH_ICON, TOUCH_ROW } from "./bits";

/**
 * A task the viewer may read but not change (owner, 5 Oct 2026: someone outside the task's project can
 * open it and see its details, not edit it). Same data as the full panel (GET /api/tasks/:id), no
 * controls at all, so nothing can fail with "Forbidden" halfway through an edit.
 *
 * Built on the app's Radix dialog (focus trap, Escape, scroll lock), drawn as before: a full-screen sheet
 * on a phone, a centred card from `sm` up. Focus starts on Close. Loading is said in a status region
 * that then reads out the task's title once it arrives (the dialog's name changes, which nobody hears);
 * a failure is an alert, with Try again.
 */
export function TaskPreview({ taskId, projectName, notMember, masked = false, onClose }: { taskId: string; projectName: string | null; notMember: boolean; masked?: boolean; onClose: () => void }) {
  const { t, lang, locale } = useLang();
  // A task of a private project the viewer is not in is never fetched (owner, decision 1).
  const q = useQuery({ queryKey: ["task", taskId], queryFn: () => nexusApi.taskDetail(taskId), retry: false, staleTime: 30_000, enabled: !masked });
  const closeRef = useRef<HTMLButtonElement>(null);
  // The preview is opened through the URL, not by a dialog trigger: hand focus back to what had it
  // (the task row) when it closes.
  const [opener] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  const task = q.data;
  const due = task?.dueDate ? new Date(task.dueDate) : null;
  const wib = due ? new Date(due.getTime() + 7 * 3_600_000) : null;
  const hasTime = !!due && due.getUTCHours() + due.getUTCMinutes() !== 0 && !(wib && wib.getUTCHours() === 0 && wib.getUTCMinutes() === 0);
  const dueDay = wib ? wib.toISOString().slice(0, 10) : null;
  const project = task?.taskList?.project?.name ?? projectName;
  const linked = (task?.taskProjects ?? []).map((l) => l.project?.name).filter((n): n is string => !!n && n !== project);
  const loading = !masked && q.isLoading;
  const failed = !masked && q.isError;
  // Read the title out only when the task arrived after the dialog opened; a cached task is already
  // the dialog's name.
  const [waited] = useState(() => loading);
  const statusLabel = (s?: string | null) => s === "DONE" ? t("Done") : s === "IN_PROGRESS" ? t("In progress") : s === "IN_REVIEW" ? t("In review") : s === "CANCELLED" ? t("Cancelled") : t("To do");
  const showTask = !masked && !!task;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPortal>
        <DialogOverlay className="z-[60] bg-scrim backdrop-blur-sm motion-reduce:animate-none" />
        <DialogPrimitive.Content
          lang={lang}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => { e.preventDefault(); closeRef.current?.focus(); }}
          onCloseAutoFocus={(e) => { e.preventDefault(); if (opener?.isConnected) opener.focus(); }}
          className="fixed z-[60] flex w-full flex-col overflow-hidden bg-card shadow-pop outline-none max-sm:inset-0 max-sm:h-[100dvh] sm:left-1/2 sm:top-1/2 sm:max-h-[92dvh] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border sm:border-border">
          {!showTask && <DialogTitle className="sr-only">{t("Task")}</DialogTitle>}
          <div className="flex items-center gap-2 border-b border-border bg-cal-readonly px-4 py-2.5 text-xs text-cal-readonly-foreground">
            <Eye aria-hidden className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{project && notMember ? t("Read only · you are not a member of {project}", { project }) : t("Read only")}</span>
            <button ref={closeRef} type="button" onClick={onClose} aria-label={t("Close")} className={cn("grid size-8 place-items-center rounded-lg hover:bg-cal-readonly-foreground/10", TOUCH_ICON, FOCUS_PILL)}><X className="h-4 w-4" /></button>
          </div>
          <div aria-busy={loading || undefined} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {masked && <div className="py-12 text-center text-sm text-muted-foreground">{t("This is an internal task of a private project. Only its members can open it.")}</div>}
            {/* Always in the dialog, so what changes inside it is read out. */}
            <div role="status" aria-live="polite">
              {loading && (
                <div className="grid place-items-center gap-2 py-16 text-muted-foreground">
                  <Loader2 aria-hidden className="h-6 w-6 animate-spin motion-reduce:animate-none" />
                  <span className="text-xs">{t("Loading task…")}</span>
                </div>
              )}
              {waited && showTask && task && <span className="sr-only">{task.title}</span>}
            </div>
            {failed && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <p role="alert">{t("This task could not be loaded.")}</p>
                {/* aria-disabled, not disabled: a focused button that turns disabled drops focus to the page.
                    Once the task loads this button is gone, so focus goes back to Close. */}
                <button type="button" aria-disabled={q.isFetching || undefined}
                  onClick={() => { if (!q.isFetching) void q.refetch().then((r) => { if (r.isSuccess) closeRef.current?.focus(); }); }}
                  className={cn("mt-3 inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted aria-disabled:opacity-50", TOUCH_ROW, FOCUS_PILL)}>
                  {q.isFetching && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />}
                  {t("Try again")}
                </button>
              </div>
            )}
            {showTask && task && (
              <div className="space-y-5">
                {task.parent && <div className="flex items-center gap-1 text-xs text-muted-foreground"><CornerDownRight aria-hidden className="h-3.5 w-3.5" />{t("from {task}", { task: task.parent.title })}</div>}
                <DialogTitle className="font-display text-xl font-bold leading-snug tracking-tight [overflow-wrap:anywhere]">{task.title}</DialogTitle>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{t("Status")}</dt>
                  <dd><span className={cn("rounded-md px-1.5 py-0.5 text-xs font-semibold", statusTone(task.status))}>{statusLabel(task.status)}</span></dd>
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
                    <h3 className={cn("mb-1.5 text-muted-foreground", CAPS)}>{t("Description")}</h3>
                    <div className="whitespace-pre-wrap rounded-xl bg-muted/40 px-3 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]">{task.description}</div>
                  </section>
                )}
                {(task.subtasks ?? []).length > 0 && (
                  <section>
                    <h3 className={cn("mb-1.5 text-muted-foreground", CAPS)}>{t("Subtasks")}</h3>
                    <ul className="space-y-1">
                      {(task.subtasks ?? []).map((s) => (
                        <li key={s.id} className={cn("flex items-center gap-2 text-sm", s.status === "DONE" && "text-muted-foreground line-through")}>
                          <span aria-hidden className={cn("h-3.5 w-3.5 shrink-0 rounded-full border-2", s.status === "DONE" ? STATUS.doneDot : SLATE.border)} />{s.title}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {(task.comments ?? []).length > 0 && (
                  <section>
                    <h3 className={cn("mb-1.5 text-muted-foreground", CAPS)}>{t("Comments")}</h3>
                    <ul className="space-y-3">
                      {(task.comments ?? []).map((c) => (
                        <li key={c.id} className="flex gap-2.5">
                          <Face name={c.user?.name ?? "?"} avatar={c.user?.avatar ?? null} size={24} />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs"><span className="font-semibold">{c.user?.name ?? "?"}</span>{c.createdAt && <span className="text-muted-foreground"> · {new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(c.createdAt))}</span>}</div>
                            <div className="mt-0.5 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{c.content}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
