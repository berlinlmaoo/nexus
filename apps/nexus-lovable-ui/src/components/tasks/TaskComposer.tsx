import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { JSONContent } from "@tiptap/core";
import { Calendar, Check, CircleDot, Flag, Loader2, Search, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { celebrate } from "@/components/Celebration";
import { BlockEditor, type RestSaveResult } from "@/components/editor/BlockEditor";
import { useEditorCtx } from "@/components/editor/useEditorCtx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { nexusApi, type CreateTaskPayload, type NexusCustomField, type NexusProject } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { defaultOption, usesStatusOptions } from "@/lib/status-options";
import { StatusPicker, StatusPill } from "./StatusPicker";

const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const;
const PRIORITY_TEXT: Record<string, string> = { URGENT: "Urgent", HIGH: "High", MEDIUM: "Medium", LOW: "Low", NONE: "No priority" };

function choices(field: NexusCustomField): string[] {
  const o = field.options as unknown;
  if (!o) return [];
  if (Array.isArray(o)) return o.map(String);
  const obj = o as { options?: unknown[]; choices?: unknown[] };
  return (obj.options ?? obj.choices ?? []).map(String);
}

type Draft = { title: string; sectionId: string; priority: CreateTaskPayload["priority"]; dueDate: string; assigneeIds: string[]; cf: Record<string, string | string[]>; doc: JSONContent | null };
const draftKey = (projectId: string) => `nexus:task-draft:${projectId}`;

/**
 * Add task (owner, 12 Oct 2026): one rounded surface like the task popup. Title first (Enter creates),
 * then Notion-style properties — Status (the project's status options), Assignee (people with avatars),
 * Priority, Due date, the project's custom fields — and the description in the block editor. "Create
 * task" stays off until there is a title. Closing with a title keeps it as a draft in this browser and
 * the next Add task picks it up; nothing is created until "Create task".
 */
export function TaskComposer({ project, selectedListId, initialDueDate, onClose }: { project: NexusProject; selectedListId: string; initialDueDate?: string; onClose: () => void }) {
  const { t, locale } = useLang();
  const qc = useQueryClient();
  const sections = useMemo(() => [...(project.taskLists ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [project.taskLists]);
  const statusOptions = usesStatusOptions(sections);
  const saved = useMemo<Partial<Draft> | null>(() => { try { return JSON.parse(sessionStorage.getItem(draftKey(project.id)) ?? "null"); } catch { return null; } }, [project.id]);
  const [title, setTitle] = useState(saved?.title ?? "");
  const [sectionId, setSectionId] = useState(selectedListId || saved?.sectionId || defaultOption(sections)?.id || sections[0]?.id || "");
  const [priority, setPriority] = useState<CreateTaskPayload["priority"]>(saved?.priority ?? "NONE");
  const [dueDate, setDueDate] = useState(initialDueDate || saved?.dueDate || "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(saved?.assigneeIds ?? []);
  const [cf, setCf] = useState<Record<string, string | string[]>>(saved?.cf ?? {});
  const doc = useRef<JSONContent | null>(saved?.doc ?? null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const roomKey = useMemo(() => `draft:${Math.random().toString(36).slice(2)}`, []);
  const ctx = useEditorCtx(project.id, `/projects/${project.id}`);
  const cfQuery = useQuery({ queryKey: ["nexus", "project-custom-fields", project.id], queryFn: () => nexusApi.projectCustomFields(project.id), retry: false, staleTime: 60_000 });
  const fields = cfQuery.data?.fields ?? [];
  const members = (project.members ?? []).map((m) => m.user).filter(Boolean) as Array<{ id: string; name?: string | null; email?: string | null; avatar?: string | null }>;
  const created = useRef(false);

  // Keep what was typed when the dialog closes without creating (the next Add task picks it up).
  const latest = useRef<Draft>({ title, sectionId, priority, dueDate, assigneeIds, cf, doc: doc.current });
  latest.current = { title, sectionId, priority, dueDate, assigneeIds, cf, doc: doc.current };
  useEffect(() => () => {
    try {
      if (created.current || !latest.current.title.trim()) sessionStorage.removeItem(draftKey(project.id));
      else sessionStorage.setItem(draftKey(project.id), JSON.stringify(latest.current));
    } catch { /* ignore */ }
  }, [project.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onRestSave = useCallback(async (d: JSONContent): Promise<RestSaveResult> => { doc.current = d; return { ok: true }; }, []);
  const hasText = (d: JSONContent | null) => !!d && JSON.stringify(d).includes('"text"');

  const submit = async () => {
    if (!title.trim() || !sectionId || busy) return;
    setBusy(true);
    try {
      const task = await nexusApi.createTask({ title: title.trim(), projectId: project.id, taskListId: sectionId, priority, dueDate: dueDate || null, assigneeIds: assigneeIds.length ? assigneeIds : undefined });
      if (hasText(doc.current)) await nexusApi.saveTaskBody(task.id, doc.current).catch(() => toast.error(t("The task was created, but its description couldn't be saved.")));
      for (const [fid, v] of Object.entries(cf)) {
        const empty = Array.isArray(v) ? v.length === 0 : !String(v ?? "").trim();
        if (!empty) await nexusApi.setCustomFieldValue(fid, task.id, Array.isArray(v) ? JSON.stringify(v) : v).catch(() => undefined);
      }
      created.current = true;
      qc.invalidateQueries({ queryKey: ["nexus", "project", project.id] });
      qc.invalidateQueries({ queryKey: ["nexus", "project-calendar-tasks", project.id] });
      qc.invalidateQueries({ queryKey: ["nexus", "tasks"] });
      celebrate(t("Task created"));
      onClose();
    } catch (e) {
      toast.error(t("Couldn't create the task"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const row = "flex min-h-9 items-center gap-3 rounded-md px-1 text-sm";
  const labelCls = "flex w-28 shrink-0 items-center gap-1.5 text-muted-foreground";
  const fieldBtn = "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-sm transition-colors hover:bg-muted";
  const people = members.filter((m) => assigneeIds.includes(m.id));
  const current = sections.find((s) => s.id === sectionId);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t("Add task")} className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card text-card-foreground shadow-pop sm:max-w-xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-2 px-5 pb-1 pt-4">
          <span className="text-sm text-muted-foreground">{t("Add task")} · <span className="text-foreground">{project.name}</span></span>
          <button type="button" onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <input
            ref={titleRef}
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
            placeholder={t("Task name")}
            aria-label={t("Task name")}
            className="w-full bg-transparent py-1 text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60"
          />
          <div className="mt-3 space-y-0.5">
            <div className={row}>
              <span className={labelCls}><CircleDot className="h-4 w-4" />{t("Status")}</span>
              {statusOptions ? (
                <StatusPicker projectId={project.id} sections={sections} value={sectionId} onPick={setSectionId} trigger={<button type="button" className={fieldBtn}><StatusPill option={current} /></button>} />
              ) : (
                <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-sm">
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
            <div className={row}>
              <span className={labelCls}><Users className="h-4 w-4" />{t("Assignee")}</span>
              <PeoplePicker members={members} value={assigneeIds} onChange={setAssigneeIds} trigger={
                <button type="button" className={fieldBtn}>
                  {people.length === 0 ? <span className="text-muted-foreground">{t("Empty")}</span> : (
                    <>
                      <span className="flex -space-x-1.5">{people.slice(0, 4).map((u) => <Avatar key={u.id} userId={u.id} name={u.name} avatar={u.avatar} size={20} className="ring-2 ring-card" />)}</span>
                      <span className="max-w-48 truncate">{people.map((u) => u.name ?? u.email).join(", ")}</span>
                    </>
                  )}
                </button>
              } />
            </div>
            <div className={row}>
              <span className={labelCls}><Flag className="h-4 w-4" />{t("Priority")}</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value as CreateTaskPayload["priority"])} aria-label={t("Priority")} className="h-8 rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:bg-muted focus:border-border">
                {PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIORITY_TEXT[p])}</option>)}
              </select>
            </div>
            <div className={row}>
              <span className={labelCls}><Calendar className="h-4 w-4" />{t("Due date")}</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label={t("Due date")} lang={locale} className="h-8 rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:bg-muted focus:border-border" />
            </div>
            {fields.map((f) => {
              const type = (f.type || "").toUpperCase();
              const opts = choices(f);
              const val = cf[f.id];
              const set = (v: string | string[]) => setCf((p) => ({ ...p, [f.id]: v }));
              const input = "h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:bg-muted focus:border-border focus:outline-none";
              let control: React.ReactNode;
              if (type === "NUMBER") control = <input type="number" value={typeof val === "string" ? val : ""} onChange={(e) => set(e.target.value)} className={input} placeholder={t("Empty")} />;
              else if (type === "DATE") control = <input type="date" value={typeof val === "string" ? val : ""} onChange={(e) => set(e.target.value)} className={input} />;
              else if ((type === "SELECT" || type === "STATUS" || type === "DROPDOWN") && opts.length) control = (
                <select value={typeof val === "string" ? val : ""} onChange={(e) => set(e.target.value)} className={input}>
                  <option value="">{t("Empty")}</option>
                  {opts.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              );
              else if (type === "MULTI_SELECT" && opts.length) control = (
                <div className="flex flex-wrap gap-1">
                  {opts.map((c) => {
                    const arr = Array.isArray(val) ? val : [];
                    const on = arr.includes(c);
                    return <button key={c} type="button" aria-pressed={on} onClick={() => set(on ? arr.filter((x) => x !== c) : [...arr, c])} className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-[color:var(--accent-foreground)] bg-accent text-[color:var(--accent-foreground)]" : "border-border text-muted-foreground hover:bg-muted")}>{c}</button>;
                  })}
                </div>
              );
              else if (type === "FILE" || type === "PLACE" || type === "CREATED") control = <span className="text-xs text-muted-foreground">{t("Fill this in after creating the task.")}</span>;
              else control = <input type={type === "URL" ? "url" : "text"} value={typeof val === "string" ? val : ""} onChange={(e) => set(e.target.value)} className={input} placeholder={t("Empty")} />;
              return (
                <div key={f.id} className={row}>
                  <span className={labelCls}><span className="truncate">{f.name}</span></span>
                  {control}
                </div>
              );
            })}
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <BlockEditor
              roomKey={roomKey}
              initialDoc={saved?.doc ?? null}
              canEdit
              ctx={ctx}
              variant="embedded"
              placeholder={t("Add a description, or type / for blocks")}
              onRestSave={onRestSave}
              className="min-h-20"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span className="hidden text-xs text-muted-foreground sm:block">{t("Enter to create")}</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">{t("Cancel")}</button>
            <button type="button" disabled={!title.trim() || !sectionId || busy} onClick={() => void submit()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t("Create task")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pick people with avatars and search (the project's members). */
export function PeoplePicker({ members, value, onChange, trigger }: {
  members: Array<{ id: string; name?: string | null; email?: string | null; avatar?: string | null }>;
  value: string[]; onChange: (ids: string[]) => void; trigger: React.ReactNode;
}) {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const list = members.filter((m) => `${m.name ?? ""} ${m.email ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Popover onOpenChange={(o) => { if (!o) setQ(""); }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="relative border-b border-border p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search people…")} className="h-8 w-full rounded-md border border-border bg-card pl-7 pr-2 text-sm outline-none focus:border-[color:var(--accent-foreground)]" />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {list.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("No one matches.")}</p>}
          {list.map((m) => {
            const on = value.includes(m.id);
            return (
              <button key={m.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                <Avatar userId={m.id} name={m.name} avatar={m.avatar} size={22} className="ring-0" />
                <span className="min-w-0 flex-1 truncate">{m.name ?? m.email}</span>
                {on && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

