import { useMemo, useRef, useState, type ReactNode } from "react";
import { SelectPicker } from "@/components/SelectPicker";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, ChevronDown, MoreHorizontal, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { nexusApi, type NexusTaskStatus } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { COLOR_KEYS, COLOR_PRESETS, normalizeColor, STATUS_COLOR } from "@/lib/project-views";
import { defaultOption, orderedOptions, statusForNewOption, statusGroupOf, STATUS_GROUPS, type StatusGroupKey, type StatusOption } from "@/lib/status-options";

/** The colour key a status option draws in: its own, else its group's. */
export function optionColorKey(o: Pick<StatusOption, "color" | "taskStatus"> | null | undefined): string {
  return normalizeColor(o?.color) ?? STATUS_COLOR[o?.taskStatus ?? "TODO"] ?? "gray";
}

/** A status as a Notion pill: tinted background, coloured dot, the option's name. */
export function StatusPill({ option, className, size = "sm" }: { option: Pick<StatusOption, "name" | "color" | "taskStatus"> | null | undefined; className?: string; size?: "sm" | "md" }) {
  const { t } = useLang();
  const c = COLOR_PRESETS[optionColorKey(option)];
  return (
    <span
      className={cn("inline-flex max-w-full shrink-0 items-center gap-1.5 truncate rounded-full font-medium leading-5", size === "md" ? "px-2.5 py-0.5 text-sm" : "px-2 text-xs", className)}
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.dot }} />
      <span className="truncate">{option?.name ?? t("No status")}</span>
    </span>
  );
}

type Section = StatusOption & { position?: number | null };

/**
 * The status picker (owner, 12 Oct 2026, Notion's): the project's status options grouped under To-do /
 * In progress / Complete, a search-or-create field on top, "+ Add option" under each group, and per
 * option rename, colour, move up/down, "set as default" and delete with "move tasks to…". Options ARE
 * the project's sections, so a new option is a new board column at once. Picking one moves the task
 * there (the server gives it that status).
 */
export function StatusPicker({ projectId, sections, value, onPick, canManage: canManageProp, trigger, align = "start", disabled }: {
  projectId: string;
  sections: Section[];
  value: string | null | undefined;
  onPick: (sectionId: string) => void;
  canManage?: boolean;
  trigger?: ReactNode;
  align?: "start" | "end";
  disabled?: boolean;
}) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // Adding / editing status options is Full access (owner 13 Oct 2026). Unless the caller says, follow the
  // project payload already cached by the page (viewerAccessLevel); unknown = allowed, as before.
  const cachedLevel = qc.getQueryData<{ viewerAccessLevel?: string }>(["nexus", "project", projectId])?.viewerAccessLevel;
  const canManage = canManageProp ?? (cachedLevel ? cachedLevel === "FULL" : true);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState<StatusGroupKey | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const options = useMemo(() => orderedOptions(sections), [sections]);
  const current = options.find((o) => o.id === value) ?? null;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["nexus", "project", projectId] });
    qc.invalidateQueries({ queryKey: ["nexus", "project-calendar-tasks", projectId] });
  };
  const fail = (e: unknown) => toast.error(t("Couldn't change the status options"), { description: e instanceof Error ? e.message : undefined });
  const create = useMutation({
    mutationFn: ({ name, group }: { name: string; group: StatusGroupKey }) => nexusApi.createSection(projectId, name, { taskStatus: statusForNewOption(group, name) as NexusTaskStatus }),
    onSuccess: (s, v) => { refresh(); setAdding(null); setQ(""); if (v.group && s?.id && pickAfterCreate.current) { onPick(s.id); setOpen(false); } pickAfterCreate.current = false; },
    onError: fail,
  });
  const pickAfterCreate = useRef(false);
  const update = useMutation({ mutationFn: (p: Parameters<typeof nexusApi.updateSection>[1]) => nexusApi.updateSection(projectId, p), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: ({ id, moveTo }: { id: string; moveTo: string }) => nexusApi.deleteSection(projectId, id, moveTo), onSuccess: refresh, onError: fail });

  const query = q.trim().toLowerCase();
  const exact = options.some((o) => o.name.toLowerCase() === query);
  const byGroup = STATUS_GROUPS.map((g) => ({ ...g, options: options.filter((o) => statusGroupOf(o.taskStatus) === g.key && (!query || o.name.toLowerCase().includes(query))) }));
  const def = defaultOption(options);

  const move = (o: Section, dir: -1 | 1) => {
    const same = options.filter((x) => statusGroupOf(x.taskStatus) === statusGroupOf(o.taskStatus));
    const i = same.findIndex((x) => x.id === o.id);
    const other = same[i + dir];
    if (other) update.mutate({ id: o.id, position: other.position ?? 0 });
  };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setQ(""); setAdding(null); setMenuFor(null); } }}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger ?? (
          <button type="button" disabled={disabled} className="inline-flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-muted disabled:opacity-60" aria-label={t("Status")}>
            <StatusPill option={current} />
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-0" onKeyDown={(e) => e.stopPropagation()}>
        <div className="border-b border-border p-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const hit = options.find((o) => o.name.toLowerCase() === query) ?? (byGroup.flatMap((g) => g.options)[0]);
              if (hit && (exact || !canManage)) { onPick(hit.id); setOpen(false); }
              else if (canManage && query) { pickAfterCreate.current = true; create.mutate({ name: q.trim(), group: "todo" }); }
            }}
            placeholder={canManage ? t("Search or create a status…") : t("Search statuses…")}
            className="h-8 w-full rounded-md border border-border bg-card px-2 text-sm outline-none focus:border-[color:var(--accent-foreground)]"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {byGroup.map((g) => (
            <div key={g.key} className="pb-1">
              <div className="flex items-center justify-between px-2 pb-0.5 pt-1.5 text-xs font-medium text-muted-foreground">
                <span>{t(g.label)}</span>
                {canManage && !query && (
                  <button type="button" onClick={() => setAdding(g.key)} aria-label={t("Add an option to {group}", { group: t(g.label) })} className="grid h-5 w-5 place-items-center rounded hover:bg-muted hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>
                )}
              </div>
              {g.options.map((o) => (
                <div key={o.id} className="group/opt relative flex items-center gap-1 rounded-md pr-1 hover:bg-muted">
                  <button type="button" onClick={() => { onPick(o.id); setOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left">
                    <StatusPill option={o} />
                    {def?.id === o.id && <span className="text-[11px] text-muted-foreground">{t("Default")}</span>}
                    {o.id === value && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
                  </button>
                  {canManage && (
                    <OptionMenu
                      option={o}
                      open={menuFor === o.id}
                      onOpenChange={(v) => setMenuFor(v ? o.id : null)}
                      others={options.filter((x) => x.id !== o.id)}
                      isDefault={def?.id === o.id}
                      onRename={(name) => update.mutate({ id: o.id, name })}
                      onColor={(color) => update.mutate({ id: o.id, color })}
                      onMove={(d) => move(o, d)}
                      onDefault={() => update.mutate({ id: o.id, position: 0 })}
                      onDelete={(moveTo) => remove.mutate({ id: o.id, moveTo })}
                    />
                  )}
                </div>
              ))}
              {adding === g.key && (
                <div className="px-2 py-1">
                  <input
                    autoFocus
                    placeholder={t("Option name")}
                    onKeyDown={(e) => {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (e.key === "Enter" && v) create.mutate({ name: v, group: g.key });
                      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAdding(null); }
                    }}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v) create.mutate({ name: v, group: g.key }); else setAdding(null); }}
                    className="h-7 w-full rounded-md border border-[color:var(--accent-foreground)] bg-card px-2 text-sm outline-none"
                  />
                </div>
              )}
              {canManage && !query && adding !== g.key && (
                <button type="button" onClick={() => setAdding(g.key)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground opacity-80 hover:bg-muted hover:text-foreground">
                  <Plus className="h-3 w-3" />{t("Add option")}
                </button>
              )}
            </div>
          ))}
          {canManage && query && !exact && (
            <button type="button" onClick={() => { pickAfterCreate.current = true; create.mutate({ name: q.trim(), group: "todo" }); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />{t("Create \"{name}\" in To-do", { name: q.trim() })}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OptionMenu({ option, open, onOpenChange, others, isDefault, onRename, onColor, onMove, onDefault, onDelete, onGroup, trigger, side = "right" }: {
  option: Section; open: boolean; onOpenChange: (v: boolean) => void; others: Section[]; isDefault: boolean;
  onRename: (name: string) => void; onColor: (c: string) => void; onMove: (d: -1 | 1) => void; onDefault: () => void; onDelete: (moveTo: string) => void;
  onGroup?: (status: NexusTaskStatus) => void; trigger?: ReactNode; side?: "right" | "bottom";
}) {
  const { t } = useLang();
  const [name, setName] = useState(option.name);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");
  const color = optionColorKey(option);
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-40";
  return (
    <Popover open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setDeleting(false); if (name.trim() && name.trim() !== option.name) onRename(name.trim()); } }}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button type="button" aria-label={t("Edit {name}", { name: option.name })} className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 pointer-coarse:opacity-100! transition-opacity hover:bg-card hover:text-foreground focus-visible:opacity-100 group-hover/opt:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent side={side} align={side === "bottom" ? "end" : "start"} className="w-60 p-1">
        {deleting ? (
          <div className="space-y-2 p-2">
            <p className="text-sm">{t("Delete \"{name}\"? Its tasks move to:", { name: option.name })}</p>
            <SelectPicker variant="field" value={moveTo} onChange={setMoveTo} ariaLabel={t("Move tasks to")} options={others.map((o) => ({ value: o.id, label: o.name, color: optionColorKey(o) }))} className="h-8 w-full bg-card px-2" />
            <div className="flex justify-end gap-1">
              <button type="button" onClick={() => setDeleting(false)} className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted">{t("Cancel")}</button>
              <button type="button" disabled={!moveTo} onClick={() => { onDelete(moveTo); onOpenChange(false); }} className="h-7 rounded-md bg-destructive px-2.5 text-xs font-medium text-destructive-foreground disabled:opacity-50">{t("Delete")}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-1">
              <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onOpenChange(false); }} aria-label={t("Option name")} className="h-8 w-full rounded-md border border-border bg-card px-2 text-sm outline-none focus:border-[color:var(--accent-foreground)]" />
            </div>
            <div className="grid grid-cols-9 gap-1 px-1.5 py-1.5" role="radiogroup" aria-label={t("Colour")}>
              {COLOR_KEYS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={color === k} aria-label={t(COLOR_PRESETS[k].label)} title={t(COLOR_PRESETS[k].label)} onClick={() => onColor(k)}
                  className={cn("h-5 w-5 rounded-full transition-transform hover:scale-110", color === k && "ring-2 ring-offset-1 ring-offset-popover")} style={{ backgroundColor: COLOR_PRESETS[k].bg, boxShadow: `inset 0 0 0 1.5px ${COLOR_PRESETS[k].dot}`, ...(color === k ? { ["--tw-ring-color" as string]: COLOR_PRESETS[k].dot } : {}) }} />
              ))}
            </div>
            {onGroup && (
              <label className="flex items-center justify-between gap-2 px-2 py-1 text-sm">
                <span className="text-muted-foreground">{t("Group")}</span>
                <SelectPicker
                  variant="field"
                  size="sm"
                  align="end"
                  value={option.taskStatus ?? ""}
                  onChange={(v) => onGroup(v as NexusTaskStatus)}
                  ariaLabel={t("Group")}
                  options={[
                    ...(!option.taskStatus ? [{ value: "", label: t("None") }] : []),
                    { value: "TODO", label: t("To-do") },
                    { value: "IN_PROGRESS", label: t("In progress") },
                    { value: "IN_REVIEW", label: t("In progress · review") },
                    { value: "DONE", label: t("Complete") },
                    { value: "CANCELLED", label: t("Complete · cancelled") },
                  ]}
                  className="h-7 rounded-md bg-card px-1.5 text-sm"
                />
              </label>
            )}
            <div className="my-1 border-t border-border" />
            <button type="button" className={item} onClick={() => onMove(-1)}><ArrowUp className="h-3.5 w-3.5 text-muted-foreground" />{t("Move up")}</button>
            <button type="button" className={item} onClick={() => onMove(1)}><ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />{t("Move down")}</button>
            {statusGroupOf(option.taskStatus) === "todo" && <button type="button" disabled={isDefault} className={item} onClick={() => { onDefault(); onOpenChange(false); }}><Star className="h-3.5 w-3.5 text-muted-foreground" />{isDefault ? t("Default for new tasks") : t("Set as default")}</button>}
            <button type="button" disabled={others.length === 0} className={cn(item, "text-destructive")} onClick={() => setDeleting(true)}><Trash2 className="h-3.5 w-3.5" />{t("Delete option")}</button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The ••• menu of a board column / list group header: the same option editor as the picker (rename,
 * colour, group, move, default, delete with "move tasks to…"), wired to the section API.
 */
export function StatusOptionMenu({ projectId, option, sections, trigger }: { projectId: string; option: Section; sections: Section[]; trigger: ReactNode }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["nexus", "project", projectId] });
    qc.invalidateQueries({ queryKey: ["nexus", "project-calendar-tasks", projectId] });
  };
  const fail = (e: unknown) => toast.error(t("Couldn't change the status options"), { description: e instanceof Error ? e.message : undefined });
  const update = useMutation({ mutationFn: (p: Parameters<typeof nexusApi.updateSection>[1]) => nexusApi.updateSection(projectId, p), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: (moveTo: string) => nexusApi.deleteSection(projectId, option.id, moveTo), onSuccess: refresh, onError: fail });
  const options = orderedOptions(sections);
  const same = options.filter((x) => statusGroupOf(x.taskStatus) === statusGroupOf(option.taskStatus));
  const i = same.findIndex((x) => x.id === option.id);
  return (
    <OptionMenu
      option={option}
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      side="bottom"
      others={options.filter((x) => x.id !== option.id)}
      isDefault={defaultOption(options)?.id === option.id}
      onRename={(name) => update.mutate({ id: option.id, name })}
      onColor={(color) => update.mutate({ id: option.id, color })}
      onGroup={(taskStatus) => update.mutate({ id: option.id, taskStatus })}
      onMove={(d) => { const other = same[i + d]; if (other) update.mutate({ id: option.id, position: other.position ?? 0 }); }}
      onDefault={() => update.mutate({ id: option.id, position: 0 })}
      onDelete={(moveTo) => remove.mutate(moveTo)}
    />
  );
}
