import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Users, Plus, Trash2, X, Loader2, FolderTree, Pencil, Check, Star, Crown, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { nexusApi, statusLabel, type NexusTeam, type NexusDivision } from "@/lib/nexus-api";
import { Reveal } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/teams")({ component: Teams });

const UNGROUPED = "__ungrouped__";

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function Teams() {
  const qc = useQueryClient();
  const teams = useQuery({ queryKey: ["nexus", "teams"], queryFn: nexusApi.teams, retry: false });
  const divisionsQ = useQuery({ queryKey: ["nexus", "divisions"], queryFn: nexusApi.divisions, retry: false });
  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false });
  const projectsQ = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false });
  const rows = teams.data ?? [];
  const divisions = divisionsQ.data ?? [];
  const myRole = wsm.data?.role ?? "STAFF";
  const canManage = myRole === "BOD" || myRole === "MANAGER" || myRole === "ONE_ABOVE_ALL";

  const [showDivisions, setShowDivisions] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["nexus", "teams"] });
  const create = useMutation({ mutationFn: (name: string) => nexusApi.createTeam(name), onSuccess: refresh });
  const newTeam = () => { const name = window.prompt("New team name:"); if (name?.trim()) create.mutate(name.trim()); };

  // Group teams by division. Real divisions come first (in stored order), then the
  // "Belum dikelompokin" bucket last.
  const byDivision = new Map<string, NexusTeam[]>();
  for (const t of rows) {
    const key = t.divisionId ?? UNGROUPED;
    const bucket = byDivision.get(key) ?? [];
    bucket.push(t);
    byDivision.set(key, bucket);
  }
  const ungrouped = byDivision.get(UNGROUPED) ?? [];
  // Sections: every real division (even empty ones, so managers can see/assign), then ungrouped.
  const sections = divisions
    .map((d) => ({ division: d, teams: byDivision.get(d.id) ?? [] }))
    .filter((s) => s.teams.length > 0 || canManage);

  return (
    <div>
      <PageHeader title="Teams" subtitle="Access groups: team members automatically get access to linked projects. Teams are grouped by division/company." />
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{rows.length} team{rows.length === 1 ? "" : "s"} · {divisions.length} division{divisions.length === 1 ? "" : "s"}{!canManage && " · view-only (need BoD/Manager to manage)"}</p>
          {canManage && (
            <div className="flex items-center gap-2">
              <button onClick={() => setShowDivisions((v) => !v)} className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-soft transition-all hover:bg-accent active:scale-[0.98]"><FolderTree className="h-4 w-4" /> Manage divisions</button>
              <button onClick={newTeam} disabled={create.isPending} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} New team</button>
            </div>
          )}
        </div>

        {canManage && showDivisions && <DivisionManager divisions={divisions} teams={rows} />}

        {(teams.isLoading || divisionsQ.isLoading) && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                <div className="flex items-center gap-2"><Skeleton className="h-10 w-10 rounded-2xl" /><Skeleton className="h-4 w-28" /></div>
                <Skeleton className="mt-4 h-3 w-16" /><Skeleton className="mt-2 h-8 w-40" />
              </div>
            ))}
          </div>
        )}
        {!teams.isLoading && rows.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">No teams yet</div><p className="mt-2 text-sm text-muted-foreground">{canManage ? "Create your first team to group your crew + project access." : "No teams in your workspace yet."}</p></div>
        )}

        {/* Grouped sections per division */}
        {sections.map(({ division, teams: divTeams }) => (
          <DivisionSection
            key={division.id}
            title={division.name}
            color={division.color ?? "#64748B"}
            teams={divTeams}
            divisions={divisions}
            canManage={canManage}
            allMembers={wsm.data?.members ?? []}
            allProjects={projectsQ.data ?? []}
            onChange={refresh}
          />
        ))}
        {ungrouped.length > 0 && (
          <DivisionSection
            title="Not grouped yet"
            color="#94A3B8"
            muted
            teams={ungrouped}
            divisions={divisions}
            canManage={canManage}
            allMembers={wsm.data?.members ?? []}
            allProjects={projectsQ.data ?? []}
            onChange={refresh}
          />
        )}
      </div>
    </div>
  );
}

function DivisionSection({ title, color, teams, divisions, canManage, allMembers, allProjects, onChange, muted }: {
  title: string;
  color: string;
  teams: NexusTeam[];
  divisions: NexusDivision[];
  canManage: boolean;
  allMembers: Array<{ userId: string; name: string }>;
  allProjects: Array<{ id: string; name: string; color?: string | null; status?: string | null }>;
  onChange: () => void;
  muted?: boolean;
}) {
  // Reorder team cards WITHIN this division: swap a card's `position` with the neighbour it moves past
  // (assign each other's index — positions within a division are a 0..n-1 permutation). Two rows change.
  const reorder = useMutation({
    mutationFn: ({ i, dir }: { i: number; dir: -1 | 1 }) => {
      const j = i + dir;
      if (j < 0 || j >= teams.length) return Promise.resolve();
      return Promise.all([nexusApi.reorderTeam(teams[i].id, j), nexusApi.reorderTeam(teams[j].id, i)]).then(() => {});
    },
    onSuccess: onChange,
  });
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 pt-2">
        <span className="h-3 w-3 rounded-full ring-2 ring-background" style={{ background: color }} />
        <h2 className={`text-sm font-bold uppercase tracking-wider ${muted ? "text-muted-foreground" : "text-foreground"}`}>{title}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">{teams.length}</span>
        <span className="ml-2 h-px flex-1 bg-border" />
      </div>
      {teams.length === 0 ? (
        <p className="text-xs text-muted-foreground">No teams in this division yet — move teams here using the dropdown on each card.</p>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t, i) => (
            <Reveal key={t.id} delay={Math.min(i, 8) * 0.05} className="h-full">
              <TeamCard
                team={t}
                canManage={canManage}
                divisions={divisions}
                allMembers={allMembers}
                allProjects={allProjects}
                onChange={onChange}
                onMoveLeft={canManage && i > 0 ? () => reorder.mutate({ i, dir: -1 }) : undefined}
                onMoveRight={canManage && i < teams.length - 1 ? () => reorder.mutate({ i, dir: 1 }) : undefined}
                reordering={reorder.isPending}
              />
            </Reveal>
          ))}
        </div>
      )}
    </section>
  );
}

function DivisionManager({ divisions, teams }: { divisions: NexusDivision[]; teams: NexusTeam[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["nexus", "divisions"] }); qc.invalidateQueries({ queryKey: ["nexus", "teams"] }); };
  const create = useMutation({ mutationFn: () => nexusApi.createDivision(name.trim()), onSuccess: () => { setName(""); refresh(); } });

  const countByDiv = new Map<string, number>();
  for (const t of teams) if (t.divisionId) countByDiv.set(t.divisionId, (countByDiv.get(t.divisionId) ?? 0) + 1);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft space-y-4">
      <div>
        <h3 className="font-semibold">Divisions / Companies</h3>
        <p className="text-xs text-muted-foreground">A layer above teams. Set the name & color, then move teams into their division using the dropdown on each card.</p>
      </div>
      <div className="flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) create.mutate(); }} placeholder="New division name…" className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        <button onClick={() => name.trim() && create.mutate()} disabled={!name.trim() || create.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add</button>
      </div>
      {create.isError && <p className="text-xs font-semibold text-destructive">{(create.error as Error)?.message ?? "Couldn't create division."}</p>}
      <div className="space-y-1.5">
        {divisions.length === 0 && <p className="text-xs text-muted-foreground">No divisions yet. Add one above.</p>}
        {divisions.map((d) => <DivisionRow key={d.id} division={d} count={countByDiv.get(d.id) ?? 0} onChange={refresh} />)}
      </div>
    </div>
  );
}

function DivisionRow({ division, count, onChange }: { division: NexusDivision; count: number; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(division.name);
  const [color, setColor] = useState(division.color ?? "#64748B");
  const update = useMutation({ mutationFn: (payload: { name?: string; color?: string }) => nexusApi.updateDivision({ divisionId: division.id, ...payload }), onSuccess: () => { setEditing(false); onChange(); } });
  const del = useMutation({ mutationFn: () => nexusApi.deleteDivision(division.id), onSuccess: onChange });

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} onBlur={() => { if (color !== (division.color ?? "#64748B")) update.mutate({ color }); }} className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0" title="Division color" />
      {editing ? (
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) update.mutate({ name: name.trim() }); if (e.key === "Escape") { setName(division.name); setEditing(false); } }} className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary" />
      ) : (
        <span className="flex-1 truncate text-sm font-semibold">{division.name}</span>
      )}
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">{count} team{count === 1 ? "" : "s"}</span>
      {editing ? (
        <button onClick={() => name.trim() && update.mutate({ name: name.trim() })} disabled={update.isPending} className="rounded-md p-1.5 text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-50" aria-label="Save">{update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</button>
      ) : (
        <button onClick={() => setEditing(true)} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent" aria-label="Rename"><Pencil className="h-3.5 w-3.5" /></button>
      )}
      <button onClick={() => { if (window.confirm(`Delete division "${division.name}"? Its teams stick around, they just won't belong to a division anymore.`)) del.mutate(); }} disabled={del.isPending} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" aria-label="Delete division">{del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
    </div>
  );
}

function TeamShiftControl({ team }: { team: NexusTeam }) {
  const qc = useQueryClient();
  const baseStart = team.attendanceShiftStartTime ?? "09:00";
  const baseEnd = team.attendanceShiftEndTime ?? "18:00";
  const [enabled, setEnabled] = useState(!!team.attendanceShiftOverrideEnabled);
  const [start, setStart] = useState(baseStart);
  const [end, setEnd] = useState(baseEnd);
  const save = useMutation({
    mutationFn: () => nexusApi.updateTeamShift(team.id, { attendanceShiftOverrideEnabled: enabled, attendanceShiftStartTime: enabled ? start : null, attendanceShiftEndTime: enabled ? end : null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "teams"] }),
  });
  const dirty = enabled !== !!team.attendanceShiftOverrideEnabled || (enabled && (start !== baseStart || end !== baseEnd));
  return (
    <div className="mt-4">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Team work hours</span>
      <label className="mt-1.5 flex items-center gap-2 text-xs font-semibold">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
        Use a custom shift just for this team
      </label>
      {enabled ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Clock in<input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs" /></label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Clock out<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs" /></label>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">Follows the workspace default hours.</p>
      )}
      {dirty && <button onClick={() => save.mutate()} disabled={save.isPending} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">{save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save hours</button>}
      {save.isError && <p className="mt-1 text-[11px] font-semibold text-destructive">Couldn't save — check the time format.</p>}
    </div>
  );
}

function TeamCard({ team, canManage, divisions, allMembers, allProjects, onChange, onMoveLeft, onMoveRight, reordering }: {
  team: NexusTeam;
  canManage: boolean;
  divisions: NexusDivision[];
  allMembers: Array<{ userId: string; name: string }>;
  allProjects: Array<{ id: string; name: string; color?: string | null; status?: string | null }>;
  onChange: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  reordering?: boolean;
}) {
  const members = team.members ?? [];
  const projects = (team.projects ?? []).map((p) => p.project).filter(Boolean);
  const memberIds = new Set(members.map((m) => m.userId || m.user?.id));
  const projectIds = new Set(projects.map((p) => p!.id));

  const addMember = useMutation({ mutationFn: (userId: string) => nexusApi.addTeamMember(team.id, userId), onSuccess: onChange });
  const removeMember = useMutation({ mutationFn: (userId: string) => nexusApi.removeTeamMember(team.id, userId), onSuccess: onChange });
  const linkProject = useMutation({ mutationFn: (projectId: string) => nexusApi.linkTeamProject(team.id, projectId), onSuccess: onChange });
  const unlinkProject = useMutation({ mutationFn: (projectId: string) => nexusApi.unlinkTeamProject(team.id, projectId), onSuccess: onChange });
  const setDivision = useMutation({ mutationFn: (divisionId: string | null) => nexusApi.setTeamDivision(team.id, divisionId), onSuccess: onChange });
  const setPrimary = useMutation({ mutationFn: (p: { userId: string; value: boolean }) => nexusApi.setTeamAttendancePrimary(team.id, p.userId, p.value), onSuccess: onChange });
  const setLead = useMutation({ mutationFn: (p: { userId: string; isLead: boolean }) => nexusApi.setTeamMemberRole(team.id, p.userId, p.isLead ? "LEAD" : "MEMBER"), onSuccess: onChange });
  const del = useMutation({ mutationFn: () => nexusApi.deleteTeam(team.id), onSuccess: onChange });
  const canManageAtt = team.canManageAttendanceSettings ?? canManage;

  // Inline team rename (BoD/Manager only), mirroring the division-row rename.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(team.name);
  const rename = useMutation({
    mutationFn: (name: string) => nexusApi.renameTeam(team.id, name),
    onSuccess: () => { setEditingName(false); onChange(); },
    onError: (e) => alert(e instanceof Error ? e.message : "Couldn’t rename this team."),
  });
  const commitRename = () => {
    const next = nameDraft.trim();
    if (!next || next === team.name) { setEditingName(false); setNameDraft(team.name); return; }
    rename.mutate(next);
  };

  // A-Z by name, case-insensitive + locale-aware, so a lowercase entry like "pangeran ali" sorts
  // under P instead of after every capitalised name. `nameCmp` is shared by the crew list and the
  // "+ Add member" dropdown so both read the same way.
  const nameCmp = (a: string, b: string) => (a || "").localeCompare(b || "", "id", { sensitivity: "base" });
  // Sorted COPY for display only — `members` still backs memberIds / the count, untouched.
  const sortedMembers = [...members].sort((a, b) => nameCmp(a.user?.name ?? "", b.user?.name ?? ""));
  const addableMembers = allMembers
    .filter((m) => !memberIds.has(m.userId))
    .sort((a, b) => nameCmp(a.name, b.name));
  const linkableProjects = allProjects
    .filter((p) => !projectIds.has(p.id))
    .sort((a, b) => nameCmp(a.name, b.name));

  // Searchable comboboxes (add-member, link-project): focus shows the full A-Z list, typing narrows
  // it. Replaces bare <select>s because a workspace can have dozens of people/projects and a native
  // dropdown has no way to filter.
  const [memberQuery, setMemberQuery] = useState("");
  const [memberOpen, setMemberOpen] = useState(false);
  const memberMatches = addableMembers.filter((m) =>
    (m.name || "").toLowerCase().includes(memberQuery.trim().toLowerCase()),
  );
  const [projectQuery, setProjectQuery] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const projectMatches = linkableProjects.filter((p) =>
    (p.name || "").toLowerCase().includes(projectQuery.trim().toLowerCase()),
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft transition-all hover:border-primary/30">
      {/* Title row: the name gets nearly the full card width (only icon + delete beside it) so it wraps
          cleanly between words instead of into a squeezed, mid-word-broken column. */}
      <div className="flex items-start gap-2">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Users className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1 pt-0.5">
          {editingName ? (
            <input
              value={nameDraft}
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setNameDraft(team.name); setEditingName(false); } }}
              onBlur={commitRename}
              disabled={rename.isPending}
              className="w-full rounded-md border border-border bg-background px-2 py-1 font-semibold tracking-tight outline-none focus:border-primary disabled:opacity-60"
            />
          ) : (
            <>
              <div className="flex items-start gap-1">
                <h3 className="min-w-0 break-words font-semibold leading-snug tracking-tight">{team.name}</h3>
                {canManage && <button onClick={() => { setNameDraft(team.name); setEditingName(true); }} className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/60 transition hover:bg-accent hover:text-foreground" aria-label="Rename team"><Pencil className="h-3.5 w-3.5" /></button>}
              </div>
              {/* Member count + reorder sit directly under the name (same column), so removing the old
                  "PATS Group" subtitle didn't leave a gap the height of the icon. */}
              <div className="mt-1.5 flex items-center gap-2">
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">{members.length} member{members.length === 1 ? "" : "s"}</span>
                {canManage && (onMoveLeft || onMoveRight) && (
                  <div className="ml-auto flex items-center">
                    <button onClick={onMoveLeft} disabled={!onMoveLeft || reordering} title="Geser ke kiri" aria-label="Geser ke kiri" className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground/60 transition hover:bg-accent hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"><ChevronLeft className="h-4 w-4" /></button>
                    <button onClick={onMoveRight} disabled={!onMoveRight || reordering} title="Geser ke kanan" aria-label="Geser ke kanan" className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground/60 transition hover:bg-accent hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"><ChevronRight className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {canManage && <button onClick={() => { if (window.confirm(`Delete team "${team.name}"?`)) del.mutate(); }} disabled={del.isPending} className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" aria-label="Delete team">{del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button>}
      </div>

      {canManage && (
        <div className="mt-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Division</span>
          <select
            value={team.divisionId ?? ""}
            onChange={(e) => setDivision.mutate(e.target.value || null)}
            disabled={setDivision.isPending}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-semibold outline-none focus:border-primary disabled:opacity-60"
          >
            <option value="">— No division —</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Crew</span>
          {canManageAtt && <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Star className="h-3 w-3 text-amber-500" /> = primary attendance team</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {sortedMembers.map((m) => {
            const uid = m.userId || m.user?.id || "";
            const isPrimary = !!m.isAttendancePrimary;
            return (
              <span key={uid} className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pl-0.5 pr-2 text-xs">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">{initialsOf(m.user?.name)}</span>
                <span className="max-w-[120px] truncate font-semibold" title={m.user?.name ?? ""}>{m.user?.name ?? "—"}</span>
                {m.role === "LEAD" && <span className="shrink-0 rounded bg-primary/15 px-1 text-[9px] font-black uppercase tracking-wide text-primary">Lead</span>}
                {canManage ? (
                  <button onClick={() => setLead.mutate({ userId: uid, isLead: m.role !== "LEAD" })} disabled={setLead.isPending} title={m.role === "LEAD" ? "Team lead (click to unset) — can view & approve this team's attendance" : "Make team lead — so they can view & approve this team's attendance"} className={cn("shrink-0 rounded-full p-0.5 transition", m.role === "LEAD" ? "text-primary" : "text-muted-foreground/40 hover:text-primary")}><Crown className={cn("h-3.5 w-3.5", m.role === "LEAD" && "fill-current")} /></button>
                ) : null}
                {canManageAtt ? (
                  <button onClick={() => setPrimary.mutate({ userId: uid, value: !isPrimary })} disabled={setPrimary.isPending} title={isPrimary ? "Their primary attendance team (click to unset)" : "Make this their primary attendance team"} className={cn("shrink-0 rounded-full p-0.5 transition", isPrimary ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-500")}><Star className={cn("h-3.5 w-3.5", isPrimary && "fill-current")} /></button>
                ) : isPrimary ? <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" /> : null}
                {canManage && <button onClick={() => removeMember.mutate(uid)} className="shrink-0 text-muted-foreground/50 transition hover:text-destructive" aria-label="Remove"><X className="h-3 w-3" /></button>}
              </span>
            );
          })}
          {members.length === 0 && <span className="text-xs text-muted-foreground">No members yet</span>}
        </div>
        {canManage && addableMembers.length > 0 && (
          <div className="relative mt-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={memberQuery}
                onChange={(e) => { setMemberQuery(e.target.value); setMemberOpen(true); }}
                onFocus={() => setMemberOpen(true)}
                // Delay so a click on an option registers before the list unmounts.
                onBlur={() => setTimeout(() => setMemberOpen(false), 120)}
                disabled={addMember.isPending}
                placeholder="Cari &amp; tambah member…"
                className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-xs font-semibold outline-none focus:border-primary"
              />
              {addMember.isPending && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            {memberOpen && (
              <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-pop">
                {memberMatches.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Nggak ada yang cocok.</div>
                ) : (
                  memberMatches.map((m) => (
                    <button
                      key={m.userId}
                      type="button"
                      // preventDefault keeps the input from blurring before onClick fires.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { addMember.mutate(m.userId); setMemberQuery(""); setMemberOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold hover:bg-accent"
                    >
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[8px] font-bold text-primary">{initialsOf(m.name)}</span>
                      <span className="truncate">{m.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {canManageAtt && <TeamShiftControl team={team} />}

      <div className="mt-4">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Projects · {projects.length}</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {projects.map((p) => (
            <span key={p!.id} className="group inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full" style={{ background: p!.color ?? "#7b68ee" }} /> {p!.name}
              {p!.status && <span className="text-muted-foreground/70">· {statusLabel(p!.status)}</span>}
              {canManage && <button onClick={() => unlinkProject.mutate(p!.id)} className="ml-0.5 hidden text-muted-foreground hover:text-destructive group-hover:inline" aria-label="Unlink"><X className="h-3 w-3" /></button>}
            </span>
          ))}
          {projects.length === 0 && <span className="text-xs text-muted-foreground">No projects yet</span>}
        </div>
        {canManage && linkableProjects.length > 0 && (
          <div className="relative mt-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={projectQuery}
                onChange={(e) => { setProjectQuery(e.target.value); setProjectOpen(true); }}
                onFocus={() => setProjectOpen(true)}
                onBlur={() => setTimeout(() => setProjectOpen(false), 120)}
                disabled={linkProject.isPending}
                placeholder="Cari &amp; link project…"
                className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-xs font-semibold outline-none focus:border-primary"
              />
              {linkProject.isPending && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            {projectOpen && (
              <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-pop">
                {projectMatches.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Nggak ada yang cocok.</div>
                ) : (
                  projectMatches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { linkProject.mutate(p.id); setProjectQuery(""); setProjectOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold hover:bg-accent"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? "#7b68ee" }} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {(addMember.isError || removeMember.isError || linkProject.isError || unlinkProject.isError || setDivision.isError || del.isError) && (
        <p className="mt-3 text-xs font-semibold text-destructive">Something didn't go through — check your access/connection.</p>
      )}
    </div>
  );
}
