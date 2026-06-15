import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CalendarX2, ChevronDown, Loader2, Megaphone, Plus, ScrollText, Search, Shield, Trash2, Trophy, Users as UsersIcon, X } from "lucide-react";
import { type NexusAdminAnnouncement } from "@/lib/nexus-api";
import { PageHeader } from "@/components/PageHeader";
import { ApiError, fmtDate, fmtTime, nexusApi, statusLabel, ORG_ROLE_LABEL, ORG_ROLE_TONE, assignableRoles, canEditTier, type OrgRole, type NexusAdminUser } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/admin")({ component: Admin });

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function Admin() {
  const qc = useQueryClient();
  const [view, setView] = useState<"users" | "audit" | "quests" | "announcements">("users");
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | "ONE_ABOVE_ALL" | "BOD" | "MANAGER" | "STAFF">("ALL");
  const [dayoffUser, setDayoffUser] = useState<{ id: string; name: string } | null>(null);
  const [delUser, setDelUser] = useState<{ id: string; name: string; email: string } | null>(null);
  const [redDateOpen, setRedDateOpen] = useState(false);
  const users = useQuery({ queryKey: ["nexus", "admin-users"], queryFn: () => nexusApi.adminUsersAll(), retry: false });
  // The editable "Role" here is the ORG role (One Above All/BoD/Manager/Staff) — what
  // people mean by "role".
  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false });
  const wsMembers = wsm.data?.members ?? [];
  const wsId = wsm.data?.workspaceId;
  const viewerRole = wsm.data?.role;
  const viewerAssignable = assignableRoles(viewerRole);
  const orgInfoByUser = new Map(wsMembers.map((m) => [m.userId, { memberId: m.id, role: m.role, shiftStart: m.attendanceShiftStartTime ?? null, shiftEnd: m.attendanceShiftEndTime ?? null, shiftByDay: m.attendanceShiftByDay ?? null }] as const));
  const orgCount = (role: string) => wsMembers.filter((m) => m.role === role).length;
  // Per-person shift (jam masuk/keluar) bisa diatur BoD ke atas, di sini di Members.
  const canManageShift = viewerRole === "BOD" || viewerRole === "ONE_ABOVE_ALL";
  // Permanent account deletion = BoD / One Above All only (backend also enforces). Plain Managers can't.
  const canDeleteUsers = viewerRole === "BOD" || viewerRole === "ONE_ABOVE_ALL";
  const updateOrg = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) => nexusApi.updateWorkspaceMember({ memberId, role: role as OrgRole, workspaceId: wsId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }),
  });
  const updateShift = useMutation({
    mutationFn: ({ memberId, start, end }: { memberId: string; start: string | null; end: string | null }) => nexusApi.updateWorkspaceMember({ memberId, attendanceShiftStartTime: start, attendanceShiftEndTime: end, workspaceId: wsId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }),
  });
  const updateShiftByDay = useMutation({
    mutationFn: ({ memberId, byDay }: { memberId: string; byDay: Record<string, { start: string; end: string }> }) => nexusApi.updateWorkspaceMember({ memberId, attendanceShiftByDay: byDay, workspaceId: wsId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }),
  });
  const allUsers = users.data?.users ?? [];
  const totalUsers = users.data?.total ?? allUsers.length;
  const rows = allUsers.filter((u) => {
    if (q && !((u.name ?? "").toLowerCase().includes(q.toLowerCase()) || (u.email ?? "").toLowerCase().includes(q.toLowerCase()))) return false;
    if (roleFilter !== "ALL" && (orgInfoByUser.get(u.id)?.role ?? "STAFF") !== roleFilter) return false;
    return true;
  });
  const toggleRole = (r: "ONE_ABOVE_ALL" | "BOD" | "MANAGER" | "STAFF") => setRoleFilter((cur) => (cur === r ? "ALL" : r));

  return (
    <div>
      <PageHeader title="Control Room" subtitle="Semua user + atur role org (One Above All › BoD › Manager › Staff)." />
      <div className="p-4 md:p-8 space-y-5">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5 w-fit">
          <button onClick={() => setView("users")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "users" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><UsersIcon className="h-3.5 w-3.5" /> Users</button>
          <button onClick={() => setView("audit")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "audit" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><ScrollText className="h-3.5 w-3.5" /> Audit log</button>
          <button onClick={() => setView("quests")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "quests" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><Trophy className="h-3.5 w-3.5" /> Quests</button>
          <button onClick={() => setView("announcements")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "announcements" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><Megaphone className="h-3.5 w-3.5" /> Pengumuman</button>
        </div>

        {view === "audit" && <AuditLog />}
        {view === "quests" && <AdminQuests />}
        {view === "announcements" && <AnnouncementsAdmin />}

        {view === "users" && users.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><Shield className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">Admin access required</div><p className="mt-2 text-sm text-muted-foreground">Butuh role system-admin untuk lihat user management.</p></div>}

        {view === "users" && !users.isError && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Total users" value={totalUsers} active={roleFilter === "ALL"} onClick={() => setRoleFilter("ALL")} />
              <Stat label="One Above All" value={orgCount("ONE_ABOVE_ALL")} active={roleFilter === "ONE_ABOVE_ALL"} onClick={() => toggleRole("ONE_ABOVE_ALL")} />
              <Stat label="BoD" value={orgCount("BOD")} active={roleFilter === "BOD"} onClick={() => toggleRole("BOD")} />
              <Stat label="Manager" value={orgCount("MANAGER")} active={roleFilter === "MANAGER"} onClick={() => toggleRole("MANAGER")} />
              <Stat label="Staff" value={orgCount("STAFF")} active={roleFilter === "STAFF"} onClick={() => toggleRole("STAFF")} />
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5 shrink-0" />
              <span>Hierarki role: <b className="text-foreground">One Above All › BoD › Manager › Staff</b>. Kamu cuma bisa kasih role yang di bawah level kamu.</span>
              <Link to="/settings" className="ml-auto font-semibold text-primary hover:underline">Buka juga di Members →</Link>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" />
              </div>
              {roleFilter !== "ALL" && (
                <button onClick={() => setRoleFilter("ALL")} className="inline-flex items-center gap-1.5 rounded-xl border border-primary bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
                  Filter: {ORG_ROLE_LABEL[roleFilter] ?? roleFilter} · {rows.length}
                  <span className="text-sm leading-none">×</span>
                </button>
              )}
              {canManageShift && (
                <button onClick={() => setRedDateOpen(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100">
                  <CalendarX2 className="h-3.5 w-3.5" /> Jatah Tanggal Merah
                </button>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
              {users.isLoading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5">User</th>
                    <th className="hidden px-4 py-2.5 md:table-cell">Joined</th>
                    <th className="px-4 py-2.5">Shift <span className="font-normal normal-case text-muted-foreground/70">(jam masuk–keluar)</span></th>
                    <th className="px-4 py-2.5">Day off</th>
                    <th className="px-4 py-2.5 text-right">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => {
                    const info = orgInfoByUser.get(u.id);
                    return <UserRow key={u.id} user={u} orgInfo={info} assignable={viewerAssignable} canEdit={!!info && canEditTier(viewerRole, info.role)} pending={updateOrg.isPending} onOrgRole={(role) => info && updateOrg.mutate({ memberId: info.memberId, role })} canManageShift={canManageShift} shiftPending={updateShift.isPending} onSaveShift={(start, end) => info && updateShift.mutate({ memberId: info.memberId, start, end })} shiftByDayPending={updateShiftByDay.isPending} onSaveShiftByDay={(byDay) => info && updateShiftByDay.mutate({ memberId: info.memberId, byDay })} onDayoff={() => setDayoffUser({ id: u.id, name: u.name || u.email || "User" })} canDelete={canDeleteUsers} isMember={!!info} onDelete={() => setDelUser({ id: u.id, name: u.name || "Unnamed", email: u.email ?? "" })} />;
                  })}
                </tbody>
              </table>
              {!users.isLoading && rows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">No users found.</div>}
            </div>
          </>
        )}
      </div>
      {dayoffUser && <DayoffModal user={dayoffUser} canEdit={canManageShift} onClose={() => setDayoffUser(null)} />}
      {delUser && <DeleteUserModal user={delUser} onClose={() => setDelUser(null)} />}
      {redDateOpen && <RedDateQuotaModal onClose={() => setRedDateOpen(false)} />}
    </div>
  );
}

// Monthly "tanggal merah" quota (jatah), company-wide, set by BoD per month. Default 0 until set,
// so staff can't request tanggal merah until BoD inputs the month's jatah.
function RedDateQuotaModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthLabel = new Date(`${monthKey}-01T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  const q = useQuery({ queryKey: ["nexus", "red-date-quota", monthKey], queryFn: () => nexusApi.redDateQuota(monthKey), retry: false });
  const [val, setVal] = useState("");
  useEffect(() => { if (q.data) setVal(String(q.data.quota)); }, [q.data]);
  const m = useMutation({
    mutationFn: (quota: number) => nexusApi.setRedDateQuota(monthKey, quota),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "red-date-quota", monthKey] }),
  });
  const n = parseInt(val, 10);
  const valid = Number.isInteger(n) && n >= 0 && n <= 31;
  const dirty = valid && q.data && n !== q.data.quota;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-base font-bold tracking-tight">Jatah Tanggal Merah — {monthLabel}</h2>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">Jatah <b className="text-foreground">tanggal merah</b> per staff buat bulan ini — berlaku sama ke semua staff. Di-input tiap bulan. Staff ajuin sendiri lewat "New request" di Attendance.</p>

        {q.isLoading ? (
          <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input type="number" inputMode="numeric" min={0} max={31} value={val} onChange={(e) => setVal(e.target.value)} placeholder="0" className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
            <span className="text-xs text-muted-foreground">hari / staff bulan ini</span>
            <button type="button" disabled={!dirty || m.isPending} onClick={() => m.mutate(n)} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
              {m.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Simpan"}
            </button>
          </div>
        )}
        {q.data && q.data.quota === 0 && <p className="mt-2 text-[11px] text-amber-600">Jatah masih 0 — staff belum bisa ajuin tanggal merah bulan ini sampai diisi.</p>}
      </div>
    </div>
  );
}

const WEEKDAYS: Array<[string, string]> = [["1", "Sen"], ["2", "Sel"], ["3", "Rab"], ["4", "Kam"], ["5", "Jum"], ["6", "Sab"], ["7", "Min"]];

function UserRow({ user, orgInfo, assignable, canEdit, onOrgRole, pending, canManageShift, shiftPending, onSaveShift, shiftByDayPending, onSaveShiftByDay, onDayoff, canDelete, isMember, onDelete }: { user: NexusAdminUser; orgInfo?: { memberId: string; role: string; shiftStart: string | null; shiftEnd: string | null; shiftByDay: Record<string, { start: string; end: string }> | null }; assignable: OrgRole[]; canEdit: boolean; onOrgRole: (role: string) => void; pending: boolean; canManageShift: boolean; shiftPending: boolean; onSaveShift: (start: string | null, end: string | null) => void; shiftByDayPending: boolean; onSaveShiftByDay: (byDay: Record<string, { start: string; end: string }>) => void; onDayoff: () => void; canDelete: boolean; isMember: boolean; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const byDay = orgInfo?.shiftByDay ?? {};
  const overrideCount = Object.keys(byDay).length;
  const saveDay = (wd: string, start: string | null, end: string | null) => {
    const next: Record<string, { start: string; end: string }> = { ...byDay };
    if (start && end) next[wd] = { start, end };
    else delete next[wd];
    onSaveShiftByDay(next);
  };
  return (
    <>
      <tr className="border-b border-border last:border-0 hover:bg-muted/20">
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-1 ring-border">{initialsOf(user.name)}</span>
            <div className="min-w-0">
              <div className="truncate font-semibold">{user.name || "Unnamed"}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">{user.joinedAt ? fmtDate(user.joinedAt) : ""}</td>
        <td className="px-4 py-3">
          {!orgInfo ? (
            <span className="text-xs text-muted-foreground/60">—</span>
          ) : (
            <div className="flex items-center gap-2">
              <ShiftCell start={orgInfo.shiftStart} end={orgInfo.shiftEnd} canEdit={canManageShift} pending={shiftPending} onSave={onSaveShift} />
              {canManageShift && (
                <button type="button" onClick={() => setExpanded((v) => !v)} title="Shift khusus per hari" className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-semibold transition", overrideCount > 0 ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                  {overrideCount > 0 ? `${overrideCount} hari` : "per-hari"}
                </button>
              )}
            </div>
          )}
        </td>
        <td className="px-4 py-3">
          {orgInfo && canManageShift ? (
            <button type="button" onClick={onDayoff} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground transition hover:border-primary hover:text-primary">
              <CalendarDays className="h-3.5 w-3.5" /> Atur
            </button>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            {!orgInfo ? (
              <span className="text-xs text-muted-foreground/60">bukan member</span>
            ) : canEdit ? (
              <select value={orgInfo.role} disabled={pending} onChange={(e) => onOrgRole(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-semibold outline-none focus:border-primary disabled:opacity-50">
                {[...assignable].reverse().map((r) => <option key={r} value={r}>{ORG_ROLE_LABEL[r]}</option>)}
              </select>
            ) : (
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", ORG_ROLE_TONE[orgInfo.role] ?? "bg-muted text-muted-foreground")}>{ORG_ROLE_LABEL[orgInfo.role] ?? orgInfo.role}</span>
            )}
            {canDelete && !isMember && (
              <button type="button" onClick={onDelete} title="Hapus akun permanen" className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 transition hover:bg-rose-100">
                <Trash2 className="h-3.5 w-3.5" /> Hapus
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && orgInfo && canManageShift && (
        <tr className="border-b border-border bg-muted/10">
          <td colSpan={5} className="px-4 py-3">
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">Shift khusus per hari <span className="font-normal text-muted-foreground/70">— kosongin = pakai shift default di atas. Cuma hari yang diisi yang beda.</span></div>
              <div className="space-y-1.5">
                {WEEKDAYS.map(([wd, label]) => (
                  <div key={wd} className="flex items-center gap-3">
                    <span className="w-9 shrink-0 text-xs font-bold text-muted-foreground">{label}</span>
                    <ShiftCell start={byDay[wd]?.start ?? null} end={byDay[wd]?.end ?? null} canEdit={canManageShift} pending={shiftByDayPending} onSave={(s, e) => saveDay(wd, s, e)} />
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Stored 24h "HH:MM" -> typed/display 12h "h:mm AM/PM".
function to12h(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const [hs, ms] = hhmm.split(":");
  let h = parseInt(hs, 10);
  if (Number.isNaN(h)) return "";
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${(ms ?? "00").padStart(2, "0")} ${ap}`;
}
// Typed text -> 24h "HH:MM" | null (empty) | "invalid". Accepts "9", "9:00", "9am", "9:00 AM",
// "09:00am", "2.30 pm", and 24h like "14:30"/"18".
function parse12h(raw: string): string | null | "invalid" {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?:[:.](\d{1,2}))?\s*([ap]\.?m\.?)?$/i);
  if (!m) return "invalid";
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (min > 59) return "invalid";
  const ap = m[3] ? m[3].toLowerCase().replace(/\./g, "") : "";
  if (h === 24 && min === 0) h = 0; // "24:00" = tengah malam
  if (ap && h >= 1 && h <= 12) {
    // 12-jam dengan AM/PM
    if (ap === "pm" && h !== 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
  }
  // Kalau jam udah pakai notasi 24-jam (>12) tapi user nambahin AM/PM, abaikan suffix-nya.
  if (h > 23) return "invalid";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// Per-person shift editor — typed input, shown as 12h with AM/PM. Both empty = inherit team/office
// shift. Both set = personal shift wins (effectiveShiftSource "USER"). Stored as 24h "HH:MM".
function ShiftCell({ start, end, canEdit, pending, onSave }: { start: string | null; end: string | null; canEdit: boolean; pending: boolean; onSave: (start: string | null, end: string | null) => void }) {
  const [s, setS] = useState(() => to12h(start));
  const [e, setE] = useState(() => to12h(end));
  useEffect(() => { setS(to12h(start)); setE(to12h(end)); }, [start, end]);

  if (!canEdit) {
    return start && end
      ? <span className="text-xs font-semibold tabular-nums">{to12h(start)} – {to12h(end)}</span>
      : <span className="text-xs text-muted-foreground/50">default</span>;
  }

  const ps = parse12h(s);
  const pe = parse12h(e);
  const badFmt = ps === "invalid" || pe === "invalid";
  const startVal = ps === "invalid" ? null : ps; // normalized 24h or null
  const endVal = pe === "invalid" ? null : pe;
  const dirty = startVal !== (start ?? null) || endVal !== (end ?? null);
  const partial = (!!startVal) !== (!!endVal); // exactly one set — need both or none
  const sameTime = !!startVal && !!endVal && startVal === endVal; // masuk == keluar → invalid
  const overnight = !!startVal && !!endVal && startVal > endVal; // lintas tengah malam (cth 15:00 → 00:00), didukung
  const invalid = badFmt || partial || sameTime;
  const hasShift = !!start && !!end;
  // On blur, snap a valid entry to canonical "h:mm AM/PM".
  const snap = (raw: string, set: (v: string) => void) => { const p = parse12h(raw); if (p && p !== "invalid") set(to12h(p)); };
  const inputCls = (bad: boolean) => cn("w-[6.75rem] rounded-md border bg-background px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-50", bad ? "border-rose-400 text-rose-600" : "border-border");

  return (
    <div className="flex items-center gap-1">
      <input type="text" inputMode="text" placeholder="09:00 AM" value={s} disabled={pending} onChange={(evt) => setS(evt.target.value)} onBlur={() => snap(s, setS)} className={inputCls(ps === "invalid")} />
      <span className="text-muted-foreground">–</span>
      <input type="text" inputMode="text" placeholder="06:00 PM" value={e} disabled={pending} onChange={(evt) => setE(evt.target.value)} onBlur={() => snap(e, setE)} className={inputCls(pe === "invalid")} />
      {overnight && <span title="Lintas tengah malam — jam keluar di hari berikutnya" role="img" aria-label="lintas tengah malam" className="ml-0.5 text-sm">🌙</span>}
      {dirty ? (
        <button
          type="button"
          disabled={pending || invalid}
          onClick={() => onSave(startVal, endVal)}
          title={badFmt ? "Format jam belum bener (cth: 09:00 AM)" : partial ? "Isi jam masuk & keluar dua-duanya" : sameTime ? "Jam masuk & keluar gak boleh sama" : overnight ? "Simpan shift (lintas tengah malam)" : "Simpan shift"}
          className="ml-0.5 rounded-md bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Simpan"}
        </button>
      ) : hasShift ? (
        <button type="button" disabled={pending} onClick={() => onSave(null, null)} title="Hapus shift (balik ke default)" className="ml-0.5 rounded-md border border-border px-1.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-accent hover:text-rose-600">×</button>
      ) : null}
    </div>
  );
}

// Editable monthly day-off quota per person (override the workspace default of 4).
function QuotaEditor({ userId, quota, override, defaultQuota }: { userId: string; quota: number; override: number | null; defaultQuota: number }) {
  const qc = useQueryClient();
  const [val, setVal] = useState(String(quota));
  useEffect(() => { setVal(String(quota)); }, [quota]);
  const m = useMutation({
    mutationFn: (qv: number | null) => nexusApi.setDayoffQuota(userId, qv),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "dayoffs", userId] }),
  });
  const n = parseInt(val, 10);
  const valid = Number.isInteger(n) && n >= 0 && n <= 366;
  const dirty = valid && n !== quota;

  return (
    <div className="mb-4 rounded-xl border border-border bg-muted/20 p-3">
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Jatah day-off / bulan</div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="number" min={0} max={366} value={val} onChange={(e) => setVal(e.target.value)} className="w-20 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-primary" />
        <span className="text-xs text-muted-foreground">hari / bulan</span>
        <button type="button" disabled={!dirty || m.isPending} onClick={() => m.mutate(n)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
          {m.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Simpan"}
        </button>
        {override !== null && <button type="button" disabled={m.isPending} onClick={() => m.mutate(null)} className="text-xs font-semibold text-muted-foreground transition hover:text-foreground hover:underline">Reset ke default ({defaultQuota})</button>}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{override === null ? `Pakai default workspace (${defaultQuota} hari).` : `Custom: ${override} hari (default ${defaultQuota}).`}</p>
    </div>
  );
}

// Per-user day-off editor (BoD only): set the monthly day-off quota (override the default 4).
function DayoffModal({ user, canEdit, onClose }: { user: { id: string; name: string }; canEdit: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ["nexus", "dayoffs", user.id], queryFn: () => nexusApi.userDayoffs(user.id), retry: false });
  const data = q.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-bold tracking-tight">Day off — {user.name}</h2>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        {q.isLoading && <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}

        {/* Jatah day-off per bulan — bisa diubah dari default (4). */}
        {canEdit && data && <QuotaEditor userId={user.id} quota={data.quota} override={data.quotaOverride} defaultQuota={data.defaultQuota} />}

        {data && (
          <p className="text-xs text-muted-foreground">
            Kepakai bulan ini: <b className="text-foreground">{data.used} / {data.quota}</b>
            {data.used > data.quota && <span className="ml-1 font-semibold text-amber-600">(lebih dari jatah)</span>}
          </p>
        )}
      </div>
    </div>
  );
}

// Permanent account deletion (BoD / One Above All). Reassigns the target's owned content to the
// acting admin, purges personal/ephemeral rows, then deletes. Requires typing HAPUS to confirm.
function DeleteUserModal({ user, onClose }: { user: { id: string; name: string; email: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const [confirmTxt, setConfirmTxt] = useState("");
  const m = useMutation({
    mutationFn: () => nexusApi.deleteUser(user.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["nexus", "admin-users"] }); },
  });
  const result = m.data;
  const err = m.error as ApiError | undefined;
  const ready = confirmTxt.trim().toUpperCase() === "HAPUS";
  const reassignedTotal = result ? Object.values(result.reassigned).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-bold tracking-tight text-rose-700">Hapus akun permanen</h2>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm">✅ Akun <b>{result.deletedUser.name}</b> <span className="text-muted-foreground">({result.deletedUser.email})</span> udah dihapus permanen.</p>
            {reassignedTotal > 0 && <p className="text-xs text-muted-foreground">{reassignedTotal} item (task/file/quest/portfolio) yang dia bikin dialihkan ke akun kamu biar gak ilang.</p>}
            <button onClick={onClose} className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90">Selesai</button>
          </div>
        ) : (
          <>
            <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <p>Kamu akan <b>menghapus permanen</b> akun:</p>
              <p className="mt-1 font-bold">{user.name} <span className="font-normal">· {user.email}</span></p>
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                <li>Task, file, quest, portfolio, goal, doc & jadwal yang dia bikin <b>dialihkan ke kamu</b> (gak ilang).</li>
                <li>Status update, undangan pending & jejak audit-nya dihapus. Komentar dia juga ikut kehapus.</li>
                <li>Tindakan ini <b>gak bisa di-undo</b>.</li>
              </ul>
            </div>
            <label className="block text-xs font-semibold text-muted-foreground">Ketik <b className="text-rose-700">HAPUS</b> buat konfirmasi
              <input autoFocus value={confirmTxt} onChange={(e) => setConfirmTxt(e.target.value)} placeholder="HAPUS" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-rose-400" />
            </label>
            {err && <p className="mt-2 text-xs font-semibold text-rose-600">{(err.payload as { message?: string } | undefined)?.message ?? err.message}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={onClose} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-accent">Batal</button>
              <button disabled={!ready || m.isPending} onClick={() => m.mutate()} className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-40">
                {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Hapus permanen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AuditLog() {
  const [q, setQ] = useState("");
  const logs = useQuery({ queryKey: ["nexus", "audit", q], queryFn: () => nexusApi.auditLogs(q.trim() ? `search=${encodeURIComponent(q.trim())}` : ""), retry: false });
  const rows = logs.data?.logs ?? [];
  return (
    <div className="space-y-4">
      {logs.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><ScrollText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">Audit access required</div><p className="mt-2 text-sm text-muted-foreground">Butuh role admin/owner untuk lihat audit log.</p></div>}
      {!logs.isError && (
        <>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search action, entity…" className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" />
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            {logs.isLoading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            <div className="divide-y divide-border">
              {rows.map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{statusLabel(l.action)}</span>
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold">{l.entityName || l.entityType}</span>
                    {l.entityType && l.entityName && <span className="text-muted-foreground"> · {l.entityType}</span>}
                  </div>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{l.user?.name ?? "system"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(l.createdAt)} {fmtTime(l.createdAt)}</span>
                </div>
              ))}
            </div>
            {!logs.isLoading && rows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">No audit entries.</div>}
          </div>
        </>
      )}
    </div>
  );
}

const REQ_TYPES = [
  { value: "task_count", label: "Complete N tasks" },
  { value: "overdue_cleared", label: "Clear N overdue" },
  { value: "priority_done", label: "Complete N Urgent" },
  { value: "has_overdue", label: "Punya ≥N task overdue (penalti)" },
];

function AdminQuests() {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false });
  const workspaceId = (projects.data ?? []).find((p) => p.workspaceId)?.workspaceId ?? "";
  const list = useQuery({ queryKey: ["nexus", "admin-quests", workspaceId], queryFn: () => nexusApi.adminQuests(workspaceId), enabled: !!workspaceId, retry: false });
  const rows = list.data?.quests ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "admin-quests", workspaceId] });

  const teamsQuery = useQuery({ queryKey: ["nexus", "teams"], queryFn: nexusApi.teams, retry: false });
  const teams = teamsQuery.data ?? [];
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id;

  const [title, setTitle] = useState("");
  const [requirementType, setRequirementType] = useState("task_count");
  const [requiredCount, setRequiredCount] = useState("5");
  const [xpReward, setXpReward] = useState("50");
  const [deadline, setDeadline] = useState("");
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const toggleTeam = (id: string) => setSelectedTeams((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const create = useMutation({
    mutationFn: () => nexusApi.createAdminQuest({ workspaceId, title: title.trim(), requirementType, requiredCount: Number(requiredCount), xpReward: Math.min(50, Math.max(0, Number(xpReward) || 0)), teamIds: Array.from(selectedTeams), deadline: deadline || null }),
    onSuccess: () => { setTitle(""); setDeadline(""); setSelectedTeams(new Set()); invalidate(); },
  });
  const del = useMutation({ mutationFn: (id: string) => nexusApi.deleteAdminQuest(id), onSuccess: invalidate });
  const inputCls = "rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className="space-y-4">
      {list.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><Trophy className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">Akses BoD diperlukan</div><p className="mt-2 text-sm text-muted-foreground">Butuh role BoD/Manager untuk kelola quest.</p></div>}
      {!list.isError && (
        <>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <h2 className="mb-1 font-display text-base font-bold tracking-tight">Assign quest baru</h2>
            <p className="mb-3 text-xs text-muted-foreground">Bikin quest buat crew: selesaikan task dengan target & deadline, hadiah XP (maks 50).</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Judul quest (cth: Selesaikan 5 task minggu ini)" className={cn(inputCls, "sm:col-span-2")} />
              <label className="text-xs font-semibold text-muted-foreground">Jenis
                <select value={requirementType} onChange={(e) => setRequirementType(e.target.value)} className={cn(inputCls, "mt-1 w-full font-normal")}>
                  {REQ_TYPES.filter((r) => r.value !== "penalty").map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-muted-foreground">Target (jumlah task)
                <input value={requiredCount} onChange={(e) => setRequiredCount(e.target.value.replace(/[^0-9]/g, ""))} className={cn(inputCls, "mt-1 w-full")} />
              </label>
              <label className="text-xs font-semibold text-muted-foreground">Deadline (jangka waktu)
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={cn(inputCls, "mt-1 w-full")} />
              </label>
              <label className="text-xs font-semibold text-muted-foreground">Hadiah XP (maks 50)
                <input type="number" min={0} max={50} value={xpReward} onChange={(e) => setXpReward(String(Math.min(50, Math.max(0, parseInt(e.target.value, 10) || 0))))} className={cn(inputCls, "mt-1 w-full")} />
              </label>
            </div>
            <div className="mt-3">
              <span className="text-xs font-semibold text-muted-foreground">Assign ke team <span className="font-normal">(pilih satu/lebih · kosong = semua crew)</span></span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {teams.length === 0 && <span className="text-xs text-muted-foreground">Belum ada team.</span>}
                {teams.map((t) => {
                  const on = selectedTeams.has(t.id);
                  return <button key={t.id} type="button" onClick={() => toggleTeam(t.id)} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}><span className="h-2 w-2 rounded-full" style={{ background: t.color ?? "#7b68ee" }} />{t.name}</button>;
                })}
              </div>
            </div>
            <button disabled={!title.trim() || !workspaceId || create.isPending} onClick={() => create.mutate()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Assign quest</button>
            {create.isError && <span className="ml-2 text-xs font-semibold text-destructive">Gagal — cek akses.</span>}
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            {list.isLoading && <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            <div className="divide-y divide-border">
              {rows.map((q) => (
                <div key={q.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Trophy className="h-4 w-4 shrink-0 text-warning-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{q.title}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{REQ_TYPES.find((r) => r.value === q.requirementType)?.label ?? q.requirementType} · target {q.requiredCount}</span>
                      <span className="font-bold text-success">+{q.xpReward} XP</span>
                      {q.deadline && <span>· ⏰ s/d {fmtDate(q.deadline)}</span>}
                      <span>· {q.teamIds && q.teamIds.length > 0 ? q.teamIds.map(teamName).join(", ") : "Semua crew"}</span>
                    </div>
                  </div>
                  <button onClick={() => { if (confirm("Hapus quest ini?")) del.mutate(q.id); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            {!list.isLoading && rows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">Belum ada quest. Bikin di atas.</div>}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, active, onClick }: { label: string; value: number; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-2xl border bg-card p-4 text-left shadow-soft transition-colors",
        onClick && "hover:border-primary/60 cursor-pointer",
        active ? "border-primary ring-1 ring-primary" : "border-border",
        !onClick && "cursor-default",
      )}
    >
      <div className="font-display text-2xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-xs font-medium text-muted-foreground">{label}</div>
    </button>
  );
}

function AnnouncementsAdmin() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["nexus", "announcements"], queryFn: () => nexusApi.announcements(), retry: false });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tone, setTone] = useState("info");
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["nexus", "announcements"] }); qc.invalidateQueries({ queryKey: ["announcements-active"] }); };
  const create = useMutation({ mutationFn: () => nexusApi.createAnnouncement({ title: title.trim(), body: body.trim(), tone }), onSuccess: () => { setTitle(""); setBody(""); setTone("info"); invalidate(); } });
  const toggle = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => nexusApi.updateAnnouncement(id, { active }), onSuccess: invalidate });
  const del = useMutation({ mutationFn: (id: string) => nexusApi.deleteAnnouncement(id), onSuccess: invalidate });
  const rows = list.data?.announcements ?? [];

  return (
    <div className="space-y-5">
      {list.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><Megaphone className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">Akses BoD diperlukan</div><p className="mt-2 text-sm text-muted-foreground">Butuh role BoD ke atas untuk kelola pengumuman.</p></div>}
      {!list.isError && (
        <>
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="text-sm font-bold">Buat pengumuman pop-up</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Judul pengumuman" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Isi pengumuman… (boleh beberapa baris)" className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <div className="flex flex-wrap items-center gap-2">
              <select value={tone} onChange={(e) => setTone(e.target.value)} className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="info">Info (biru)</option>
                <option value="success">Success (hijau)</option>
                <option value="warning">Warning (kuning)</option>
              </select>
              <button onClick={() => create.mutate()} disabled={!title.trim() || !body.trim() || create.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />} Posting
              </button>
              <span className="text-xs text-muted-foreground">Muncul sekali per user; bisa di-nonaktifin kapan aja.</span>
            </div>
          </div>

          <div className="space-y-2">
            {list.isLoading && <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            {rows.map((a: NexusAdminAnnouncement) => (
              <div key={a.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-soft">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold">{a.title}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", a.active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>{a.active ? "Aktif" : "Nonaktif"}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{a.tone}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{a.body}</p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{fmtDate(a.createdAt)} · dibaca {a.seenCount} orang</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => toggle.mutate({ id: a.id, active: !a.active })} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-accent">{a.active ? "Nonaktifin" : "Aktifin"}</button>
                  <button onClick={() => del.mutate(a.id)} aria-label="Hapus" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
            {!list.isLoading && rows.length === 0 && <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">Belum ada pengumuman.</div>}
          </div>
        </>
      )}
    </div>
  );
}
