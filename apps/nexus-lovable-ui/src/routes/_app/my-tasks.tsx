import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { fmtDue, nexusApi, statusLabel, type CreateTaskPayload, type NexusProject, type NexusTask } from "@/lib/nexus-api";
import { Plus, Filter, ArrowUpDown, CheckCircle2, MessageCircle, Sparkles, Loader2, X } from "lucide-react";
import { celebrate } from "@/components/Celebration";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import { Reveal } from "@/components/motion";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/my-tasks")({ component: MyTasks });

function MyTasks() {
  const qc = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  // Only MY tasks — scope to the logged-in user (server filters via ?assigneeId=).
  // Without this it fetched every task in the workspace, incl. ones not assigned to me.
  const profile = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const myId = profile.data?.user?.id;
  const tasks = useQuery({
    queryKey: ["nexus", "tasks", "assignee", myId],
    queryFn: () => nexusApi.tasks(`assigneeId=${myId}`),
    enabled: !!myId,
    retry: false,
  });
  const rawRows = tasks.data ?? [];
  // Hide tasks done more than a week ago (uses updatedAt as the completion proxy —
  // Task model has no completedAt); open tasks always stay.
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const rows = rawRows.filter((t) => {
    if (!isDone(t.status)) return true;
    const ts = t.updatedAt ? new Date(t.updatedAt).getTime() : 0;
    return ts > 0 && now - ts <= WEEK;
  });
  const sessionLost = profile.isError || tasks.isError;
  const loading = !sessionLost && (profile.isLoading || !myId || tasks.isLoading);
  const groups = [
    { label: "Hot today", items: rows.filter((t) => !isDone(t.status) && isDueSoon(t.dueDate)).slice(0, 8) },
    { label: "In motion", items: rows.filter((t) => !isDone(t.status) && !isDueSoon(t.dueDate)).slice(0, 12) },
    { label: "Recently slayed", items: rows.filter((t) => isDone(t.status)).slice(0, 8) },
  ].filter((g) => g.items.length > 0);

  return (
    <div>
      <PageHeader title="My Quest Log" subtitle="Live NEXUS tasks, grouped into bite-sized next moves." actions={
        <>
          <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors duration-150 hover:bg-accent active:scale-[0.98]"><Filter className="h-3.5 w-3.5" /> Filter</button>
          <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors duration-150 hover:bg-accent active:scale-[0.98]"><ArrowUpDown className="h-3.5 w-3.5" /> Sort</button>
          <button onClick={() => setComposerOpen(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" /> New quest</button>
        </>
      } />
      <div className="p-4 md:p-8 space-y-6">
        {loading && <QuestSkeleton />}
        {sessionLost && <EmptyState title="Quest feed locked" message="You'll need to log in to pull live tasks from core NEXUS." />}
        {!loading && !sessionLost && rows.length === 0 && <EmptyState title="Quest log empty" message="Nothing's been assigned to you yet. Time to launch a mission." />}
        {groups.map((g, i) => (
          <Reveal key={g.label} delay={i * 0.08}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.label} <span className="text-muted-foreground/70">· {g.items.length}</span></h3>
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
              {g.items.map((t) => <TaskRow key={t.id} task={t} onOpen={() => setOpenTaskId(t.id)} />)}
            </div>
          </Reveal>
        ))}
      </div>
      {composerOpen && <TaskComposer onClose={() => setComposerOpen(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["nexus", "tasks"] })} />}
      {openTaskId && <TaskDetailPanel taskId={openTaskId} onClose={() => setOpenTaskId(null)} morphId={`mytasks-taskcard-${openTaskId}`} />}
    </div>
  );
}

function TaskRow({ task, onOpen }: { task: NexusTask; onOpen: () => void }) {
  const qc = useQueryClient();
  const assignee = task.assignees?.[0]?.user;
  const nextStatus = isDone(task.status) ? "TODO" : "DONE";
  const update = useMutation({
    mutationFn: () => nexusApi.updateTask(task.id, { status: nextStatus }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexus", "tasks"] });
      qc.invalidateQueries({ queryKey: ["nexus", "dashboard"] });
      celebrate(nextStatus === "DONE" ? `Slayed: ${task.title.length > 24 ? task.title.slice(0, 22) + "…" : task.title} ⚔️` : "Quest reopened 🔁");
    },
  });

  return (
    <motion.div layoutId={`mytasks-taskcard-${task.id}`} data-morph-id={`mytasks-taskcard-${task.id}`} style={{ borderRadius: 12 }} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40">
      <button
        className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", isDone(task.status) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-transparent hover:border-primary hover:text-primary")}
        disabled={update.isPending}
        onClick={() => update.mutate()}
        aria-label={nextStatus === "DONE" ? "Mark done" : "Reopen task"}
        title={nextStatus === "DONE" ? "Mark done" : "Reopen task"}
      >
        {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      </button>
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }} className="min-w-0 flex-1 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <div className="truncate text-sm font-semibold">{task.title}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
          <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3 text-primary" />{task.taskList?.name || "NEXUS board"}</span>
          {typeof task._count?.comments === "number" && <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" />{task._count.comments}</span>}
          {update.isError && <span className="text-red-500">Update failed</span>}
        </div>
      </div>
      <span className={`hidden sm:inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${priorityClass(task.priority)}`}>{statusLabel(task.priority || "Normal")}</span>
      <span className="hidden md:block text-xs text-muted-foreground w-24 text-right">{fmtDue(task.dueDate)}</span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{statusLabel(task.status)}</span>
      <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-[10px] font-black text-primary" title={assignee?.name || "Unassigned"}>{initials(assignee?.name)}</div>
    </motion.div>
  );
}

function TaskComposer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [projectId, setProjectId] = useState("");
  const [taskListId, setTaskListId] = useState("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<CreateTaskPayload["priority"]>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const projects = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false });
  const projectDetail = useQuery({ queryKey: ["nexus", "project", projectId], queryFn: () => nexusApi.project(projectId), enabled: Boolean(projectId), retry: false });
  const lists = projectDetail.data?.taskLists ?? [];
  const create = useMutation({
    mutationFn: () => nexusApi.createTask({ title, projectId, taskListId, priority, status: "TODO", dueDate: dueDate || null }),
    onSuccess: () => {
      onCreated();
      celebrate("New quest spawned ✨");
      onClose();
    },
  });

  const canSubmit = title.trim() && projectId && taskListId && !create.isPending;
  const firstList = useMemo(() => lists[0]?.id || "", [lists]);

  useEffect(() => {
    if (!taskListId && firstList) setTaskListId(firstList);
  }, [firstList, taskListId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const field = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight">Spawn a new quest</h2>
            <p className="mt-1 text-sm text-muted-foreground">Creates a real task in core NEXUS. Pick project + list first.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-5 space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">Quest title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Finalize booth deck" className={field} />
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">Project</label>
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskListId(""); }} className={field}>
            <option value="">Pick a mission board</option>
            {(projects.data ?? []).map((p: NexusProject) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">List</label>
          <select value={taskListId} onChange={(e) => setTaskListId(e.target.value)} disabled={!projectId || projectDetail.isLoading} className={cn(field, "disabled:opacity-50")}>
            <option value="">Pick lane</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as CreateTaskPayload["priority"])} className={cn(field, "mt-1")}>
                {(["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const).map((p) => <option key={p} value={p}>{statusLabel(p)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={cn(field, "mt-1")} />
            </div>
          </div>
          {projectDetail.isError && <p className="text-sm text-destructive">Could not load project lanes. Check permission/session.</p>}
          {create.isError && <p className="text-sm text-destructive">Create failed. Make sure title, project, and lane are valid.</p>}
          <button disabled={!canSubmit} onClick={() => create.mutate()} className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default disabled:opacity-50">
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create real NEXUS task
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 2 }).map((_, gi) => (
        <div key={gi}>
          <Skeleton className="mb-2 h-3 w-28" />
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-5 w-5 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
                <Skeleton className="hidden h-5 w-14 rounded-full sm:block" />
                <Skeleton className="h-7 w-7 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><div className="text-lg font-black">{title}</div><p className="mt-2 text-sm text-muted-foreground">{message}</p></div>;
}

function isDone(status?: string | null) {
  return ["DONE", "COMPLETED", "COMPLETE"].includes((status || "").toUpperCase());
}

function isDueSoon(value?: string | null) {
  if (!value) return false;
  const due = new Date(value).getTime();
  if (Number.isNaN(due)) return false;
  return due <= Date.now() + 3 * 24 * 60 * 60 * 1000 && due >= Date.now() - 24 * 60 * 60 * 1000;
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

function priorityClass(priority?: string | null) {
  const p = (priority || "").toUpperCase();
  if (p.includes("URGENT") || p.includes("HIGH")) return "bg-destructive/10 text-destructive";
  if (p.includes("MEDIUM")) return "bg-warning/15 text-warning-foreground";
  return "bg-success/10 text-success";
}
