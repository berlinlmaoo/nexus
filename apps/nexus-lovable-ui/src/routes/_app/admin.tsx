import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Avatar } from "@/components/Avatar";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, CalendarDays, CalendarPlus, CalendarX2, ChevronDown, FileText, FolderKanban, GitBranch, Network, Link2, Link2Off, Loader2, Megaphone, Paperclip, Plus, ScrollText, Search, Settings2, Shield, ShieldAlert, Trash2, Trophy, Users as UsersIcon, X, Zap, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { ApprovalChart } from "@/components/ApprovalChart";
import { OrgChart } from "@/components/OrgChart";
import { type NexusAdminAnnouncement, type NexusDayOffBonus } from "@/lib/nexus-api";
import { GideonMark } from "@/components/gideon/GideonMark";
import { PageHeader } from "@/components/PageHeader";
import { ApiError, fmtDate, fmtTime, nexusApi, statusLabel, ORG_ROLE_LABEL, ORG_ROLE_TONE, assignableRoles, canEditTier, type OrgRole, type NexusAdminUser, type GoogleWorkspaceAccount, type NexusUserMemberships, type NexusTeam } from "@/lib/nexus-api";
// Crew Hub tidak punya halaman lagi. Pengaturan TIM-nya sendiri — nama, divisi, jam shift,
// tautan project, hapus — dibuka dari chip tim di baris ORANGNYA, memakai kartu yang sama
// persis seperti dulu. Tidak ada tim yang jadi tak terjangkau: ke-21 tim punya minimal satu
// anggota, jadi semuanya bisa diraih dari daftar ini.
import { TeamCard, DivisionManager } from "./teams";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { AuditLogView } from "@/components/audit/AuditLogView";
import { SuspectAttendanceAdmin } from "@/components/attendance/SuspectAttendanceAdmin";

export const Route = createFileRoute("/_app/admin")({ component: Admin });

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function Admin() {
  const qc = useQueryClient();
  const [view, setView] = useState<"users" | "approval" | "org" | "extra-dayoff" | "suspects" | "audit" | "quests" | "announcements" | "gideon" | "app">("users");
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | "ONE_ABOVE_ALL" | "BOD" | "MANAGER" | "STAFF">("ALL");
  const [dayoffUser, setDayoffUser] = useState<{ id: string; name: string } | null>(null);
  const [delUser, setDelUser] = useState<{ id: string; name: string; email: string } | null>(null);
  const [redDateOpen, setRedDateOpen] = useState(false);
  // Satu modal untuk seluruh tabel, bukan satu per baris. Mengeluarkan orang dari tim MENCABUT
  // akses ke semua project yang ditautkan ke tim itu (src/lib/team-sync.ts), dan sebuah "x" kecil
  // yang diam-diam mencabut sembilan akses sekaligus bukan tombol yang pantas tanpa pertanyaan.
  const [teamExit, setTeamExit] = useState<{ userId: string; userName: string; teamId: string; teamName: string; losing: string[] } | null>(null);
  // Tim yang sedang dibuka pengaturannya. Menyimpan ID saja, bukan objeknya: kartu itu
  // menulis ke tim yang sama, dan salinan basi di state akan menggambar nama lama setelah
  // di-rename.
  const [teamSettingsId, setTeamSettingsId] = useState<string | null>(null);
  const [divisionsOpen, setDivisionsOpen] = useState(false);
  const users = useQuery({ queryKey: ["nexus", "admin-users"], queryFn: () => nexusApi.adminUsersAll(), retry: false });
  // The editable "Role" here is the ORG role (One Above All/BoD/Manager/Staff) — what
  // people mean by "role".
  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false });
  const wsMembers = wsm.data?.members ?? [];
  const wsId = wsm.data?.workspaceId;
  const viewerRole = wsm.data?.role;
  const viewerAssignable = assignableRoles(viewerRole);
  const orgInfoByUser = new Map(wsMembers.map((m) => [m.userId, { memberId: m.id, role: m.role, shiftStart: m.attendanceShiftStartTime ?? null, shiftEnd: m.attendanceShiftEndTime ?? null, shiftByDay: m.attendanceShiftByDay ?? null, flexi: m.flexiTimeEnabled ?? false, noGeofence: m.noGeofenceMode ?? false, approverName: m.approver?.name ?? null }] as const));
  const orgCount = (role: string) => wsMembers.filter((m) => m.role === role).length;
  // Per-person shift (jam masuk/keluar) bisa diatur BoD ke atas, di sini di Members.
  const canManageShift = viewerRole === "BOD" || viewerRole === "ONE_ABOVE_ALL";
  // Tim boleh diatur Manager ke atas — itu aturan yang dipakai Crew Hub sebelum dibubarkan
  // (/api/teams: BOD | MANAGER | ONE_ABOVE_ALL). Menyamakannya dengan hak atur shift akan
  // diam-diam mencabut kemampuan Manager yang selama ini mereka punya. Server tetap memeriksa
  // ulang per tim lewat `canManage`, jadi ini hanya menentukan apa yang digambar.
  const canManageTeamsOrg = canManageShift || viewerRole === "MANAGER";
  // Permanent account deletion = BoD / One Above All only (backend also enforces). Plain Managers can't.
  const canDeleteUsers = viewerRole === "BOD" || viewerRole === "ONE_ABOVE_ALL";
  // The same rule the server enforces in isBoD(). A MANAGER shown the compose form only ever gets a
  // 403 back, which reads as a broken page rather than a permission they do not have.
  const canAnnounce = viewerRole === "BOD" || viewerRole === "ONE_ABOVE_ALL";
  const updateOrg = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) => nexusApi.updateWorkspaceMember({ memberId, role: role as OrgRole, workspaceId: wsId }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] });
      qc.invalidateQueries({ queryKey: ["nexus", "approval-chart"] });
      // Manager yang diturunkan melepas semua bawahannya di Bagan Approval. Sebut namanya —
      // request mereka sekarang jatuh ke BoD, dan diam di sini berarti BoD menemukannya sendiri
      // lewat notifikasi yang tiba-tiba bertambah.
      if (r.orphaned && r.orphaned.length > 0) {
        toast.warning(`${r.orphaned.length} orang kehilangan approver`, {
          description: r.orphaned.map((o) => o.name ?? "?").join(", ") + " — taruh ulang di tab Bagan Approval.",
          duration: 12_000,
        });
      }
    },
  });
  const updateShift = useMutation({
    mutationFn: ({ memberId, start, end }: { memberId: string; start: string | null; end: string | null }) => nexusApi.updateWorkspaceMember({ memberId, attendanceShiftStartTime: start, attendanceShiftEndTime: end, workspaceId: wsId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }),
  });
  const updateShiftByDay = useMutation({
    mutationFn: ({ memberId, byDay }: { memberId: string; byDay: Record<string, { start: string; end: string }> }) => nexusApi.updateWorkspaceMember({ memberId, attendanceShiftByDay: byDay, workspaceId: wsId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }),
  });
  const updateFlexi = useMutation({
    mutationFn: ({ memberId, flexi }: { memberId: string; flexi: boolean }) => nexusApi.updateWorkspaceMember({ memberId, flexiTimeEnabled: flexi, workspaceId: wsId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }),
  });
  const updateGeofence = useMutation({
    mutationFn: ({ memberId, on }: { memberId: string; on: boolean }) => nexusApi.updateWorkspaceMember({ memberId, noGeofenceMode: on, workspaceId: wsId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }),
  });
  // Sekali per halaman, bukan sekali per baris: 49 baris x satu panggilan Directory akan
  // menghabiskan kuota Google dan membuat layar ini terbuka dalam hitungan detik.
  // `staleTime` panjang karena daftar akun Workspace nyaris tidak pernah berubah dalam satu sesi.
  const gwAccounts = useQuery({
    queryKey: ["nexus", "google-workspace-accounts"],
    queryFn: () => nexusApi.googleWorkspaceAccounts(),
    enabled: canDeleteUsers,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Sekali per halaman, sama seperti daftar akun Google di atas. Isinya berubah hanya saat ada
  // yang dipindah tim atau project, jadi `staleTime` panjang aman dan menghemat 49 kali query.
  const memberships = useQuery({
    queryKey: ["nexus", "admin-user-memberships"],
    queryFn: () => nexusApi.adminUserMemberships(),
    staleTime: 2 * 60_000,
    retry: false,
  });

  // Daftar tim untuk pemilih "+ tim" di tiap baris. Hanya diambil kalau viewer-nya memang
  // boleh mengubah keanggotaan — Staff yang membuka Control Room tidak perlu 21 baris tim.
  const teamsQ = useQuery({ queryKey: ["nexus", "teams"], queryFn: nexusApi.teams, enabled: canManageTeamsOrg, staleTime: 5 * 60_000, retry: false });
  // Dipakai kartu pengaturan tim: pilihan divisi, daftar orang yang bisa ditambahkan, dan
  // daftar project yang bisa ditautkan. Diambil hanya kalau viewer-nya memang bisa mengatur.
  const divisionsQ = useQuery({ queryKey: ["nexus", "divisions"], queryFn: nexusApi.divisions, enabled: canManageTeamsOrg, staleTime: 5 * 60_000, retry: false });
  const projectsQ = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, enabled: canManageTeamsOrg, staleTime: 5 * 60_000, retry: false });
  const openTeam = (teamsQ.data ?? []).find((t) => t.id === teamSettingsId) ?? null;
  const refreshMemberships = () => {
    qc.invalidateQueries({ queryKey: ["nexus", "admin-user-memberships"] });
    qc.invalidateQueries({ queryKey: ["nexus", "teams"] });
    qc.invalidateQueries({ queryKey: ["nexus", "divisions"] });
  };
  // Keanggotaan project LANGSUNG (source "direct") — beda dari yang lewat tim. Yang lewat tim
  // tidak bisa dilepas dari sini; sinkronisasi tim akan menuliskannya lagi.
  const addToProject = useMutation({
    mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) => nexusApi.addProjectMember(projectId, userId),
    onSuccess: refreshMemberships,
    onError: (e: unknown) => toast.error("Gagal menambahkan ke project", { description: e instanceof ApiError ? e.message : "Butuh akses LEAD di project itu." }),
  });
  const removeFromProject = useMutation({
    mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) => nexusApi.removeProjectMember(projectId, userId),
    onSuccess: refreshMemberships,
    onError: (e: unknown) => toast.error("Gagal melepas dari project", { description: e instanceof ApiError ? e.message : "Butuh akses LEAD di project itu." }),
  });
  const addToTeam = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => nexusApi.addTeamMember(teamId, userId),
    onSuccess: refreshMemberships,
  });
  const removeFromTeam = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => nexusApi.removeTeamMember(teamId, userId),
    onSuccess: refreshMemberships,
  });

  // Akun yang mendaftar sendiri tanpa kode workspace: terdaftar, tapi tidak di mana pun.
  // POST /api/workspaces/members menemukan user-nya lewat email dan membuat keanggotaannya;
  // tidak membuat akun baru, karena akunnya sudah ada.
  const joinWorkspace = useMutation({
    // absorbPersonalWorkspace: daftar tanpa kode = dapat workspace pribadi, dan workspace aktif
    // dipilih dari joinedAt tertua. Tanpa memindahkannya, dia "masuk" tapi tetap mendarat di
    // workspace pribadinya.
    mutationFn: (email: string) => nexusApi.inviteWorkspaceMember({ email, role: "STAFF", workspaceId: wsId, absorbPersonalWorkspace: true }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["nexus", "admin-users"] });
      qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] });
      qc.invalidateQueries({ queryKey: ["nexus", "approval-chart"] });
      const moved = r.absorbed?.length ? ` · workspace pribadi "${r.absorbed[0]}" dihapus` : "";
      toast.success(`${r.member?.name ?? "Akun"} masuk sebagai Staff${moved}`, { description: "Taruh di bawah manager-nya di Bagan Approval." });
      if (r.kept?.length) toast.warning("Masih punya workspace lain yang tidak kosong", { description: r.kept.join(", ") + " — dibiarkan. Dia bisa mendarat di sana, bukan di sini." });
      if (r.emailSent === false) toast.warning("Email pemberitahuan tidak terkirim", { description: "Dia sudah masuk workspace, tapi belum tahu. Kabari sendiri." });
    },
    onError: (e: unknown) => toast.error("Gagal memasukkan", { description: e instanceof ApiError ? e.message : "Coba lagi." }),
  });
  const workspaceName = wsm.data?.workspaceName ?? "Z Networks";

  const allUsers = users.data?.users ?? [];
  const totalUsers = users.data?.total ?? allUsers.length;
  // A–Z, peka lokal (huruf kecil tidak jatuh ke bawah), dan yang belum masuk workspace di paling
  // bawah — mereka butuh tindakan, dan tindakan lebih mudah ditemukan di satu kelompok.
  const nameCmp = (a: string, b: string) => a.localeCompare(b, "id", { sensitivity: "base" });
  const rows = allUsers.filter((u) => {
    if (q && !((u.name ?? "").toLowerCase().includes(q.toLowerCase()) || (u.email ?? "").toLowerCase().includes(q.toLowerCase()))) return false;
    if (roleFilter !== "ALL" && (orgInfoByUser.get(u.id)?.role ?? "STAFF") !== roleFilter) return false;
    return true;
  }).sort((a, b) => {
    const am = orgInfoByUser.has(a.id) ? 0 : 1;
    const bm = orgInfoByUser.has(b.id) ? 0 : 1;
    return am - bm || nameCmp(a.name || a.email || "", b.name || b.email || "");
  });
  const toggleRole = (r: "ONE_ABOVE_ALL" | "BOD" | "MANAGER" | "STAFF") => setRoleFilter((cur) => (cur === r ? "ALL" : r));

  return (
    <div>
      <PageHeader title="Control Room" subtitle="Everyone + manage org roles (One Above All › BoD › Manager › Staff)." />
      <div className="p-4 md:p-8 space-y-5">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5 w-fit">
          <button onClick={() => setView("users")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "users" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><UsersIcon className="h-3.5 w-3.5" /> Users</button>
          {canAnnounce && <button onClick={() => setView("approval")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "approval" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><GitBranch className="h-3.5 w-3.5" /> Bagan Approval</button>}
          {canAnnounce && <button onClick={() => setView("org")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "org" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><Network className="h-3.5 w-3.5" /> Bagan IP &amp; Divisi</button>}
          {canManageShift && <button onClick={() => setView("extra-dayoff")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "extra-dayoff" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><CalendarPlus className="h-3.5 w-3.5" /> Extra day off</button>}
          {canManageShift && <button onClick={() => setView("suspects")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "suspects" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><ShieldAlert className="h-3.5 w-3.5" /> Absen Monitor</button>}
          <button onClick={() => setView("audit")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "audit" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><ScrollText className="h-3.5 w-3.5" /> Audit log</button>
          <button onClick={() => setView("quests")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "quests" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><Trophy className="h-3.5 w-3.5" /> Quests</button>
          {canAnnounce && <button onClick={() => setView("announcements")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "announcements" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><Megaphone className="h-3.5 w-3.5" /> Announcements</button>}
          {canAnnounce && <button onClick={() => setView("gideon")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "gideon" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><GideonMark className="h-3.5 w-3.5" /> GIDEON</button>}
          {canAnnounce && <button onClick={() => setView("app")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "app" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><Smartphone className="h-3.5 w-3.5" /> Aplikasi</button>}
        </div>

        {view === "approval" && canAnnounce && <ApprovalChart />}
        {view === "org" && canAnnounce && <OrgChart />}
        {view === "extra-dayoff" && canManageShift && <ExtraDayOffAdmin members={wsMembers} />}
        {view === "suspects" && canManageShift && <SuspectAttendanceAdmin />}
        {view === "audit" && <AuditLog />}
        {view === "quests" && <AdminQuests />}
        {view === "announcements" && canAnnounce && <AnnouncementsAdmin />}
        {view === "gideon" && canAnnounce && <GideonUsage />}
        {view === "app" && canAnnounce && <AppInstalls />}

        {view === "users" && users.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><Shield className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">Admin access required</div><p className="mt-2 text-sm text-muted-foreground">You need the system-admin role to view user management.</p></div>}

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
              <span>Role hierarchy: <b className="text-foreground">One Above All › BoD › Manager › Staff</b>. You can only assign roles below your own level.</span>
              <Link to="/settings" className="ml-auto font-semibold text-primary hover:underline">Also open in Members →</Link>
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
                  <CalendarX2 className="h-3.5 w-3.5" /> Holiday Quota
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
                    <th className="px-4 py-2.5">Absensi</th>
                    <th className="px-4 py-2.5 text-right">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => {
                    const info = orgInfoByUser.get(u.id);
                    return <UserRow key={u.id} user={u} orgInfo={info} assignable={viewerAssignable} canEdit={!!info && canEditTier(viewerRole, info.role)} pending={updateOrg.isPending} onOrgRole={(role) => info && updateOrg.mutate({ memberId: info.memberId, role })} canManageShift={canManageShift} shiftPending={updateShift.isPending} onSaveShift={(start, end) => info && updateShift.mutate({ memberId: info.memberId, start, end })} shiftByDayPending={updateShiftByDay.isPending} onSaveShiftByDay={(byDay) => info && updateShiftByDay.mutate({ memberId: info.memberId, byDay })} flexiPending={updateFlexi.isPending} onToggleFlexi={() => info && updateFlexi.mutate({ memberId: info.memberId, flexi: !info.flexi })} geofencePending={updateGeofence.isPending} onToggleGeofence={() => info && updateGeofence.mutate({ memberId: info.memberId, on: !info.noGeofence })} onDayoff={() => setDayoffUser({ id: u.id, name: u.name || u.email || "User" })} canDelete={canDeleteUsers} isMember={!!info} onDelete={() => setDelUser({ id: u.id, name: u.name || "Unnamed", email: u.email ?? "" })} gwConfigured={gwAccounts.data?.configured ?? false} gwAccounts={gwAccounts.data?.accounts ?? []} gwDomains={gwAccounts.data?.domains ?? []} canLinkGoogle={canDeleteUsers} memberships={memberships.data?.byUser[u.id]} membershipsLoading={memberships.isLoading} allTeams={teamsQ.data ?? []} canManageTeams={canManageTeamsOrg} teamPending={addToTeam.isPending || removeFromTeam.isPending} onTeamAdd={(teamId) => addToTeam.mutate({ teamId, userId: u.id })} onTeamOpen={(teamId) => setTeamSettingsId(teamId)} onTeamCreated={(teamId) => { refreshMemberships(); setTeamSettingsId(teamId); }} onTeamExit={(team, losing) => setTeamExit({ userId: u.id, userName: u.name || u.email || "User", teamId: team.id, teamName: team.name, losing })} allProjects={projectsQ.data ?? []} projectPending={addToProject.isPending || removeFromProject.isPending} onProjectAdd={(projectId) => addToProject.mutate({ projectId, userId: u.id })} onProjectRemove={(projectId) => removeFromProject.mutate({ projectId, userId: u.id })} canJoin={canDeleteUsers && !!u.email} joinPending={joinWorkspace.isPending && joinWorkspace.variables === u.email} onJoin={() => u.email && joinWorkspace.mutate(u.email)} workspaceName={workspaceName} onOpenApproval={() => setView("approval")} />;
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
      {teamSettingsId && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4" onClick={() => { setTeamSettingsId(null); setDivisionsOpen(false); }}>
          <div className="mx-auto my-8 w-full max-w-lg space-y-3" onClick={(e) => e.stopPropagation()}>
            {openTeam ? (
              <>
                <div className="flex items-center gap-2">
                  <button onClick={() => setDivisionsOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-soft transition hover:bg-accent">
                    <FolderKanban className="h-3.5 w-3.5" /> Kelola divisi
                  </button>
                  <button onClick={() => { setTeamSettingsId(null); setDivisionsOpen(false); }} className="ml-auto rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-soft transition hover:bg-accent">Tutup</button>
                </div>
                {divisionsOpen && <DivisionManager divisions={divisionsQ.data ?? []} teams={teamsQ.data ?? []} />}
                <TeamCard
                  team={openTeam}
                  canManage
                  divisions={divisionsQ.data ?? []}
                  allMembers={wsMembers.map((m) => ({ userId: m.userId, name: m.name }))}
                  allProjects={projectsQ.data ?? []}
                  onChange={refreshMemberships}
                />
              </>
            ) : (
              // Tim yang baru saja dihapus dari dalam kartunya sendiri: daftarnya sudah dimuat
              // ulang dan barisnya hilang. Menutup sendiri lebih baik daripada kotak kosong.
              <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-soft">
                Tim ini sudah tidak ada.
                <button onClick={() => setTeamSettingsId(null)} className="ml-2 font-semibold text-primary hover:underline">Tutup</button>
              </div>
            )}
          </div>
        </div>
      )}
      {teamExit && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setTeamExit(null)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-soft" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-bold">Keluarkan dari {teamExit.teamName}?</div>
            <p className="mt-2 text-sm text-muted-foreground"><b className="text-foreground">{teamExit.userName}</b> keluar dari tim ini.</p>
            {teamExit.losing.length > 0 ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="text-xs font-bold text-amber-800">Ikut hilang: akses ke {teamExit.losing.length} project</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {teamExit.losing.map((n) => <span key={n} className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">{n}</span>)}
                </div>
                <div className="mt-2 text-[11px] text-amber-700">Akses yang ditambahkan langsung ke project tidak ikut terhapus.</div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">Tim ini tidak menautkan project, jadi tidak ada akses yang hilang.</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setTeamExit(null)} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-accent">Batal</button>
              <button
                onClick={() => { removeFromTeam.mutate({ teamId: teamExit.teamId, userId: teamExit.userId }); setTeamExit(null); }}
                className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-rose-700">
                Keluarkan
              </button>
            </div>
          </div>
        </div>
      )}
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
          <h2 className="font-display text-base font-bold tracking-tight">Holiday Quota — {monthLabel}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">Per-staff <b className="text-foreground">public holiday</b> quota for this month — applies equally to all staff. Set it each month. Staff request their own via "New request" in Attendance.</p>

        {q.isLoading ? (
          <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input type="number" inputMode="numeric" min={0} max={31} value={val} onChange={(e) => setVal(e.target.value)} placeholder="0" className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
            <span className="text-xs text-muted-foreground">days / staff this month</span>
            <button type="button" disabled={!dirty || m.isPending} onClick={() => m.mutate(n)} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
              {m.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </button>
          </div>
        )}
        {q.data && q.data.quota === 0 && <p className="mt-2 text-[11px] text-amber-600">Quota is still 0 — staff can't request public holidays this month until it's set.</p>}
      </div>
    </div>
  );
}

const WEEKDAYS: Array<[string, string]> = [["1", "Mon"], ["2", "Tue"], ["3", "Wed"], ["4", "Thu"], ["5", "Fri"], ["6", "Sat"], ["7", "Sun"]];


/**
 * Menautkan satu profil NEXUS ke akun Google Workspace-nya.
 *
 * Pemilih, bukan kotak teks. Alamat yang diketik tangan akan salah ketik suatu hari, dan
 * alamat yang salah terlihat persis sama dengan yang benar di database — barunya ketahuan
 * pada hari seseorang mencoba mengirim surat ke sana. Server tetap memverifikasi ulang;
 * pemilih ini hanya menghapus kesempatannya.
 *
 * Tidak semua orang di NEXUS punya email kantor, jadi keadaan "belum ditautkan" adalah
 * keadaan yang normal dan harus terlihat tenang, bukan seperti sesuatu yang kurang.
 */
function GoogleLinkCell({ user, accounts, domains, configured, canEdit }: { user: NexusAdminUser; accounts: GoogleWorkspaceAccount[]; domains: string[]; configured: boolean; canEdit: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [madePassword, setMadePassword] = useState<{ email: string; password: string; notified?: { inApp: boolean; email: boolean; emailTo?: string | null } } | null>(null);
  // Di ATAS semua `return` awal. Pernah ditaruh di bawahnya: saat daftar akun Google selesai
  // dimuat (`configured` false → true) jumlah hook berubah, React melempar, dan seluruh halaman
  // Control Room jatuh ke "This page didn't load".
  const [q, setQ] = useState("");
  const current = user.googleWorkspaceEmail ?? null;

  const parts = (user.name ?? "").trim().split(/\s+/).filter(Boolean);
  const [givenName, setGivenName] = useState(parts[0] ?? "");
  const [familyName, setFamilyName] = useState(parts.slice(1).join(" ") || "-");
  const [localPart, setLocalPart] = useState((parts[0] ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, ""));
  const [domain, setDomain] = useState(domains[0] ?? "");

  const create = useMutation({
    mutationFn: () => nexusApi.createGoogleWorkspaceAccount({ userId: user.id, localPart, domain, givenName, familyName }),
    onSuccess: (r) => {
      setProblem(r.linked ? null : (r.error ?? null));
      // Sandi sementara ditampilkan SEKALI dan tidak disimpan di mana pun. Panel ini menutup
      // sendiri hanya kalau disuruh — jangan tutup otomatis, karena sandinya hilang bersamanya.
      setMadePassword({ email: r.account.email, password: r.account.temporaryPassword, notified: r.notified });
      setMaking(false);
      qc.invalidateQueries({ queryKey: ["nexus", "admin-users"] });
      qc.invalidateQueries({ queryKey: ["nexus", "google-workspace-accounts"] });
    },
    onError: (e: unknown) => setProblem(e instanceof ApiError ? e.message : "Gagal membuat akun"),
  });

  const link = useMutation({
    mutationFn: (email: string | null) => nexusApi.linkGoogleWorkspace(user.id, email),
    onSuccess: () => {
      setProblem(null);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["nexus", "admin-users"] });
      // Daftar akun ikut disegarkan: `linkedTo` di dalamnya baru saja berubah, dan tanpa ini
      // akun yang barusan dipakai masih tampak bebas di baris orang lain.
      qc.invalidateQueries({ queryKey: ["nexus", "google-workspace-accounts"] });
    },
    onError: (e: unknown) => setProblem(e instanceof ApiError ? e.message : "Gagal menautkan"),
  });

  if (!configured) return null;

  // Sandi sementara: satu-satunya kesempatan melihatnya. Ditaruh di atas segalanya supaya
  // tidak tertutup interaksi berikutnya, dan hanya hilang saat ditutup dengan sengaja.
  if (madePassword) {
    return (
      <span className="inline-flex max-w-[280px] flex-col gap-1 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-[11px] text-emerald-900">
        <span className="font-semibold">{madePassword.email} dibuat</span>
        <span>Sandi sementara — salin sekarang, tidak bisa dilihat lagi:</span>
        <code className="select-all rounded bg-white px-1.5 py-1 font-mono text-[11px] tracking-tight">{madePassword.password}</code>
        <span className="text-emerald-700">Dia wajib menggantinya saat login pertama.</span>
        {madePassword.notified?.email ? (
          <span className="text-emerald-700">
            Sandi sudah dikirim ke {madePassword.notified.emailTo}. Kamu tidak perlu meneruskannya.
          </span>
        ) : (
          // Kegagalan email HARUS terlihat sekarang, selagi sandinya masih di layar. Ditemukan
          // nanti lewat orang yang bingung kenapa tidak dapat apa-apa berarti sandinya sudah hilang.
          <span className="font-semibold text-destructive">
            Email GAGAL terkirim — sampaikan sandi ini sendiri, dan jangan lewat chat grup.
          </span>
        )}
        {problem && <span className="text-destructive">{problem}</span>}
        <button type="button" onClick={() => { setMadePassword(null); setOpen(false); }} className="self-start rounded border border-emerald-300 px-1.5 py-0.5 font-semibold hover:bg-emerald-100">
          Sudah disalin
        </button>
      </span>
    );
  }

  const takenBy = (a: GoogleWorkspaceAccount) => (a.linkedTo && a.linkedTo.id !== user.id ? a.linkedTo.name : null);
  const rows = accounts.filter((a) => !q.trim() || a.email.toLowerCase().includes(q.toLowerCase()) || (a.fullName ?? "").toLowerCase().includes(q.toLowerCase()));
  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <>
      {/* Keadaan: satu baris yang tenang. Tertaut = alamatnya; belum = kalimat, bukan peringatan
          — sebagian besar orang memang belum punya email kantor. */}
      <div className="flex flex-wrap items-center gap-2">
        {current ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800"><AtSign className="h-3.5 w-3.5" /> {current}</span>
        ) : (
          <span className="text-sm text-muted-foreground">Belum ditautkan.</span>
        )}
        {canEdit && (
          <>
            <button type="button" onClick={() => { setProblem(null); setQ(""); setOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold transition hover:border-primary hover:text-primary">
              <Link2 className="h-3.5 w-3.5" /> {current ? "Ganti akun" : "Pilih akun"}
            </button>
            {!current && domains.length > 0 && (
              <button type="button" onClick={() => { setProblem(null); setMaking(true); }} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold transition hover:border-primary hover:text-primary">
                <Plus className="h-3.5 w-3.5" /> Buat email kantor
              </button>
            )}
            {current && (
              <button type="button" disabled={link.isPending} onClick={() => link.mutate(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-50">
                {link.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2Off className="h-3.5 w-3.5" />} Lepas
              </button>
            )}
          </>
        )}
      </div>
      {problem && !open && !making && <div className="mt-2 text-xs text-destructive">{problem}</div>}

      {/* Pemilih: daftar yang bisa dicari, bukan <select> dengan 22 opsi sepanjang satu kalimat. Yang
          sudah dipakai orang lain tetap terlihat tapi tidak bisa dipilih, lengkap dengan nama pemakainya. */}
      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-soft" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-sm font-bold">Akun Google Workspace untuk {user.name || "orang ini"}</div>
              <button onClick={() => setOpen(false)} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">Server memastikan alamatnya benar-benar ada di Google sebelum disimpan.</p>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari alamat atau nama…" className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:border-primary" />
            </div>
            <div className="max-h-80 space-y-0.5 overflow-y-auto">
              {current && !accounts.some((a) => a.email === current) && (
                // Akun yang baru dibuat BELUM tentu ada di daftar: Google menerbitkan user secara
                // asinkron dan pembacaan tepat setelah insert bisa menjawab 404 (terbukti saat uji).
                <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-2 py-1.5 text-sm font-semibold text-primary"><AtSign className="h-3.5 w-3.5" /> {current} <span className="text-[11px] font-normal">(baru dibuat)</span></div>
              )}
              {rows.map((a) => {
                const taken = takenBy(a);
                const isCurrent = a.email === current;
                return (
                  <button key={a.email} type="button" disabled={Boolean(taken) || link.isPending} onClick={() => link.mutate(a.email)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition", taken ? "cursor-not-allowed opacity-50" : "hover:bg-accent", isCurrent && "bg-primary/10")}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">{initialsOf(a.fullName || a.email)}</span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm font-semibold", isCurrent && "text-primary")}>{a.email}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {a.fullName || "—"}{a.suspended && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700">suspended</span>}{taken && <span className="ml-1">· dipakai {taken}</span>}
                      </span>
                    </span>
                    {isCurrent && <span className="text-xs font-bold text-primary">✓</span>}
                  </button>
                );
              })}
              {rows.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">Nggak ada yang cocok.</div>}
            </div>
            {problem && <div className="mt-2 text-xs text-destructive">{problem}</div>}
            {link.isPending && <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Menautkan…</div>}
          </div>
        </div>
      )}

      {/* Formulir buat mailbox baru. Modal sendiri: ini mengisi seat lisensi berbayar, dan formulir
          yang ditempel di dalam baris tabel terbaca seperti sesuatu yang boleh diisi asal-asalan. */}
      {making && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onClick={() => setMaking(false)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-soft" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-sm font-bold">Buat email kantor untuk {user.name || "orang ini"}</div>
              <button onClick={() => setMaking(false)} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">Akun baru mengisi satu seat lisensi Workspace. Sandi sementaranya cuma bisa dilihat sekali, dan dikirim ke email pribadinya.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div><div className="mb-1 text-[11px] font-semibold text-muted-foreground">Nama depan</div><input value={givenName} onChange={(e) => setGivenName(e.target.value)} className={inputCls} /></div>
              <div><div className="mb-1 text-[11px] font-semibold text-muted-foreground">Nama belakang</div><input value={familyName} onChange={(e) => setFamilyName(e.target.value)} className={inputCls} /></div>
            </div>
            <div className="mt-2">
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Alamat</div>
              <div className="flex items-center gap-1.5">
                <input value={localPart} onChange={(e) => setLocalPart(e.target.value.toLowerCase())} placeholder="nama.alamat" className={cn(inputCls, "font-mono")} />
                <span className="text-muted-foreground">@</span>
                <select value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-2 text-sm font-semibold outline-none focus:border-primary">
                  {domains.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              {localPart && domain && <div className="mt-1 text-[11px] text-muted-foreground">Akan dibuat: <b className="font-mono text-foreground">{localPart}@{domain}</b></div>}
            </div>
            {problem && <div className="mt-2 text-xs text-destructive">{problem}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => { setMaking(false); setProblem(null); }} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-accent">Batal</button>
              <button type="button" disabled={create.isPending || !localPart || !domain || !givenName || !familyName} onClick={() => { setProblem(null); create.mutate(); }} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
                {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {create.isPending ? "Membuat…" : "Buat & tautkan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
type UserRowProps = {
  memberships?: NexusUserMemberships; membershipsLoading: boolean; allTeams: NexusTeam[]; canManageTeams: boolean; teamPending: boolean;
  onTeamAdd: (teamId: string) => void; onTeamOpen: (teamId: string) => void; onTeamCreated: (teamId: string) => void; onTeamExit: (team: { id: string; name: string }, losing: string[]) => void;
  gwConfigured: boolean; gwAccounts: GoogleWorkspaceAccount[]; gwDomains: string[]; canLinkGoogle: boolean;
  user: NexusAdminUser;
  orgInfo?: { memberId: string; role: string; shiftStart: string | null; shiftEnd: string | null; shiftByDay: Record<string, { start: string; end: string }> | null; flexi: boolean; noGeofence: boolean; approverName: string | null };
  assignable: OrgRole[]; canEdit: boolean; onOrgRole: (role: string) => void; pending: boolean;
  canManageShift: boolean; shiftPending: boolean; onSaveShift: (start: string | null, end: string | null) => void;
  shiftByDayPending: boolean; onSaveShiftByDay: (byDay: Record<string, { start: string; end: string }>) => void;
  flexiPending: boolean; onToggleFlexi: () => void; geofencePending: boolean; onToggleGeofence: () => void;
  onDayoff: () => void; canDelete: boolean; isMember: boolean; onDelete: () => void;
  /** Project langsung: daftar untuk pemilih, dan dua aksi. Yang lewat tim tidak disentuh dari sini. */
  allProjects: Array<{ id: string; name: string; color?: string | null; status?: string | null }>; projectPending: boolean;
  onProjectAdd: (projectId: string) => void; onProjectRemove: (projectId: string) => void;
  /** Masukkan akun yang belum punya workspace ke workspace ini, sebagai Staff. */
  canJoin: boolean; joinPending: boolean; onJoin: () => void; workspaceName: string;
  /** Approver diatur di Bagan Approval; dari panel ini cuma ada pintunya. */
  onOpenApproval: () => void;
};

/**
 * Satu baris = ringkasan yang tenang. Semua pengaturan — peran, jam kerja, per-hari, Flexi,
 * Mobile, day off, Google, tim & project — ada di SATU panel "Atur" di sisi kanan.
 *
 * Dulu ketujuh kontrol itu berjejer di dalam baris, 49 kali. Berlin: "pusing banget". Baris
 * yang menampilkan semua tombolnya tidak menjawab pertanyaan yang paling sering ditanyakan di
 * tabel ini — "orang ini jamnya berapa, perannya apa" — karena jawabannya tenggelam di antara
 * tombol yang jarang dipakai. Ringkasannya sekarang hanya menyebut yang MENYALA.
 */
function UserRow(props: UserRowProps) {
  const { user, orgInfo, isMember, canDelete, canJoin, joinPending, onJoin, onDelete, workspaceName, memberships, membershipsLoading, gwConfigured } = props;
  const [open, setOpen] = useState(false);
  const projectCount = memberships?.projects.length ?? 0;
  const teamCount = memberships?.teams.length ?? 0;
  const overrideCount = Object.keys(orgInfo?.shiftByDay ?? {}).length;
  const shiftLabel = orgInfo?.shiftStart && orgInfo?.shiftEnd ? `${to12h(orgInfo.shiftStart)}–${to12h(orgInfo.shiftEnd)}` : null;

  return (
    <>
      <tr className="border-b border-border last:border-0 hover:bg-muted/20">
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            {user.avatar ? (
              <img src={user.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-border" />
            ) : (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-1 ring-border">{initialsOf(user.name)}</span>
            )}
            <div className="min-w-0">
              <div className="truncate font-semibold">{user.name || "Unnamed"}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
              {/* Approver absensi — hanya untuk STAFF. "Belum ditaruh" berwarna peringatan karena
                  request orang ini masih jatuh ke BoD; bukan galat, tapi pekerjaan yang belum selesai. */}
              {orgInfo && (
                orgInfo.approverName
                  ? <div className="truncate text-[11px] text-muted-foreground">Approver: <b className="text-foreground">{orgInfo.approverName}</b></div>
                  : (orgInfo.role === "STAFF" || orgInfo.role === "MANAGER")
                    ? <div className="text-[11px] font-semibold text-amber-700">Belum ditaruh di Bagan Approval</div>
                    : <div className="text-[11px] text-muted-foreground">Approver: BoD lain</div>
              )}
              {isMember && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {membershipsLoading ? "…" : `${projectCount} project${projectCount === 1 ? "" : "s"}${teamCount > 0 ? ` · ${teamCount} team${teamCount === 1 ? "" : "s"}` : ""}`}
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="hidden px-4 py-3 text-xs text-muted-foreground md:table-cell">{user.joinedAt ? fmtDate(user.joinedAt) : ""}</td>
        <td className="px-4 py-3">
          {!orgInfo ? (
            <span className="text-xs text-muted-foreground/60">—</span>
          ) : (
            // Hanya yang MENYALA yang digambar. 46 dari 49 orang tidak memakai Flexi/Mobile;
            // lencana "mati" di tiap baris membuat yang menyala berhenti terlihat.
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {orgInfo.flexi ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700"><Zap className="h-3 w-3 fill-amber-400" /> Flexi 12:00–15:00</span>
              ) : (
                <span className="font-semibold tabular-nums text-foreground">{shiftLabel ?? <span className="font-normal text-muted-foreground">jam kantor</span>}</span>
              )}
              {!orgInfo.flexi && overrideCount > 0 && <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">per-hari ×{overrideCount}</span>}
              {orgInfo.noGeofence && <span className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700"><Smartphone className="h-3 w-3" /> Mobile</span>}
              {gwConfigured && user.googleWorkspaceEmail && <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground" title={user.googleWorkspaceEmail}><AtSign className="h-3 w-3" /> Google</span>}
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            {orgInfo ? (
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", ORG_ROLE_TONE[orgInfo.role] ?? "bg-muted text-muted-foreground")}>{ORG_ROLE_LABEL[orgInfo.role] ?? orgInfo.role}</span>
            ) : (
              <span className="text-xs text-muted-foreground/60">belum masuk workspace</span>
            )}
            {/* Akun yang mendaftar sendiri tanpa kode workspace berhenti di sini — terdaftar,
                tapi tidak di mana pun. Satu tombol, langsung jadi Staff; perannya bisa diubah
                sesudahnya di panel yang sama. */}
            {!isMember && canJoin && (
              <button type="button" onClick={onJoin} disabled={joinPending} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50">
                {joinPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Masukkan ke {workspaceName}
              </button>
            )}
            {canDelete && !isMember && (
              <button type="button" onClick={onDelete} title="Delete account permanently" className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 transition hover:bg-rose-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            {isMember && (
              <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground transition hover:border-primary hover:text-primary">
                <Settings2 className="h-3.5 w-3.5" /> Detail
              </button>
            )}
          </div>
        </td>
      </tr>
      {open && <UserDetailModal {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Kartu detail satu orang — modal di tengah layar, bukan sidebar.
 *
 * Dua kolom di layar lebar: kiri = siapa dia dan aturannya (peran, approver, mode absensi, day off,
 * Google); kanan = jam kerja, karena itu bagian yang paling tinggi dan paling sering diubah.
 * Tim & project melebar di bawah. Tiap bagian adalah kartu sendiri supaya matanya bisa lompat ke
 * bagian yang dicari tanpa membaca semuanya.
 */
function UserDetailModal(props: UserRowProps & { onClose: () => void }) {
  const { user, orgInfo, assignable, canEdit, onOrgRole, pending, canManageShift, shiftPending, onSaveShift, shiftByDayPending, onSaveShiftByDay, flexiPending, onToggleFlexi, geofencePending, onToggleGeofence, onDayoff, canDelete, gwConfigured, gwAccounts, gwDomains, canLinkGoogle, memberships, membershipsLoading, allTeams, canManageTeams, teamPending, onTeamAdd, onTeamOpen, onTeamCreated, onTeamExit, allProjects, projectPending, onProjectAdd, onProjectRemove, onOpenApproval, onClose } = props;
  const byDay = orgInfo?.shiftByDay ?? {};
  const saveDay = (wd: string, start: string | null, end: string | null) => {
    const next: Record<string, { start: string; end: string }> = { ...byDay };
    if (start && end) next[wd] = { start, end };
    else delete next[wd];
    onSaveShiftByDay(next);
  };
  const projectCount = memberships?.projects.length ?? 0;
  const teamCount = memberships?.teams.length ?? 0;

  // Esc menutup — kartu ini dibuka berkali-kali berturut-turut, dan mengejar tombol × 49 kali
  // adalah cara membuat orang berhenti memakainya.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!orgInfo) return null;

  const Card = ({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) => (
    <section className={cn("rounded-xl border border-border bg-background p-4", className)}>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</div>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );

  const ToggleRow = ({ on, pending: p, onToggle, icon, title, desc, tone }: { on: boolean; pending: boolean; onToggle: () => void; icon: React.ReactNode; title: string; desc: string; tone: "amber" | "sky" }) => (
    <button type="button" disabled={!canManageShift || p} onClick={onToggle} className={cn("flex w-full items-start gap-3 rounded-lg border p-3 text-left transition disabled:cursor-default", on ? (tone === "amber" ? "border-amber-300 bg-amber-50" : "border-sky-300 bg-sky-50") : "border-border bg-card hover:bg-accent/40")}>
      <span className={cn("mt-0.5 shrink-0", on ? (tone === "amber" ? "text-amber-600" : "text-sky-600") : "text-muted-foreground")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{desc}</span>
      </span>
      <span className={cn("mt-1 h-5 w-9 shrink-0 rounded-full p-0.5 transition", on ? (tone === "amber" ? "bg-amber-500" : "bg-sky-500") : "bg-muted")}>
        <span className={cn("block h-4 w-4 rounded-full bg-white shadow transition", on && "translate-x-4")} />
      </span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 md:p-8" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Kepala: siapa dia, dalam satu pandangan — peran, gabung, approver. Bukan pengaturan. */}
        <header className="flex items-start gap-4 border-b border-border px-6 py-5">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-primary/10 text-lg font-bold text-primary ring-1 ring-border">{initialsOf(user.name)}</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold tracking-tight">{user.name || "Unnamed"}</h2>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", ORG_ROLE_TONE[orgInfo.role] ?? "bg-muted text-muted-foreground")}>{ORG_ROLE_LABEL[orgInfo.role] ?? orgInfo.role}</span>
            </div>
            <div className="truncate text-sm text-muted-foreground">{user.email}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
              {user.joinedAt && <span>Gabung {fmtDate(user.joinedAt)}</span>}
              {user.googleWorkspaceEmail && <span className="inline-flex items-center gap-1"><AtSign className="h-3 w-3" /> {user.googleWorkspaceEmail}</span>}
              <span>{teamCount} tim · {projectCount} project</span>
            </div>
          </div>
          <Link to="/people/$userId" params={{ userId: user.id }} title="Absensi, log XP dan request orang ini per periode" className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-accent">Rekap →</Link>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-4 md:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            {/* ── kiri ── */}
            <div className="space-y-4">
              {canDelete && <AccountCard user={user} memberId={orgInfo.memberId} Card={Card} />}
              <Card title="Peran">
                {canEdit ? (
                  <select value={orgInfo.role} disabled={pending} onChange={(e) => onOrgRole(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold outline-none focus:border-primary disabled:opacity-50">
                    {[...assignable].reverse().map((r) => <option key={r} value={r}>{ORG_ROLE_LABEL[r]}</option>)}
                  </select>
                ) : (
                  <span className="text-sm text-muted-foreground">Peran orang ini di atas atau setara kamu — tidak bisa diubah dari sini.</span>
                )}
              </Card>

              <Card title="Approver absensi" hint="Request cuti/izin/sakit orang ini masuk ke atasan yang ditaruh di Bagan Approval — siapa pun perannya.">
                  <div className="flex items-center justify-between gap-3">
                    {orgInfo.approverName
                      ? <span className="text-sm font-semibold">{orgInfo.approverName}</span>
                      : (orgInfo.role === "STAFF" || orgInfo.role === "MANAGER")
                        ? <span className="text-sm font-semibold text-amber-700">Belum ditaruh — masih masuk ke semua BoD</span>
                        : <span className="text-sm text-muted-foreground">Tidak ditaruh — masuk ke BoD lain</span>}
                    <button type="button" onClick={() => { onClose(); onOpenApproval(); }} className="shrink-0 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-accent">Buka Bagan Approval →</button>
                  </div>
                </Card>

              <Card title="Mode absensi">
                <div className="space-y-2">
                  <ToggleRow on={orgInfo.flexi} pending={flexiPending} onToggle={onToggleFlexi} icon={<Zap className={cn("h-4 w-4", orgInfo.flexi && "fill-amber-400")} />} title="Flexi Time" desc="Masuk kapan saja 12:00–15:00 tanpa penalti telat; pulang = masuk + 9 jam." tone="amber" />
                  <ToggleRow on={orgInfo.noGeofence} pending={geofencePending} onToggle={onToggleGeofence} icon={<Smartphone className="h-4 w-4" />} title="Mode Mobile" desc="Absen dari mana saja — geofence mati, checkout luar kantor tanpa approval." tone="sky" />
                </div>
              </Card>

              {canManageShift && (
                <Card title="Jatah day off">
                  <button type="button" onClick={onDayoff} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition hover:border-primary hover:text-primary">
                    <CalendarDays className="h-4 w-4" /> Kelola jatah & riwayat day off
                  </button>
                </Card>
              )}

              {gwConfigured && (
                <Card title="Google Workspace" hint="Email kantor yang ditautkan ke profil ini.">
                  <GoogleLinkCell user={user} accounts={gwAccounts} domains={gwDomains} configured={gwConfigured} canEdit={canLinkGoogle} />
                </Card>
              )}
            </div>

            {/* ── kanan ── */}
            <Card title="Jam kerja" hint={orgInfo.flexi ? "Flexi Time menyala — jam tetap di bawah ini diabaikan." : "Kosongkan = ikut jam kantor/tim. Per-hari hanya untuk hari yang diisi."} className="self-start">
              <div className={cn("space-y-4", orgInfo.flexi && "pointer-events-none opacity-40")}>
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Default</div>
                  <ShiftCell start={orgInfo.shiftStart} end={orgInfo.shiftEnd} canEdit={canManageShift && !orgInfo.flexi} pending={shiftPending} onSave={onSaveShift} />
                </div>
                {canManageShift && (
                  <div>
                    <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Per-hari <span className="font-normal text-muted-foreground/70">— hanya hari yang beda dari default</span></div>
                    <div className="space-y-1.5">
                      {WEEKDAYS.map(([wd, label]) => (
                        <div key={wd} className={cn("flex items-center gap-3 rounded-lg px-2 py-1", byDay[wd] && "bg-primary/5")}>
                          <span className={cn("w-9 shrink-0 text-xs font-bold", byDay[wd] ? "text-primary" : "text-muted-foreground")}>{label}</span>
                          <ShiftCell start={byDay[wd]?.start ?? null} end={byDay[wd]?.end ?? null} canEdit={canManageShift} pending={shiftByDayPending} onSave={(s, e) => saveDay(wd, s, e)} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* ── bawah, melebar ── */}
            <Card title="Tim & project" hint={canManageTeams ? "Tim sudah diganti Bagan IP & Divisi (tab Bagan). Akses project diatur per orang di sini." : undefined} className="md:col-span-2">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"><UsersIcon className="h-3.5 w-3.5" /> Tim · {teamCount}</div>
                  {!membershipsLoading && teamCount === 0 && <div className="mb-1.5 text-xs text-muted-foreground/70">Tim sudah diganti Bagan IP &amp; Divisi.</div>}
                  <div className="flex flex-wrap gap-1.5">
                    {(memberships?.teams ?? []).map((tm) => {
                      // Project yang orang ini dapat GARA-GARA tim ini — dipakai untuk memberi tahu
                      // apa yang hilang sebelum dia dikeluarkan, bukan sesudahnya.
                      const losing = (memberships?.projects ?? []).filter((pr) => pr.viaTeam === tm.name).map((pr) => pr.name);
                      return (
                        <span key={tm.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card py-1 pl-2 pr-1 text-[11px] font-semibold text-foreground">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tm.color ?? "#7B2FBE" }} />
                          {canManageTeams ? (
                            <button type="button" onClick={() => onTeamOpen(tm.id)} title="Atur tim ini (nama, divisi, jam shift, project)" className="font-semibold underline-offset-2 transition hover:text-primary hover:underline">{tm.name}</button>
                          ) : tm.name}
                          {tm.division && <span className="font-normal text-muted-foreground">· {tm.division}</span>}
                          {canManageTeams && (
                            <button type="button" disabled={teamPending} onClick={() => onTeamExit({ id: tm.id, name: tm.name }, losing)} title="Keluarkan dari tim ini" className="rounded p-0.5 text-muted-foreground/50 transition hover:bg-rose-100 hover:text-rose-600 disabled:opacity-40">
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      );
                    })}
                    {/* No "+ tim": teams were replaced by the Bagan (30 Sep 2026) and POST /api/teams answers 410. */}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"><FolderKanban className="h-3.5 w-3.5" /> Project · {projectCount}</div>
                  {membershipsLoading && <div className="text-xs text-muted-foreground/70">Loading…</div>}
                  {!membershipsLoading && projectCount === 0 && <div className="mb-1.5 text-xs text-muted-foreground/70">Belum masuk project mana pun.</div>}
                  <div className="flex flex-wrap gap-1.5">
                    {(memberships?.projects ?? []).map((pr) => (
                      <span key={pr.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card py-1 pl-2 pr-1 text-[11px] font-semibold text-foreground">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: pr.color ?? "#94A3B8" }} />
                        <Link to="/projects/$projectId" params={{ projectId: pr.id }} className="underline-offset-2 hover:text-primary hover:underline">{pr.name}</Link>
                        {/* Lewat tim, bukan langsung: mencabutnya dari halaman project TIDAK bertahan —
                            sinkronisasi tim menuliskannya lagi. Sebut timnya, dan jangan beri tombol lepas. */}
                        {pr.viaTeam && <span className="font-normal text-muted-foreground">· via {pr.viaTeam}</span>}
                        {pr.role !== "MEMBER" && <span className="rounded bg-primary/10 px-1 text-[10px] font-bold text-primary">{pr.role}</span>}
                        {canManageTeams && !pr.viaTeam ? (
                          <button type="button" disabled={projectPending} onClick={() => onProjectRemove(pr.id)} title="Lepas dari project ini" className="rounded p-0.5 text-muted-foreground/50 transition hover:bg-rose-100 hover:text-rose-600 disabled:opacity-40"><X className="h-3 w-3" /></button>
                        ) : <span className="w-1" />}
                      </span>
                    ))}
                    {canManageTeams && <ProjectAddPicker projects={allProjects} already={new Set((memberships?.projects ?? []).map((p) => p.id))} pending={projectPending} onPick={onProjectAdd} />}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Identitas akun orang lain — foto, nama, email login, sandi. BoD ke atas saja (server menolak
 * sisanya, tombolnya juga tidak digambar untuk yang lain).
 *
 * Sandi diketik sekali dan dikirim sekali; tidak ada "konfirmasi sandi" — yang mengetik adalah BoD
 * yang bisa melihat apa yang diketiknya (kotaknya teks biasa, bukan titik-titik), dan kalau salah,
 * ia tinggal mengetik lagi. Sandi lama tidak diminta: orang itu memang tidak ada di sini.
 */
function AccountCard({ user, memberId, Card }: { user: NexusAdminUser; memberId: string; Card: (p: { title: string; hint?: string; children: React.ReactNode; className?: string }) => React.ReactElement }) {
  const qc = useQueryClient();
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [password, setPassword] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["nexus", "admin-users"] }); qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }); qc.invalidateQueries({ queryKey: ["nexus", "approval-chart"] }); };
  const save = useMutation({
    mutationFn: (body: { name?: string; email?: string; password?: string }) => nexusApi.updateAdminAccount(user.id, body),
    onSuccess: (_r, body) => {
      refresh();
      setPassword("");
      toast.success(body.password ? "Sandi diganti" : "Akun disimpan", { description: body.password ? "Sampaikan sandi barunya langsung ke orangnya, jangan lewat chat grup." : undefined });
    },
    onError: (e: unknown) => toast.error("Gagal menyimpan", { description: e instanceof ApiError ? e.message : "Coba lagi." }),
  });
  const photo = useMutation({
    mutationFn: (file: File) => nexusApi.uploadMemberAvatar(memberId, file),
    onSuccess: () => { refresh(); toast.success("Foto profil diganti"); },
    onError: (e: unknown) => toast.error("Gagal mengunggah foto", { description: e instanceof ApiError ? e.message : "PNG/JPG/WEBP, maksimal 5 MB." }),
  });
  const dirtyIdentity = name.trim() !== (user.name ?? "") || email.trim().toLowerCase() !== (user.email ?? "");
  const inputCls = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary";
  return (
    <Card title="Akun" hint="Foto, nama, email login, dan sandi. Hanya BoD yang melihat kartu ini.">
      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-3">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary ring-1 ring-border">{initialsOf(user.name)}</span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold transition hover:border-primary hover:text-primary">
            {photo.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Ganti foto
          </span>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={photo.isPending} onChange={(e) => { const f = e.target.files?.[0]; if (f) photo.mutate(f); e.target.value = ""; }} />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Nama</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Email login</div>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </div>
        </div>
        <button type="button" disabled={!dirtyIdentity || save.isPending} onClick={() => save.mutate({ ...(name.trim() !== (user.name ?? "") ? { name: name.trim() } : {}), ...(email.trim().toLowerCase() !== (user.email ?? "") ? { email: email.trim() } : {}) })} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
          {save.isPending && !password ? "Menyimpan…" : "Simpan nama & email"}
        </button>
        <div className="border-t border-border pt-3">
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Sandi baru <span className="font-normal text-muted-foreground/70">— minimal 8 karakter, terlihat saat diketik</span></div>
          <div className="flex gap-2">
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ketik sandi baru…" autoComplete="off" spellCheck={false} className={cn(inputCls, "font-mono")} />
            <button type="button" disabled={password.length < 8 || save.isPending} onClick={() => save.mutate({ password })} className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-40">
              Ganti sandi
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** "+ project" — sama polanya dengan "+ tim": daftar pendek yang bisa dicari. Menambahkan langsung
 *  (source "direct"), jadi tidak bergantung pada tim mana pun. */
function ProjectAddPicker({ projects, already, pending, onPick }: { projects: Array<{ id: string; name: string; color?: string | null; status?: string | null }>; already: Set<string>; pending: boolean; onPick: (projectId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const options = projects.filter((p) => !already.has(p.id)).filter((p) => !q.trim() || p.name.toLowerCase().includes(q.toLowerCase()));
  if (!open) {
    return (
      <button type="button" disabled={pending} onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-40">
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} project
      </button>
    );
  }
  return (
    <div className="w-full rounded-lg border border-primary/40 bg-background p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari project…" className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary" />
        <button type="button" onClick={() => { setOpen(false); setQ(""); }} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Tutup</button>
      </div>
      <div className="max-h-44 space-y-0.5 overflow-y-auto">
        {options.length === 0 && <div className="px-1 py-2 text-[11px] text-muted-foreground/70">Nggak ada yang cocok.</div>}
        {options.map((p) => (
          <button key={p.id} type="button" disabled={pending} onClick={() => { onPick(p.id); setOpen(false); setQ(""); }} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] font-semibold transition hover:bg-accent disabled:opacity-50">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? "#94A3B8" }} />
            <span className="truncate">{p.name}</span>
            {p.status && <span className="ml-auto shrink-0 font-normal text-muted-foreground">{statusLabel(p.status)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * "+ tim" di baris orang. Daftar pendek yang bisa dicari, bukan `<select>`: workspace ini punya
 * 21 tim dengan nama yang mirip-mirip ("BOD AGENZ", "BD AGENZ"), dan memilih dari daftar gulung
 * tanpa pencarian adalah cara paling gampang memasukkan orang ke tim yang salah.
 */
function TeamAddPicker({ teams, already, pending, onPick, onCreated }: { teams: NexusTeam[]; already: Set<string>; pending: boolean; onPick: (teamId: string) => void; onCreated: (teamId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Bikin tim baru dari sini, karena tidak ada halaman Teams lagi yang punya tombolnya.
  // Langsung dibuka pengaturannya setelah jadi: tim baru selalu butuh divisi dan project,
  // dan membuatnya lalu meninggalkannya kosong adalah cara tim hantu bermunculan.
  const create = useMutation({ mutationFn: (name: string) => nexusApi.createTeam(name), onSuccess: (t) => { setOpen(false); setQ(""); onCreated(t.id); } });
  const options = teams
    .filter((t) => !already.has(t.id))
    .filter((t) => !q.trim() || t.name.toLowerCase().includes(q.toLowerCase()) || (t.division?.name ?? "").toLowerCase().includes(q.toLowerCase()));
  if (!open) {
    return (
      <button type="button" disabled={pending} onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-40">
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} tim
      </button>
    );
  }
  return (
    <div className="w-full rounded-lg border border-primary/40 bg-background p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari tim…" className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary" />
        <button type="button" onClick={() => { setOpen(false); setQ(""); }} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Tutup</button>
      </div>
      <div className="max-h-44 space-y-0.5 overflow-y-auto">
        {options.length === 0 && <div className="px-1 py-2 text-[11px] text-muted-foreground/70">{teams.length === 0 ? "Belum ada tim." : "Nggak ada yang cocok."}</div>}
        {q.trim().length > 1 && !teams.some((t) => t.name.toLowerCase() === q.trim().toLowerCase()) && (
          <button type="button" disabled={create.isPending} onClick={() => create.mutate(q.trim())} className="mt-0.5 flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-1.5 py-1.5 text-left text-[11px] font-semibold text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-50">
            {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Bikin tim &ldquo;{q.trim()}&rdquo;
          </button>
        )}
        {options.map((t) => (
          <button key={t.id} type="button" disabled={pending} onClick={() => { onPick(t.id); setOpen(false); setQ(""); }} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] font-semibold transition hover:bg-accent disabled:opacity-50">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color ?? "#7B2FBE" }} />
            <span className="truncate">{t.name}</span>
            {t.division?.name && <span className="ml-auto shrink-0 font-normal text-muted-foreground">{t.division.name}</span>}
          </button>
        ))}
      </div>
    </div>
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
      {overnight && <span title="Overnight — clock-out is the next day" role="img" aria-label="overnight shift" className="ml-0.5 text-sm">🌙</span>}
      {dirty ? (
        <button
          type="button"
          disabled={pending || invalid}
          onClick={() => onSave(startVal, endVal)}
          title={badFmt ? "Time format isn't right (e.g. 09:00 AM)" : partial ? "Fill in both clock-in & clock-out" : sameTime ? "Clock-in & clock-out can't be the same" : overnight ? "Save shift (overnight)" : "Save shift"}
          className="ml-0.5 rounded-md bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </button>
      ) : hasShift ? (
        <button type="button" disabled={pending} onClick={() => onSave(null, null)} title="Clear shift (back to default)" className="ml-0.5 rounded-md border border-border px-1.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-accent hover:text-rose-600">×</button>
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
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Day-off quota / month</div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="number" min={0} max={366} value={val} onChange={(e) => setVal(e.target.value)} className="w-20 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-primary" />
        <span className="text-xs text-muted-foreground">days / month</span>
        <button type="button" disabled={!dirty || m.isPending} onClick={() => m.mutate(n)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
          {m.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </button>
        {override !== null && <button type="button" disabled={m.isPending} onClick={() => m.mutate(null)} className="text-xs font-semibold text-muted-foreground transition hover:text-foreground hover:underline">Reset to default ({defaultQuota})</button>}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{override === null ? `Using workspace default (${defaultQuota} days).` : `Custom: ${override} days (default ${defaultQuota}).`}</p>
    </div>
  );
}

// Per-user day-off editor (BoD only): set the monthly day-off quota (override the default 4).
// Fixed weekly rest days for one person. The offices run seven days; before this, "Sunday is my
// day off" had to be filed as a day-off request every single week, and a forgotten one cost
// −150 XP plus a token. Saved through the same member PATCH as Flexi Time.
const REST_WEEKDAYS: { d: number; label: string }[] = [
  { d: 1, label: "Mon" }, { d: 2, label: "Tue" }, { d: 3, label: "Wed" }, { d: 4, label: "Thu" }, { d: 5, label: "Fri" }, { d: 6, label: "Sat" }, { d: 7, label: "Sun" },
];
function RestDaysEditor({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const membersQ = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const me = membersQ.data?.members?.find((m) => m.userId === userId);
  const current = me?.restDays ?? [];
  const m = useMutation({
    mutationFn: (days: number[]) => nexusApi.updateWorkspaceMember({ memberId: me!.id, restDays: days }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }),
    onError: (e: unknown) => alert(e instanceof Error ? e.message : "Couldn't save rest days."),
  });
  if (!me) return null;
  const toggle = (d: number) => m.mutate(current.includes(d) ? current.filter((x) => x !== d) : [...current, d].sort((a, b) => a - b));
  const preset = (days: number[]) => m.mutate(days);
  return (
    <div className="mb-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Rest days</span>
        {m.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {REST_WEEKDAYS.map((w) => {
          const on = current.includes(w.d);
          return (
            <button key={w.d} type="button" disabled={!canEdit || m.isPending} onClick={() => toggle(w.d)}
              className={cn("rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition", on ? "bg-violet-600 text-white ring-violet-600" : "bg-background text-muted-foreground ring-border hover:text-foreground", !canEdit && "opacity-70")}>
              {w.label}
            </button>
          );
        })}
      </div>
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <button type="button" onClick={() => preset([7])} className="text-primary hover:underline">Sunday off</button>
          <button type="button" onClick={() => preset([6, 7])} className="text-primary hover:underline">Sat + Sun off</button>
          <button type="button" onClick={() => preset([])} className="text-muted-foreground hover:underline">Works every day</button>
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {current.length ? "No reminder, lateness or absence on these days — no day-off request needed." : "Works every office day; a day off must be requested."}
      </p>
    </div>
  );
}

function DayoffModal({ user, canEdit, onClose }: { user: { id: string; name: string }; canEdit: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ["nexus", "dayoffs", user.id], queryFn: () => nexusApi.userDayoffs(user.id), retry: false });
  const data = q.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-bold tracking-tight">Day off — {user.name}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        {q.isLoading && <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}

        {/* Jatah day-off per bulan — bisa diubah dari default (4). */}
        {canEdit && data && <QuotaEditor userId={user.id} quota={data.baseQuota ?? data.quotaOverride ?? data.defaultQuota} override={data.quotaOverride} defaultQuota={data.defaultQuota} />}
        <RestDaysEditor userId={user.id} canEdit={canEdit} />

        {data && (
          <p className="text-xs text-muted-foreground">
            Used this period: <b className="text-foreground">{data.used} / {data.quota}</b>
            {(data.bonusDays ?? 0) > 0 && <span className="ml-1">({data.baseQuota} + {data.bonusDays} extra{data.bonusGrants?.length ? `: ${data.bonusGrants.map((g) => g.reason).join(", ")}` : ""})</span>}
            {data.used > data.quota && <span className="ml-1 font-semibold text-amber-600">(over quota)</span>}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Extra day off (owner, 28 Sep 2026): the BoD gives selected people X extra day-off days that count
 * in ONE attendance period (28th → 27th) only — e.g. for working a 3-day event. Unused days expire
 * with the period. Each person gets a push. Grants can be revoked while the period is still open.
 */
function ExtraDayOffAdmin({ members }: { members: Array<{ userId: string; name: string; email: string; avatar: string | null; role: string }> }) {
  const qc = useQueryClient();
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["nexus", "day-off-bonus", periodKey ?? "current"],
    queryFn: () => nexusApi.dayOffBonuses(periodKey ?? undefined),
    retry: false,
  });
  // Default to the period today is in, once the server has said which that is.
  useEffect(() => { if (!periodKey && list.data) setPeriodKey(list.data.currentPeriodKey); }, [periodKey, list.data]);
  const periods = list.data?.grantablePeriods ?? [];
  const current = list.data?.currentPeriodKey;

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const nameCmp = (a: string, b: string) => a.localeCompare(b, "id", { sensitivity: "base" });
  const sorted = useMemo(() => [...members].sort((a, b) => nameCmp(a.name || a.email, b.name || b.email)), [members]);
  const shown = sorted.filter((m) => {
    const t = search.trim().toLowerCase();
    return !t || (m.name ?? "").toLowerCase().includes(t) || (m.email ?? "").toLowerCase().includes(t);
  });
  const toggle = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const n = parseInt(days, 10);
  const daysValid = Number.isInteger(n) && n >= 1 && n <= 31;
  const reasonValid = reason.trim().length >= 3 && reason.trim().length <= 200;
  const canSubmit = !!periodKey && selected.size > 0 && daysValid && reasonValid;
  const periodLabelOf = (k: string | null) => periods.find((p) => p.periodKey === k)?.periodLabel ?? list.data?.periodLabel ?? k ?? "";

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["nexus", "day-off-bonus"] });
    qc.invalidateQueries({ queryKey: ["attendance-dayoff-summary"] });
    qc.invalidateQueries({ queryKey: ["attendance-history"] });
    qc.invalidateQueries({ queryKey: ["attendance-today"] });
    qc.invalidateQueries({ queryKey: ["nexus", "dayoffs"] });
  };
  const grant = useMutation({
    mutationFn: () => nexusApi.grantDayOffBonus({ userIds: [...selected], periodKey: periodKey!, days: n, reason: reason.trim() }),
    onSuccess: (r) => {
      refreshAll();
      toast.success(`${r.grants.length} ${r.grants.length === 1 ? "person" : "people"} got ${r.days} extra day${r.days === 1 ? "" : "s"} off`, {
        description: `Period ${r.periodLabel}. ${r.notified < r.grants.length ? `${r.notified} of ${r.grants.length} notified.` : r.grants.length === 1 ? "They were notified." : `All ${r.grants.length} were notified.`}`,
      });
      setSelected(new Set()); setReason(""); setDays("1");
    },
    onError: (e: unknown) => toast.error("Couldn't give extra day off", { description: e instanceof ApiError ? e.message : "Try again." }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => nexusApi.revokeDayOffBonus(id),
    onSuccess: (r) => { refreshAll(); toast.success(r.alreadyRevoked ? "Already revoked" : `Revoked ${r.grant.user?.name ?? "the grant"}’s extra day off`); },
    onError: (e: unknown) => toast.error("Couldn't revoke", { description: e instanceof ApiError ? e.message : "Try again." }),
  });
  const submit = () => {
    if (!canSubmit) return;
    const who = selected.size === 1 ? (members.find((m) => selected.has(m.userId))?.name ?? "1 person") : `${selected.size} people`;
    if (!window.confirm(`Give ${who} ${n} extra day${n === 1 ? "" : "s"} off for the period ${periodLabelOf(periodKey)}?\n\nReason: ${reason.trim()}\n\nEach person gets a notification. Unused days expire when the period ends.`)) return;
    grant.mutate();
  };
  const grants = list.data?.grants ?? [];
  const active = grants.filter((g) => g.active);
  const revoked = grants.filter((g) => !g.active);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-soft md:p-5">
        <div>
          <h2 className="font-display text-base font-bold tracking-tight">Give extra day off</h2>
          <p className="mt-1 text-xs text-muted-foreground">Adds day-off days for <b className="text-foreground">one attendance period</b> (28th → 27th) on top of each person’s quota — e.g. after working an event. Unused days expire when the period ends. Missed check-ins are still deducted as usual.</p>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Period</div>
          {list.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
            <div className="flex flex-wrap gap-1.5">
              {periods.map((p) => (
                <button key={p.periodKey} type="button" onClick={() => setPeriodKey(p.periodKey)}
                  className={cn("rounded-full px-3 py-1 text-xs font-semibold ring-1 transition", periodKey === p.periodKey ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border hover:text-foreground")}>
                  {p.periodLabel}{p.periodKey === current ? " · current" : p.periodKey < (current ?? "") ? " · previous" : " · next"}
                </button>
              ))}
            </div>
          )}
          {list.isError && <p className="mt-1 text-xs text-rose-600">{list.error instanceof ApiError ? list.error.message : "Couldn't load grants."}</p>}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">People · {selected.size} selected</span>
            <span className="flex gap-2 text-[11px]">
              <button type="button" onClick={() => setSelected((cur) => new Set([...cur, ...shown.map((m) => m.userId)]))} className="font-semibold text-primary hover:underline">Select shown</button>
              <button type="button" onClick={() => setSelected(new Set())} className="text-muted-foreground hover:underline">Clear</button>
            </span>
          </div>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email…" className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" />
          </div>
          {selected.size > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {sorted.filter((m) => selected.has(m.userId)).map((m) => (
                <span key={m.userId} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {m.name || m.email}
                  <button type="button" aria-label={`Remove ${m.name}`} onClick={() => toggle(m.userId)}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
            {shown.length === 0 && <div className="py-6 text-center text-xs text-muted-foreground">No one matches “{search}”.</div>}
            {shown.map((m) => (
              <label key={m.userId} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 text-sm last:border-b-0 hover:bg-accent/50">
                <input type="checkbox" checked={selected.has(m.userId)} onChange={() => toggle(m.userId)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                <Avatar userId={m.userId} name={m.name} avatar={m.avatar} size={22} />
                <span className="min-w-0 flex-1 truncate">{m.name || m.email}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{ORG_ROLE_LABEL[m.role] ?? m.role}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Days</span>
            <input type="number" inputMode="numeric" min={1} max={31} value={days} onChange={(e) => setDays(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Reason (required)</span>
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Worked the 3-day Jakarta event" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </label>
        </div>
        {!daysValid && days !== "" && <p className="text-[11px] text-rose-600">Days must be a whole number from 1 to 31.</p>}

        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/40 px-3 py-2">
          <span className="text-sm">
            <b>{selected.size}</b> {selected.size === 1 ? "person" : "people"} × <b>{daysValid ? n : "?"}</b> {n === 1 ? "day" : "days"}
            {periodKey && <span className="text-muted-foreground"> · {periodLabelOf(periodKey)}</span>}
          </span>
          <button type="button" disabled={!canSubmit || grant.isPending} onClick={submit} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
            {grant.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />} Give extra day off
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft md:p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-bold tracking-tight">Grants · {periodLabelOf(periodKey)}</h2>
          <span className="text-xs text-muted-foreground">{active.length} active{revoked.length ? ` · ${revoked.length} revoked` : ""}</span>
        </div>
        {list.isLoading && <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {!list.isLoading && grants.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <CalendarPlus className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60" />
            <div className="text-sm font-semibold">No extra day off in this period yet</div>
            <p className="mt-1 text-xs text-muted-foreground">Pick people on the left, set the days and a reason, and they’ll see it in their day-off quota right away.</p>
          </div>
        )}
        <ul className="divide-y divide-border">
          {[...active, ...revoked].map((g: NexusDayOffBonus) => (
            <li key={g.id} className={cn("flex items-start gap-2 py-2", !g.active && "opacity-50")}>
              <Avatar userId={g.userId} name={g.user?.name ?? null} avatar={g.user?.avatar ?? null} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="truncate text-sm font-semibold">{g.user?.name ?? g.user?.email ?? "Unknown"}</span>
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">+{g.days} DO</span>
                </div>
                <div className="truncate text-xs text-muted-foreground" title={g.reason}>{g.reason}</div>
                <div className="text-[10px] text-muted-foreground">
                  {g.active
                    ? `by ${g.grantedBy?.name ?? "—"} · ${fmtDate(g.createdAt)}`
                    : `revoked by ${g.revokedBy?.name ?? "—"} · ${g.revokedAt ? fmtDate(g.revokedAt) : ""}`}
                </div>
              </div>
              {g.active && (
                <button type="button" disabled={revoke.isPending}
                  onClick={() => { if (window.confirm(`Revoke ${g.user?.name ?? "this person"}’s ${g.days} extra day${g.days === 1 ? "" : "s"} off (${g.reason})?\n\nDays already taken are not undone.`)) revoke.mutate(g.id); }}
                  className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-40">
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
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
  const ready = confirmTxt.trim().toUpperCase() === "DELETE";
  const reassignedTotal = result ? Object.values(result.reassigned).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-bold tracking-tight text-rose-700">Delete account permanently</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm">✅ Account <b>{result.deletedUser.name}</b> <span className="text-muted-foreground">({result.deletedUser.email})</span> has been permanently deleted.</p>
            {reassignedTotal > 0 && <p className="text-xs text-muted-foreground">{reassignedTotal} item{reassignedTotal === 1 ? "" : "s"} (task/file/quest/portfolio) they created were reassigned to your account so nothing is lost.</p>}
            <button onClick={onClose} className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90">Done</button>
          </div>
        ) : (
          <>
            <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <p>You're about to <b>permanently delete</b> the account:</p>
              <p className="mt-1 font-bold">{user.name} <span className="font-normal">· {user.email}</span></p>
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                <li>Tasks, files, quests, portfolios, goals, docs & schedules they created are <b>reassigned to you</b> (not lost).</li>
                <li>Their status updates, pending invites & audit trail are deleted. Their comments are removed too.</li>
                <li>This action <b>can't be undone</b>.</li>
              </ul>
            </div>
            <label className="block text-xs font-semibold text-muted-foreground">Type <b className="text-rose-700">DELETE</b> to confirm
              <input autoFocus value={confirmTxt} onChange={(e) => setConfirmTxt(e.target.value)} placeholder="DELETE" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-rose-400" />
            </label>
            {err && <p className="mt-2 text-xs font-semibold text-rose-600">{(err.payload as { message?: string } | undefined)?.message ?? err.message}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={onClose} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-accent">Cancel</button>
              <button disabled={!ready || m.isPending} onClick={() => m.mutate()} className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-40">
                {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete permanently
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// The audit view lives in components/audit/AuditLogView.tsx (list + detail drawer).
function AuditLog() {
  return <AuditLogView />;
}

const REQ_TYPES = [
  { value: "specific_tasks", label: "Complete specific tasks (pick tasks)" },
  { value: "task_count", label: "Complete N tasks" },
  { value: "overdue_cleared", label: "Clear N overdue" },
  { value: "priority_done", label: "Complete N Urgent" },
  { value: "has_overdue", label: "Have ≥N overdue tasks (penalty)" },
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

  // Task-based quest (specific_tasks): pick exact tasks. Done = all DONE; XP to doers; visible to project members.
  const isTasks = requirementType === "specific_tasks";
  const [questTasks, setQuestTasks] = useState<{ id: string; title: string }[]>([]);
  const [taskSearch, setTaskSearch] = useState("");
  const taskSearchQ = useQuery({
    queryKey: ["quest-task-search-admin", taskSearch],
    queryFn: () => nexusApi.tasks(`search=${encodeURIComponent(taskSearch.trim())}`),
    enabled: isTasks && taskSearch.trim().length >= 2,
    staleTime: 10_000,
  });
  const taskResults = (taskSearchQ.data ?? []).filter((r) => !questTasks.some((t) => t.id === r.id)).slice(0, 8);

  const create = useMutation({
    mutationFn: () => isTasks
      ? nexusApi.createAdminQuest({ title: title.trim(), requirementType: "specific_tasks", xpReward: Math.min(50, Math.max(0, Number(xpReward) || 0)), taskIds: questTasks.map((t) => t.id), deadline: deadline || null })
      : nexusApi.createAdminQuest({ workspaceId, title: title.trim(), requirementType, requiredCount: Number(requiredCount), xpReward: Math.min(50, Math.max(0, Number(xpReward) || 0)), teamIds: Array.from(selectedTeams), deadline: deadline || null }),
    onSuccess: () => { setTitle(""); setDeadline(""); setSelectedTeams(new Set()); setQuestTasks([]); setTaskSearch(""); invalidate(); },
  });
  const del = useMutation({ mutationFn: (id: string) => nexusApi.deleteAdminQuest(id), onSuccess: invalidate });
  const inputCls = "rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className="space-y-4">
      {list.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><Trophy className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">BoD access required</div><p className="mt-2 text-sm text-muted-foreground">You need the BoD/Manager role to manage quests.</p></div>}
      {!list.isError && (
        <>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <h2 className="mb-1 font-display text-base font-bold tracking-tight">Assign a new quest</h2>
            <p className="mb-3 text-xs text-muted-foreground">Create a quest for the crew: finish tasks against a target & deadline, reward XP (max 50).</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quest title (e.g. Finish 5 tasks this week)" className={cn(inputCls, "sm:col-span-2")} />
              <label className="text-xs font-semibold text-muted-foreground">Type
                <select value={requirementType} onChange={(e) => setRequirementType(e.target.value)} className={cn(inputCls, "mt-1 w-full font-normal")}>
                  {REQ_TYPES.filter((r) => r.value !== "penalty").map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              {!isTasks && (
                <label className="text-xs font-semibold text-muted-foreground">Target (number of tasks)
                  <input value={requiredCount} onChange={(e) => setRequiredCount(e.target.value.replace(/[^0-9]/g, ""))} className={cn(inputCls, "mt-1 w-full")} />
                </label>
              )}
              <label className="text-xs font-semibold text-muted-foreground">Deadline (time limit)
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={cn(inputCls, "mt-1 w-full")} />
              </label>
              <label className="text-xs font-semibold text-muted-foreground">XP reward (max 50)
                <input type="number" min={0} max={50} value={xpReward} onChange={(e) => setXpReward(String(Math.min(50, Math.max(0, parseInt(e.target.value, 10) || 0))))} className={cn(inputCls, "mt-1 w-full")} />
              </label>
            </div>
            {isTasks ? (
              <div className="mt-3">
                <span className="text-xs font-semibold text-muted-foreground">Tasks for this quest <span className="font-normal">(complete when all are DONE · XP goes to whoever does them · visible to members of the task's project)</span></span>
                <div className="mt-1.5 space-y-1">
                  {questTasks.length === 0 && <p className="text-xs text-muted-foreground">No tasks picked yet. Search below.</p>}
                  {questTasks.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <button type="button" onClick={() => setQuestTasks((prev) => prev.filter((x) => x.id !== t.id))} className="rounded p-0.5 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
                <div className="relative mt-1.5">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} placeholder="Search tasks to add (min 2 letters)…" className={cn(inputCls, "w-full border-dashed pl-8")} />
                </div>
                {taskResults.length > 0 && (
                  <div className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-background p-1">
                    {taskResults.map((r) => (
                      <button key={r.id} type="button" onClick={() => { setQuestTasks((prev) => [...prev, { id: r.id, title: r.title }]); setTaskSearch(""); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> <span className="min-w-0 flex-1 truncate">{r.title}</span>
                        {r.taskList?.project?.name && <span className="shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{r.taskList.project.name}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-3">
                <span className="text-xs font-semibold text-muted-foreground">Assign to team <span className="font-normal">(pick one or more · empty = whole crew)</span></span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {teams.length === 0 && <span className="text-xs text-muted-foreground">No teams yet.</span>}
                  {teams.map((t) => {
                    const on = selectedTeams.has(t.id);
                    return <button key={t.id} type="button" onClick={() => toggleTeam(t.id)} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}><span className="h-2 w-2 rounded-full" style={{ background: t.color ?? "#7b68ee" }} />{t.name}</button>;
                  })}
                </div>
              </div>
            )}
            <button disabled={!title.trim() || !workspaceId || create.isPending || (isTasks && questTasks.length === 0)} onClick={() => create.mutate()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {isTasks ? "Create quest" : "Assign quest"}</button>
            {create.isError && <span className="ml-2 text-xs font-semibold text-destructive">Failed — check your access.</span>}
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
                      <span>{REQ_TYPES.find((r) => r.value === q.requirementType)?.label ?? q.requirementType}{q.requirementType === "specific_tasks" ? ` · ${q.requiredCount} task${q.requiredCount === 1 ? "" : "s"}` : ` · target ${q.requiredCount}`}</span>
                      <span className="font-bold text-success">+{q.xpReward} XP</span>
                      {q.deadline && <span>· ⏰ until {fmtDate(q.deadline)}</span>}
                      {q.requirementType === "specific_tasks"
                        ? <span>· members of the task's project</span>
                        : <span>· {q.teamIds && q.teamIds.length > 0 ? q.teamIds.map(teamName).join(", ") : "Whole crew"}</span>}
                    </div>
                  </div>
                  <button onClick={() => { if (confirm("Delete this quest?")) del.mutate(q.id); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            {!list.isLoading && rows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">No quests yet. Create one above.</div>}
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
  const [audience, setAudience] = useState<"all" | "some">("all");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  // Repeat. 0 = post once, which is what every announcement did before this existed.
  const [repeatDays, setRepeatDays] = useState(0);
  const [repeatAtTime, setRepeatAtTime] = useState("09:00");
  // SP (surat peringatan): a PDF attached makes the announcement kind "sp" — a red SP badge and an
  // Open PDF button in the pop-up. Uploaded as soon as it is picked; Post sends only its URL.
  const [spOn, setSpOn] = useState(false);
  const [attachment, setAttachment] = useState<{ url: string; name: string; size: number } | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => nexusApi.uploadAnnouncementAttachment(file),
    onSuccess: (r) => setAttachment(r),
    onError: (e: unknown) => toast.error("Couldn't attach the PDF", { description: e instanceof ApiError ? e.message : "Try again." }),
  });
  const membersQ = useQuery({ queryKey: ["members"], queryFn: nexusApi.members, staleTime: 300_000 });
  const members = useMemo(() => { const raw = membersQ.data; return (Array.isArray(raw) ? raw : raw?.members ?? []); }, [membersQ.data]);
  const filteredMembers = useMemo(() => members.filter((m) => (m.name ?? m.email ?? "").toLowerCase().includes(memberSearch.toLowerCase())).slice(0, 8), [members, memberSearch]);
  const toggleTarget = (id: string) => setTargetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["nexus", "announcements"] }); qc.invalidateQueries({ queryKey: ["announcements-active"] }); };
  const create = useMutation({
    mutationFn: () => nexusApi.createAnnouncement({
      title: title.trim(), body: body.trim(), tone, targetUserIds: audience === "some" ? targetIds : [], repeatDays, repeatAtTime,
      ...(spOn && attachment ? { kind: "sp" as const, attachmentUrl: attachment.url, attachmentName: attachment.name } : {}),
    }),
    onSuccess: () => { setTitle(""); setBody(""); setTone("info"); setAudience("all"); setTargetIds([]); setMemberSearch(""); setRepeatDays(0); setRepeatAtTime("09:00"); setSpOn(false); setAttachment(null); invalidate(); toast.success("Posted"); },
    onError: (e: unknown) => toast.error("Couldn't post", { description: e instanceof ApiError ? e.message : "Try again." }),
  });
  const toggle = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => nexusApi.updateAnnouncement(id, { active }), onSuccess: invalidate });
  const del = useMutation({ mutationFn: (id: string) => nexusApi.deleteAnnouncement(id), onSuccess: invalidate });
  const rows = list.data?.announcements ?? [];

  return (
    <div className="space-y-5">
      {list.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><Megaphone className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">BoD access required</div><p className="mt-2 text-sm text-muted-foreground">You need the BoD role or above to manage announcements.</p></div>}
      {!list.isError && (
        <>
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="text-sm font-bold">Create a pop-up announcement</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Announcement body… (multiple lines OK)" className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />

            {/* Audience: everyone, or specific people */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Audience</span>
                <div className="flex rounded-lg border border-border p-0.5">
                  {(["all", "some"] as const).map((a) => (
                    <button key={a} onClick={() => setAudience(a)} className={cn("rounded-md px-2.5 py-1 text-xs font-bold transition-colors", audience === a ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>{a === "all" ? "Everyone" : "Selected people"}</button>
                  ))}
                </div>
              </div>
              {audience === "some" && (
                <div className="space-y-2 rounded-xl border border-border bg-background p-2.5">
                  {targetIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {targetIds.map((id) => { const u = members.find((m) => m.id === id); return (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                          {u?.name ?? "user"} <button onClick={() => toggleTarget(id)} aria-label="Remove"><X className="h-3 w-3" /></button>
                        </span>
                      ); })}
                    </div>
                  )}
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Search a name to add…" className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary" />
                  </div>
                  {memberSearch && (
                    <div className="max-h-40 space-y-0.5 overflow-y-auto">
                      {filteredMembers.map((m) => (
                        <button key={m.id} onClick={() => { toggleTarget(m.id); setMemberSearch(""); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                          <Avatar userId={m.id} name={m.name} avatar={m.avatar} size={22} /> <span className="truncate">{m.name ?? m.email}</span>
                          {targetIds.includes(m.id) && <span className="ml-auto text-xs font-bold text-primary">✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* SP: attach a PDF (surat peringatan). Usually sent to selected people only. */}
            <div className="space-y-2">
              <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={spOn} onChange={(e) => { setSpOn(e.target.checked); if (!e.target.checked) setAttachment(null); }} className="h-4 w-4 accent-rose-600" />
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" /> Attach PDF (SP)
              </label>
              {spOn && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/50 p-2.5 dark:border-rose-900 dark:bg-rose-950/20">
                  {attachment ? (
                    <>
                      <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white">SP</span>
                      <a href={attachment.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-sm font-semibold text-foreground hover:underline"><FileText className="h-4 w-4 shrink-0 text-rose-600" />{attachment.name}</a>
                      <span className="text-xs text-muted-foreground">{(attachment.size / 1024 / 1024).toFixed(2)} MB</span>
                      <button onClick={() => setAttachment(null)} aria-label="Remove PDF" className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
                    </>
                  ) : (
                    <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent", upload.isPending && "pointer-events-none opacity-60")}>
                      {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                      {upload.isPending ? "Uploading…" : "Choose PDF (max 10 MB)"}
                      <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        if (f.size > 10 * 1024 * 1024) { toast.error("PDF is larger than 10 MB"); return; }
                        upload.mutate(f);
                      }} />
                    </label>
                  )}
                  <span className="w-full text-xs text-muted-foreground">Shown with a red SP badge and an Open PDF button in the pop-up.{audience === "all" ? " This goes to everyone — pick Selected people for a personal SP." : ""}</span>
                </div>
              )}
            </div>

            {/* Repeat. A notice posted once reaches whoever happened to open NEXUS that hour; "wear
                your ID card this week" has to be said on each of those days, and re-typing it daily
                is how it stops being said at all. */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Repeat</span>
                <div className="flex rounded-lg border border-border p-0.5">
                  {[0, 2, 3, 5, 7].map((d) => (
                    <button key={d} onClick={() => setRepeatDays(d)} className={cn("rounded-md px-2.5 py-1 text-xs font-bold transition-colors", repeatDays === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>{d === 0 ? "Once" : `${d} more days`}</button>
                  ))}
                </div>
                {repeatDays > 0 && (
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    at
                    <input type="time" value={repeatAtTime} onChange={(e) => setRepeatAtTime(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary" />
                    WIB
                  </label>
                )}
              </div>
              {repeatDays > 0 && (
                <p className="text-xs text-muted-foreground">
                  Goes out now, then again each day for {repeatDays} more {repeatDays === 1 ? "day" : "days"} at about {repeatAtTime} — pop-up and push both. It reappears for everyone each time, including people who already dismissed it.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select value={tone} onChange={(e) => setTone(e.target.value)} className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="info">Info (blue)</option>
                <option value="success">Success (green)</option>
                <option value="warning">Warning (yellow)</option>
              </select>
              <button onClick={() => create.mutate()} disabled={!title.trim() || !body.trim() || create.isPending || (audience === "some" && targetIds.length === 0) || (spOn && !attachment)} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />} Post
              </button>
              <span className="text-xs text-muted-foreground">{audience === "some" ? `Shows only to the ${targetIds.length} selected ${targetIds.length === 1 ? "person" : "people"}.` : "Shows once to every user."}</span>
            </div>
          </div>

          <div className="space-y-2">
            {list.isLoading && <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            {rows.map((a: NexusAdminAnnouncement) => (
              <div key={a.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-soft">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.kind === "sp" && <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white">SP</span>}
                    {a.kind === "warning" && <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-black uppercase text-white">Warning</span>}
                    <span className="text-sm font-bold">{a.title}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", a.active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>{a.active ? "Active" : "Inactive"}</span>
                    {a.repeatUntil && new Date(a.repeatUntil) >= new Date(new Date().toDateString()) && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">Repeats daily {a.repeatAtTime} until {new Date(a.repeatUntil).toLocaleDateString()}</span>
                    )}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{a.tone}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{a.body}</p>
                  {a.attachmentUrl && (
                    <a href={a.attachmentUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><FileText className="h-3.5 w-3.5" />{a.attachmentName ?? "PDF"}</a>
                  )}
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {fmtDate(a.createdAt)} · {a.targetCount
                      ? `to ${a.targets?.length ? a.targets.slice(0, 4).map((t) => t.name ?? "?").join(", ") + (a.targets.length > 4 ? ` +${a.targets.length - 4}` : "") : `${a.targetCount} ${a.targetCount === 1 ? "person" : "people"}`}`
                      : "to everyone"} · {a.seenCount} read
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => toggle.mutate({ id: a.id, active: !a.active })} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-accent">{a.active ? "Deactivate" : "Activate"}</button>
                  <button onClick={() => del.mutate(a.id)} aria-label="Delete" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
            {!list.isLoading && rows.length === 0 && <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">No announcements yet.</div>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Who uses GIDEON, and how much.
 *
 * Counts and dates only. What somebody asked an assistant is between them and it — a screen that
 * showed the questions would change how people use it, and the ones who most need the help would
 * stop asking.
 */
function GideonUsage() {
  const q = useQuery({ queryKey: ["nexus", "gideon-usage"], queryFn: nexusApi.gideonUsage, retry: false });
  const users = q.data?.users ?? [];
  const totals = q.data?.totals;

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";

  if (q.isLoading) return <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">Memuat…</div>;
  if (q.isError) return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">Nggak bisa memuat pemakaian GIDEON.</div>;

  return (
    <div className="space-y-4">
      {totals && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Pemakai" value={totals.people} />
          <Stat label="Pertanyaan" value={totals.asked} />
          <Stat label="Tool dipakai" value={totals.toolCalls} />
        </div>
      )}

      {users.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft">
          <GideonMark className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <div className="text-lg font-bold">Belum ada yang pakai GIDEON</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Orang</th>
                <th className="px-4 py-3 text-right font-semibold">Tanya</th>
                <th className="px-4 py-3 text-right font-semibold">Tool</th>
                <th className="px-4 py-3 font-semibold">Pertama</th>
                <th className="px-4 py-3 font-semibold">Terakhir</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{u.name}</div>
                    {u.email && <div className="text-xs text-muted-foreground">{u.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{u.asked}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{u.toolCalls}</td>
                  <td className="px-4 py-3 text-muted-foreground">{when(u.firstUsed)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{when(u.lastUsed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Who has the app, and which build they are on.
 *
 * One row per person, showing their most recently seen device: the question is which build somebody
 * is running, not how many phones they own. "Belum dilaporkan" is honest — the version columns are
 * newer than most installs, and a guess would be worse than a blank.
 */
function AppInstalls() {
  const q = useQuery({ queryKey: ["nexus", "app-installs"], queryFn: nexusApi.appInstalls, retry: false });
  const installs = q.data?.installs ?? [];
  const notInstalled = q.data?.notInstalled ?? [];
  const totals = q.data?.totals;

  const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  if (q.isLoading) return <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">Loading…</div>;
  if (q.isError) return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">Couldn't load the app list.</div>;

  return (
    <div className="space-y-4">
      {totals && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Using the app" value={totals.people} />
          <Stat label="Not using it" value={totals.notInstalled ?? notInstalled.length} />
          <Stat label="Devices" value={totals.devices} />
        </div>
      )}

      {totals && totals.versions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {totals.versions.map((v) => (
            <span key={v.version} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold">
              {v.version === "unknown" ? "Not reported" : v.version} · {v.count}
            </span>
          ))}
        </div>
      )}

      {installs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft">
          <Smartphone className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <div className="text-lg font-bold">Nobody has installed the app yet</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Person</th>
                <th className="px-4 py-3 font-semibold">Version</th>
                <th className="px-4 py-3 font-semibold">Device</th>
                <th className="px-4 py-3 font-semibold">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {installs.map((i) => (
                <tr key={i.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{i.user.name}</div>
                    {i.user.email && <div className="text-xs text-muted-foreground">{i.user.email}</div>}
                  </td>
                  {/* One line per device: someone on an iPhone and an Android phone shows both. */}
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {(i.devices?.length ? i.devices : [i]).map((d) => (
                        <div key={d.id} className="tabular-nums">
                          {d.appVersion ? (
                            <span className="font-semibold">{d.appVersion}{d.buildNumber ? ` (${d.buildNumber})` : ""}</span>
                          ) : (
                            <span className="text-muted-foreground">Not reported</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="space-y-1">
                      {(i.devices?.length ? i.devices : [i]).map((d) => (
                        <div key={d.id}>{d.osVersion ?? d.deviceModel ?? "—"}</div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="space-y-1">
                      {(i.devices?.length ? i.devices : [i]).map((d) => (
                        <div key={d.id}>{when(d.lastSeenAt)}</div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {notInstalled.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Not using the app · {notInstalled.length}</div>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
            <table className="w-full text-sm">
              <tbody>
                {notInstalled.map((m) => (
                  <tr key={m.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{m.name}</div>
                      {m.email && <div className="text-xs text-muted-foreground">{m.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {m.lastActiveAt ? `Web only · last active ${when(m.lastActiveAt)}` : "Never signed in"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
