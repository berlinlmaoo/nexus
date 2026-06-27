import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Plus, X } from "lucide-react";
import {
  nexusApi,
  statusLabel,
  type NexusCustomField,
  type NexusCustomFieldOptions,
  type NexusProject,
  type NexusTask,
  type NexusUser,
} from "@/lib/nexus-api";
import { CustomFieldInput } from "@/components/tasks/TaskDetailPanel";
import { FieldEditor } from "@/components/projects/ProjectCustomFieldsManager";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Built-in columns (Name is always the implicit first column, not configurable away).
const BUILTIN: { key: string; label: string }[] = [
  { key: "assignee", label: "Assigned To" },
  { key: "dueDate", label: "Due Date" },
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
  { key: "tags", label: "Tags" },
];
const DEFAULT_COLUMNS = ["assignee", "dueDate", "priority", "status", "tags"];
const TASK_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"];
const TASK_PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];

const initials = (name?: string | null) => (name ? name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") : "?");

// Parse a raw serialized custom-field value into the shape CustomFieldInput expects.
function parseCfValue(type: string, raw: string): unknown {
  const t = (type || "").toUpperCase();
  if (!raw) return t === "MULTI_SELECT" || t === "FILE" ? [] : t === "PLACE" ? { label: "", mapUrl: "" } : "";
  if (t === "MULTI_SELECT" || t === "FILE") { try { return JSON.parse(raw); } catch { return []; } }
  if (t === "PLACE") { try { return JSON.parse(raw); } catch { return { label: raw, mapUrl: "" }; } }
  return raw;
}

export function ProjectTableView({ project, taskLists, onOpen }: {
  project: NexusProject;
  taskLists: NonNullable<NexusProject["taskLists"]>;
  onOpen: (task: NexusTask) => void;
}) {
  const projectId = project.id;
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "project", projectId] });

  const membersQ = useQuery({ queryKey: ["nexus", "project-members", projectId], queryFn: () => nexusApi.projectMembers(projectId), staleTime: 60_000, retry: false });
  const members = useMemo(() => {
    const raw = membersQ.data;
    const arr = Array.isArray(raw) ? raw : raw?.members ?? [];
    return arr.map((m) => m.user).filter(Boolean) as NexusUser[];
  }, [membersQ.data]);

  const cfDefsQ = useQuery({ queryKey: ["nexus", "project-custom-fields", projectId], queryFn: () => nexusApi.projectCustomFields(projectId), staleTime: 60_000, retry: false });
  const cfDefs = useMemo(() => cfDefsQ.data?.fields ?? [], [cfDefsQ.data]);
  const cfById = useMemo(() => new Map(cfDefs.map((f) => [f.id, f])), [cfDefs]);

  // Resolve the active columns; drop any cf:<id> whose field was deleted.
  const columns = useMemo(() => {
    const raw = project.tableColumns && project.tableColumns.length ? project.tableColumns : DEFAULT_COLUMNS;
    return raw.filter((c) => (c.startsWith("cf:") ? cfById.has(c.slice(3)) : BUILTIN.some((b) => b.key === c)));
  }, [project.tableColumns, cfById]);

  const colLabel = (key: string) => (key.startsWith("cf:") ? cfById.get(key.slice(3))?.name ?? "Field" : BUILTIN.find((b) => b.key === key)?.label ?? key);

  const saveColumns = useMutation({
    mutationFn: (next: string[]) => nexusApi.updateProject(projectId, { tableColumns: next }),
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't save columns", { description: "You need LEAD access to change the table layout." }),
  });

  const [addOpen, setAddOpen] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const createField = useMutation({
    mutationFn: (p: { name: string; type: string; options: NexusCustomFieldOptions | null }) => nexusApi.createCustomField(projectId, p),
    onSuccess: (res) => {
      setAddingField(false);
      qc.invalidateQueries({ queryKey: ["nexus", "project-custom-fields", projectId] });
      const id = res?.field?.id;
      if (id) saveColumns.mutate([...columns, `cf:${id}`]);
    },
    onError: (e) => toast.error("Couldn't create field", { description: e instanceof Error ? e.message : "You need LEAD access." }),
  });

  const available = [
    ...BUILTIN.filter((b) => !columns.includes(b.key)),
    ...cfDefs.filter((f) => !columns.includes(`cf:${f.id}`)).map((f) => ({ key: `cf:${f.id}`, label: f.name })),
  ];

  // task edit helpers (invalidate on success — the table refetches the project)
  const patchTask = async (taskId: string, payload: Parameters<typeof nexusApi.updateTask>[1]) => {
    try { await nexusApi.updateTask(taskId, payload); invalidate(); } catch { toast.error("Update failed", { description: "Check your access / session." }); }
  };
  const toggleAssignee = async (taskId: string, userId: string, has: boolean) => {
    try { has ? await nexusApi.removeAssignee(taskId, userId) : await nexusApi.addAssignee(taskId, userId); invalidate(); } catch { toast.error("Update failed"); }
  };
  const setCf = async (fieldId: string, taskId: string, value: unknown) => {
    try { await nexusApi.setCustomFieldValue(fieldId, taskId, value); invalidate(); } catch { toast.error("Update failed"); }
  };

  const gridTemplate = `minmax(220px,2fr) ${columns.map(() => "minmax(140px,1fr)").join(" ")} 40px`;

  return (
    <div className="p-4 md:p-8">
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <div className="min-w-max">
          {/* Header row */}
          <div className="grid items-stretch border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground" style={{ gridTemplateColumns: gridTemplate }}>
            <div className="flex items-center px-3 py-2">Name</div>
            {columns.map((key) => (
              <div key={key} className="group flex items-center justify-between gap-1 border-l border-border px-3 py-2">
                <span className="truncate">{colLabel(key)}</span>
                <button onClick={() => saveColumns.mutate(columns.filter((c) => c !== key))} title="Remove column" className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"><X className="h-3 w-3" /></button>
              </div>
            ))}
            <div className="border-l border-border">
              <Popover open={addOpen} onOpenChange={setAddOpen}>
                <PopoverTrigger asChild>
                  <button title="Add column" className="grid h-full w-full place-items-center text-muted-foreground hover:bg-accent hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-1">
                  <div className="max-h-64 overflow-y-auto">
                    {available.length === 0 && <p className="px-2 py-3 text-center text-xs normal-case text-muted-foreground">All fields are already columns.</p>}
                    {available.map((a) => (
                      <button key={a.key} onClick={() => { saveColumns.mutate([...columns, a.key]); setAddOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold normal-case text-foreground hover:bg-accent">
                        <Plus className="h-3 w-3 text-muted-foreground" /> {a.label}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => { setAddOpen(false); setAddingField(true); }} className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-border px-2 py-2 text-left text-xs font-bold normal-case text-primary hover:bg-accent"><Plus className="h-3.5 w-3.5" /> New custom field</button>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Sections + rows */}
          {taskLists.map((list) => {
            const tasks = list.tasks ?? [];
            return (
              <div key={list.id}>
                <div className="border-b border-border bg-muted/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {list.name} <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 tabular-nums">{tasks.length}</span>
                </div>
                {tasks.map((task) => (
                  <div key={task.id} className="grid items-stretch border-b border-border text-sm last:border-b-0 hover:bg-accent/30" style={{ gridTemplateColumns: gridTemplate }}>
                    <NameCell task={task} onRename={(title) => patchTask(task.id, { title })} onOpen={() => onOpen(task)} />
                    {columns.map((key) => (
                      <div key={key} className="min-w-0 border-l border-border px-2 py-1.5">
                        <Cell colKey={key} task={task} members={members} cfById={cfById} projectId={projectId} patchTask={patchTask} toggleAssignee={toggleAssignee} setCf={setCf} />
                      </div>
                    ))}
                    <div className="grid place-items-center border-l border-border">
                      <button onClick={() => onOpen(task)} title="Open" className="text-muted-foreground hover:text-primary"><ChevronRight className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
                {tasks.length === 0 && (
                  <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground" style={{ gridColumn: `1 / -1` }}>No tasks.</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {addingField && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={() => setAddingField(false)}>
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <FieldEditor saving={createField.isPending} onSave={(p) => createField.mutate(p)} onCancel={() => setAddingField(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

function questXp(task: NexusTask): number {
  return (task.quests ?? []).reduce((s, q) => s + (q.xpReward ?? 0), 0);
}

function NameCell({ task, onRename, onOpen }: { task: NexusTask; onRename: (title: string) => void; onOpen: () => void }) {
  const [title, setTitle] = useState(task.title);
  const done = task.status === "DONE";
  const xp = questXp(task);
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => { const t = title.trim(); if (t && t !== task.title) onRename(t); else if (!t) setTitle(task.title); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className={cn("min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:border-border focus:border-primary focus:bg-background", done && "text-muted-foreground line-through")}
      />
      {xp > 0 && <span title="Quest XP" className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">+{xp} XP</span>}
      <button onClick={onOpen} title="Open" className="shrink-0 text-muted-foreground/0 transition-colors hover:text-primary group-hover:text-muted-foreground"><ChevronRight className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function Cell({ colKey, task, members, cfById, projectId, patchTask, toggleAssignee, setCf }: {
  colKey: string;
  task: NexusTask;
  members: NexusUser[];
  cfById: Map<string, NexusCustomField>;
  projectId: string;
  patchTask: (taskId: string, payload: Parameters<typeof nexusApi.updateTask>[1]) => void;
  toggleAssignee: (taskId: string, userId: string, has: boolean) => void;
  setCf: (fieldId: string, taskId: string, value: unknown) => void;
}) {
  const cls = "w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none hover:border-border focus:border-primary focus:bg-background";

  if (colKey.startsWith("cf:")) {
    const def = cfById.get(colKey.slice(3));
    if (!def) return null;
    const rawCfv = (task.customFieldValues ?? []).find((c) => c.customFieldId === def.id);
    const raw = typeof rawCfv?.value === "string" ? rawCfv.value : "";
    const value = parseCfValue(def.type ?? "", raw);
    // key by the persisted raw value so the editor re-seeds its internal state after a save+refetch
    // (CustomFieldInput only reads field.value on mount). No focus loss: values only change on blur/select.
    return <CustomFieldInput key={raw} field={{ ...def, value: value as NexusCustomField["value"] }} projectId={projectId} hideLabel onSet={(v) => setCf(def.id, task.id, v)} />;
  }

  if (colKey === "status") {
    return (
      <select value={task.status ?? "TODO"} onChange={(e) => patchTask(task.id, { status: e.target.value })} className={cls}>
        {TASK_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
      </select>
    );
  }
  if (colKey === "priority") {
    return (
      <select value={task.priority ?? "NONE"} onChange={(e) => patchTask(task.id, { priority: e.target.value })} className={cls}>
        {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{statusLabel(p)}</option>)}
      </select>
    );
  }
  if (colKey === "dueDate") {
    const d = task.dueDate ? String(task.dueDate).slice(0, 10) : "";
    return <input type="date" value={d} onChange={(e) => patchTask(task.id, { dueDate: e.target.value || null })} className={cls} />;
  }
  if (colKey === "assignee") return <AssigneeCell task={task} members={members} onToggle={(uid, has) => toggleAssignee(task.id, uid, has)} />;
  if (colKey === "tags") return <TagsCell task={task} onSave={(tags) => patchTask(task.id, { tags })} />;
  return null;
}

function AssigneeCell({ task, members, onToggle }: { task: NexusTask; members: NexusUser[]; onToggle: (userId: string, has: boolean) => void }) {
  const current = (task.assignees ?? []).map((a) => a.user).filter(Boolean) as NexusUser[];
  const currentIds = new Set(current.map((u) => u.id));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center gap-1 rounded-md border border-transparent px-1 py-1 text-left hover:border-border">
          {current.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            <span className="flex items-center -space-x-1.5">
              {current.slice(0, 3).map((u) => <span key={u.id} title={u.name ?? ""} className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-[9px] font-bold text-primary ring-2 ring-card">{initials(u.name)}</span>)}
              {current.length > 3 && <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground ring-2 ring-card">+{current.length - 3}</span>}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-56 w-52 overflow-y-auto p-1">
        {members.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No members.</p>}
        {members.map((u) => {
          const has = currentIds.has(u.id);
          return (
            <button key={u.id} onClick={() => onToggle(u.id, has)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent">
              <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", has ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{has && <Check className="h-3 w-3" />}</span>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">{initials(u.name)}</span>
              <span className="truncate">{u.name ?? u.email ?? "Member"}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function TagsCell({ task, onSave }: { task: NexusTask; onSave: (tags: string[]) => void }) {
  // Local accumulator so rapid add/remove (before the refetch lands) can't clobber an in-flight save
  // by reading a stale task.tags. Seeded once; this user's edits accumulate locally + persist each.
  const [tags, setTags] = useState<string[]>(() => (task.tags ?? []).filter(Boolean));
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    setDraft("");
    if (t && !tags.includes(t)) { const next = [...tags, t]; setTags(next); onSave(next); }
  };
  const remove = (t: string) => { const next = tags.filter((x) => x !== t); setTags(next); onSave(next); };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {t}
          <button onClick={() => remove(t)} className="hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={tags.length === 0 ? "Add…" : ""}
        className="min-w-[3rem] flex-1 border-none bg-transparent px-1 py-0.5 text-xs outline-none"
      />
    </div>
  );
}
