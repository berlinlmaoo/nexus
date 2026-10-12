import { GideonInsights } from "@/components/gideon/GideonInsights";
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Avatar } from "@/components/Avatar";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, CalendarDays, CalendarPlus, CalendarX2, ChevronDown, FileText, FolderKanban, GitBranch, Network, Link2, Link2Off, Loader2, Megaphone, Paperclip, Plus, ScrollText, Search, Settings2, Shield, ShieldAlert, Trash2, Trophy, Users as UsersIcon, X, Zap, Smartphone, RotateCcw, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { ApprovalChart } from "@/components/ApprovalChart";
import { OrgChart } from "@/components/OrgChart";
import { type NexusAdminAnnouncement, type NexusDayOffBonus } from "@/lib/nexus-api";
import { GideonMark } from "@/components/gideon/GideonMark";
import { PageHeader } from "@/components/PageHeader";
import { ApiError, fmtDate, fmtTime, nexusApi, statusLabel, ORG_ROLE_LABEL, ORG_ROLE_TONE, assignableRoles, canEditTier, type OrgRole, type NexusAdminUser, type GoogleWorkspaceAccount, type NexusUserMemberships, type NexusTeam, type NexusOffboardResult, type OffboardReason } from "@/lib/nexus-api";
// Crew Hub tidak punya halaman lagi. Pengaturan TIM-nya sendiri — nama, divisi, jam shift,
// tautan project, hapus — dibuka dari chip tim di baris ORANGNYA, memakai kartu yang sama
// persis seperti dulu. Tidak ada tim yang jadi tak terjangkau: ke-21 tim punya minimal satu
// anggota, jadi semuanya bisa diraih dari daftar ini.
import { TeamCard, DivisionManager } from "./teams";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { AuditLogView } from "@/components/audit/AuditLogView";
import { SuspectAttendanceAdmin } from "@/components/attendance/SuspectAttendanceAdmin";
import { CalendarSettingsAdmin } from "@/components/calendar/CalendarSettingsAdmin";
import { useLang } from "@/lib/lang";
import { LeftTag } from "@/components/LeftTag";

export const Route = createFileRoute("/_app/admin")({ component: Admin });

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function Admin() {
  const qc = useQueryClient();
  const lang = useLang();
  const { t, tn } = lang;
  const [view, setView] = useState<"users" | "approval" | "org" | "extra-dayoff" | "suspects" | "audit" | "quests" | "announcements" | "gideon" | "app" | "calendar">("users");
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | "ONE_ABOVE_ALL" | "BOD" | "MANAGER" | "STAFF">("ALL");
  const [dayoffUser, setDayoffUser] = useState<{ id: string; name: string } | null>(null);
  const [delUser, setDelUser] = useState<{ id: string; name: string; email: string; deactivated?: boolean } | null>(null);
  // Offboarding (someone left the company) and its undo. One dialog each for the whole table.
  const [offboardTarget, setOffboardTarget] = useState<NexusAdminUser | null>(null);
  const [reinstateTarget, setReinstateTarget] = useState<NexusAdminUser | null>(null);
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
  // Offboard / reinstate: the same people as delete, plus a system admin (POST …/offboard checks
  // again, including the rank rule). Never on your own row.
  const me = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 60_000 }).data?.user;
  const isSystemAdmin = me?.role === "ADMIN";
  const canOffboard = canDeleteUsers || isSystemAdmin;
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
        toast.warning(tn(r.orphaned.length, "{n} person lost their approver", "{n} people lost their approver"), {
          description: t("{names} — place them again in the Approval chart tab.", { names: r.orphaned.map((o) => o.name ?? "?").join(", ") }),
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
    onError: (e: unknown) => toast.error(t("Couldn't add them to the project"), { description: e instanceof ApiError ? e.message : t("You need LEAD access in that project.") }),
  });
  const removeFromProject = useMutation({
    mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) => nexusApi.removeProjectMember(projectId, userId),
    onSuccess: refreshMemberships,
    onError: (e: unknown) => toast.error(t("Couldn't remove them from the project"), { description: e instanceof ApiError ? e.message : t("You need LEAD access in that project.") }),
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
      const moved = r.absorbed?.length ? t(" · personal workspace \"{name}\" deleted", { name: r.absorbed[0] }) : "";
      toast.success(t("{name} joined as Staff", { name: r.member?.name ?? t("The account") }) + moved, { description: t("Place them under their manager in the Approval chart.") });
      if (r.kept?.length) toast.warning(t("They still have another workspace that isn't empty"), { description: t("{names} — left as it is. They may land there instead of here.", { names: r.kept.join(", ") }) });
      if (r.emailSent === false) toast.warning(t("The notification email wasn't sent"), { description: t("They're in the workspace but don't know it yet. Tell them yourself.") });
    },
    onError: (e: unknown) => toast.error(t("Couldn't add them"), { description: e instanceof ApiError ? e.message : t("Try again.") }),
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
      <PageHeader title={t("Control Room")} subtitle={t("Everyone in the workspace and their roles.")} />
      <div className="p-4 md:p-8 space-y-5">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-background p-0.5 w-fit">
          <button onClick={() => setView("users")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "users" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><UsersIcon className="h-3.5 w-3.5" /> {t("Users")}</button>
          {canAnnounce && <button onClick={() => setView("approval")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "approval" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><GitBranch className="h-3.5 w-3.5" /> {t("Approval chart")}</button>}
          {canAnnounce && <button onClick={() => setView("org")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "org" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><Network className="h-3.5 w-3.5" /> {t("IP & Division Chart")}</button>}
          {canAnnounce && <button onClick={() => setView("calendar")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><CalendarDays className="h-3.5 w-3.5" /> {t("Calendar")}</button>}
          {canManageShift && <button onClick={() => setView("extra-dayoff")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "extra-dayoff" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><CalendarPlus className="h-3.5 w-3.5" /> {t("Extra day off")}</button>}
          {canManageShift && <button onClick={() => setView("suspects")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "suspects" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><ShieldAlert className="h-3.5 w-3.5" /> {t("Attendance monitor")}</button>}
          <button onClick={() => setView("audit")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "audit" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><ScrollText className="h-3.5 w-3.5" /> {t("Audit log")}</button>
          <button onClick={() => setView("quests")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "quests" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><Trophy className="h-3.5 w-3.5" /> {t("Goals")}</button>
          {canAnnounce && <button onClick={() => setView("announcements")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "announcements" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><Megaphone className="h-3.5 w-3.5" /> {t("Announcements")}</button>}
          {canAnnounce && <button onClick={() => setView("gideon")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "gideon" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><GideonMark className="h-3.5 w-3.5" /> GIDEON</button>}
          {canAnnounce && <button onClick={() => setView("app")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", view === "app" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}><Smartphone className="h-3.5 w-3.5" /> {t("App")}</button>}
        </div>

        {view === "approval" && canAnnounce && <ApprovalChart />}
        {view === "org" && canAnnounce && <OrgChart />}
        {view === "calendar" && canAnnounce && <CalendarSettingsAdmin />}
        {view === "extra-dayoff" && canManageShift && <ExtraDayOffAdmin members={wsMembers} />}
        {view === "suspects" && canManageShift && <SuspectAttendanceAdmin />}
        {view === "audit" && <AuditLog />}
        {view === "quests" && <AdminQuests />}
        {view === "announcements" && canAnnounce && <AnnouncementsAdmin />}
        {view === "gideon" && canAnnounce && <GideonAdmin />}
        {view === "app" && canAnnounce && <AppInstalls />}

        {view === "users" && users.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><Shield className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">{t("Admin access required")}</div><p className="mt-2 text-sm text-muted-foreground">{t("You need the system admin role to manage users.")}</p></div>}

        {view === "users" && !users.isError && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label={t("Total users")} value={totalUsers} active={roleFilter === "ALL"} onClick={() => setRoleFilter("ALL")} />
              <Stat label="One Above All" value={orgCount("ONE_ABOVE_ALL")} active={roleFilter === "ONE_ABOVE_ALL"} onClick={() => toggleRole("ONE_ABOVE_ALL")} />
              <Stat label="BoD" value={orgCount("BOD")} active={roleFilter === "BOD"} onClick={() => toggleRole("BOD")} />
              <Stat label="Manager" value={orgCount("MANAGER")} active={roleFilter === "MANAGER"} onClick={() => toggleRole("MANAGER")} />
              <Stat label="Staff" value={orgCount("STAFF")} active={roleFilter === "STAFF"} onClick={() => toggleRole("STAFF")} />
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5 shrink-0" />
              <span>{t("Role hierarchy:")} <b className="text-foreground">One Above All › BoD › Manager › Staff</b>. {t("You can only give roles below your own level.")}</span>
              <Link to="/settings" className="ml-auto font-semibold text-primary hover:underline">{t("Also in Settings › Members →")}</Link>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search name or email…")} className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" />
              </div>
              {roleFilter !== "ALL" && (
                <button onClick={() => setRoleFilter("ALL")} className="inline-flex items-center gap-1.5 rounded-xl border border-primary bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
                  Filter: {ORG_ROLE_LABEL[roleFilter] ?? roleFilter} · {rows.length}
                  <span className="text-sm leading-none">×</span>
                </button>
              )}
              {canManageShift && (
                <button onClick={() => setRedDateOpen(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15">
                  <CalendarX2 className="h-3.5 w-3.5" /> {t("Public holiday quota")}
                </button>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
              {users.isLoading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5">{t("User")}</th>
                    <th className="hidden px-4 py-2.5 md:table-cell">{t("Joined")}</th>
                    <th className="px-4 py-2.5">{t("Work hours")}</th>
                    <th className="px-4 py-2.5 text-right">{t("Role")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => {
                    const info = orgInfoByUser.get(u.id);
                    return <UserRow key={u.id} user={u} orgInfo={info} assignable={viewerAssignable} canEdit={!!info && canEditTier(viewerRole, info.role)} pending={updateOrg.isPending} onOrgRole={(role) => info && updateOrg.mutate({ memberId: info.memberId, role })} canManageShift={canManageShift} shiftPending={updateShift.isPending} onSaveShift={(start, end) => info && updateShift.mutate({ memberId: info.memberId, start, end })} shiftByDayPending={updateShiftByDay.isPending} onSaveShiftByDay={(byDay) => info && updateShiftByDay.mutate({ memberId: info.memberId, byDay })} flexiPending={updateFlexi.isPending} onToggleFlexi={() => info && updateFlexi.mutate({ memberId: info.memberId, flexi: !info.flexi })} geofencePending={updateGeofence.isPending} onToggleGeofence={() => info && updateGeofence.mutate({ memberId: info.memberId, on: !info.noGeofence })} onDayoff={() => setDayoffUser({ id: u.id, name: u.name || u.email || "User" })} canDelete={canDeleteUsers} isMember={!!info} onDelete={() => setDelUser({ id: u.id, name: u.name || t("Unnamed"), email: u.email ?? "", deactivated: !!u.deactivatedAt })} canOffboard={canOffboard && !!info && u.id !== me?.id && (isSystemAdmin || canEditTier(viewerRole, info.role))} onOffboard={() => setOffboardTarget(u)} canReinstate={canOffboard && u.id !== me?.id} onReinstate={() => setReinstateTarget(u)} gwConfigured={gwAccounts.data?.configured ?? false} gwAccounts={gwAccounts.data?.accounts ?? []} gwDomains={gwAccounts.data?.domains ?? []} canLinkGoogle={canDeleteUsers} memberships={memberships.data?.byUser[u.id]} membershipsLoading={memberships.isLoading} allTeams={teamsQ.data ?? []} canManageTeams={canManageTeamsOrg} teamPending={addToTeam.isPending || removeFromTeam.isPending} onTeamAdd={(teamId) => addToTeam.mutate({ teamId, userId: u.id })} onTeamOpen={(teamId) => setTeamSettingsId(teamId)} onTeamCreated={(teamId) => { refreshMemberships(); setTeamSettingsId(teamId); }} onTeamExit={(team, losing) => setTeamExit({ userId: u.id, userName: u.name || u.email || "User", teamId: team.id, teamName: team.name, losing })} allProjects={projectsQ.data ?? []} projectPending={addToProject.isPending || removeFromProject.isPending} onProjectAdd={(projectId) => addToProject.mutate({ projectId, userId: u.id })} onProjectRemove={(projectId) => removeFromProject.mutate({ projectId, userId: u.id })} canJoin={canDeleteUsers && !!u.email} joinPending={joinWorkspace.isPending && joinWorkspace.variables === u.email} onJoin={() => u.email && joinWorkspace.mutate(u.email)} workspaceName={workspaceName} onOpenApproval={() => setView("approval")} />;
                  })}
                </tbody>
              </table>
              {!users.isLoading && rows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">{t("No users found.")}</div>}
            </div>
          </>
        )}
      </div>
      {dayoffUser && <DayoffModal user={dayoffUser} canEdit={canManageShift} onClose={() => setDayoffUser(null)} />}
      {delUser && <DeleteUserModal user={delUser} onClose={() => setDelUser(null)} />}
      {offboardTarget && <OffboardUserModal user={offboardTarget} onClose={() => setOffboardTarget(null)} onOpenApproval={() => { setOffboardTarget(null); setView("approval"); }} />}
      {reinstateTarget && <ReinstateUserModal user={reinstateTarget} onClose={() => setReinstateTarget(null)} />}
      {redDateOpen && <RedDateQuotaModal onClose={() => setRedDateOpen(false)} />}
      {teamSettingsId && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 dark:bg-scrim p-4" onClick={() => { setTeamSettingsId(null); setDivisionsOpen(false); }}>
          <div className="mx-auto my-8 w-full max-w-lg space-y-3" onClick={(e) => e.stopPropagation()}>
            {openTeam ? (
              <>
                <div className="flex items-center gap-2">
                  <button onClick={() => setDivisionsOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-soft transition hover:bg-accent">
                    <FolderKanban className="h-3.5 w-3.5" /> {t("Manage divisions")}
                  </button>
                  <button onClick={() => { setTeamSettingsId(null); setDivisionsOpen(false); }} className="ml-auto rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-soft transition hover:bg-accent">{t("Close")}</button>
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
                {t("This team no longer exists.")}
                <button onClick={() => setTeamSettingsId(null)} className="ml-2 font-semibold text-primary hover:underline">{t("Close")}</button>
              </div>
            )}
          </div>
        </div>
      )}
      {teamExit && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 dark:bg-scrim p-4" onClick={() => setTeamExit(null)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-soft" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-bold">{t("Remove from {team}?", { team: teamExit.teamName })}</div>
            <p className="mt-2 text-sm text-muted-foreground"><b className="text-foreground">{teamExit.userName}</b> {t("leaves this team.")}</p>
            {teamExit.losing.length > 0 ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <div className="text-xs font-bold text-amber-800 dark:text-amber-300">{tn(teamExit.losing.length, "They also lose access to {n} project", "They also lose access to {n} projects")}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {teamExit.losing.map((n) => <span key={n} className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-background/40 dark:text-amber-200">{n}</span>)}
                </div>
                <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">{t("Access added directly to a project stays.")}</div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">{t("This team isn't linked to any project, so no access is lost.")}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setTeamExit(null)} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-accent">{t("Cancel")}</button>
              <button
                onClick={() => { removeFromTeam.mutate({ teamId: teamExit.teamId, userId: teamExit.userId }); setTeamExit(null); }}
                className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-rose-700">
                {t("Remove from team")}
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
  const { t, locale } = useLang();
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthLabel = new Date(`${monthKey}-01T00:00:00`).toLocaleDateString(locale, { month: "long", year: "numeric" });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-scrim p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-base font-bold tracking-tight">{t("Public holiday quota — {month}", { month: monthLabel })}</h2>
          <button onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">{t("Public holiday quota per staff member for this month, the same for everyone. Set it every month. Staff request their own through \"New request\" in Attendance.")}</p>

        {q.isLoading ? (
          <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input type="number" inputMode="numeric" min={0} max={31} value={val} onChange={(e) => setVal(e.target.value)} placeholder="0" className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
            <span className="text-xs text-muted-foreground">{t("days per staff member this month")}</span>
            <button type="button" disabled={!dirty || m.isPending} onClick={() => m.mutate(n)} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
              {m.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("Save")}
            </button>
          </div>
        )}
        {q.data && q.data.quota === 0 && <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">{t("The quota is still 0, so staff can't request public holidays this month until you set it.")}</p>}
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
  const { t } = useLang();
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
    onError: (e: unknown) => setProblem(e instanceof ApiError ? e.message : t("Couldn't create the account")),
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
    onError: (e: unknown) => setProblem(e instanceof ApiError ? e.message : t("Couldn't link the account")),
  });

  if (!configured) return null;

  // Sandi sementara: satu-satunya kesempatan melihatnya. Ditaruh di atas segalanya supaya
  // tidak tertutup interaksi berikutnya, dan hanya hilang saat ditutup dengan sengaja.
  if (madePassword) {
    return (
      <span className="inline-flex max-w-[280px] flex-col gap-1 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-[11px] text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
        <span className="font-semibold">{t("{email} created", { email: madePassword.email })}</span>
        <span>{t("Temporary password. Copy it now, it can't be shown again:")}</span>
        <code className="select-all rounded bg-white px-1.5 dark:bg-background py-1 font-mono text-[11px] tracking-tight">{madePassword.password}</code>
        <span className="text-emerald-700 dark:text-emerald-300">{t("They must change it the first time they sign in.")}</span>
        {madePassword.notified?.email ? (
          <span className="text-emerald-700 dark:text-emerald-300">
            {t("The password was sent to {email}. You don't need to pass it on.", { email: madePassword.notified.emailTo ?? "" })}
          </span>
        ) : (
          // Kegagalan email HARUS terlihat sekarang, selagi sandinya masih di layar. Ditemukan
          // nanti lewat orang yang bingung kenapa tidak dapat apa-apa berarti sandinya sudah hilang.
          <span className="font-semibold text-destructive">
            {t("The email was NOT sent. Give them this password yourself, and not in a group chat.")}
          </span>
        )}
        {problem && <span className="text-destructive">{problem}</span>}
        <button type="button" onClick={() => { setMadePassword(null); setOpen(false); }} className="self-start rounded border border-emerald-300 px-1.5 py-0.5 font-semibold hover:bg-emerald-100 dark:border-emerald-500/40 dark:hover:bg-emerald-500/15">
          {t("I've copied it")}
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
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"><AtSign className="h-3.5 w-3.5" /> {current}</span>
        ) : (
          <span className="text-sm text-muted-foreground">{t("Not linked.")}</span>
        )}
        {canEdit && (
          <>
            <button type="button" onClick={() => { setProblem(null); setQ(""); setOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold transition hover:border-primary hover:text-primary">
              <Link2 className="h-3.5 w-3.5" /> {current ? t("Change account") : t("Choose account")}
            </button>
            {!current && domains.length > 0 && (
              <button type="button" onClick={() => { setProblem(null); setMaking(true); }} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold transition hover:border-primary hover:text-primary">
                <Plus className="h-3.5 w-3.5" /> {t("Create work email")}
              </button>
            )}
            {current && (
              <button type="button" disabled={link.isPending} onClick={() => link.mutate(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-50 dark:hover:border-rose-500/40 dark:hover:text-rose-300">
                {link.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2Off className="h-3.5 w-3.5" />} {t("Unlink")}
              </button>
            )}
          </>
        )}
      </div>
      {problem && !open && !making && <div className="mt-2 text-xs text-destructive">{problem}</div>}

      {/* Pemilih: daftar yang bisa dicari, bukan <select> dengan 22 opsi sepanjang satu kalimat. Yang
          sudah dipakai orang lain tetap terlihat tapi tidak bisa dipilih, lengkap dengan nama pemakainya. */}
      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 dark:bg-scrim p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-soft" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-sm font-bold">{user.name ? t("Google Workspace account for {name}", { name: user.name }) : t("Google Workspace account for this person")}</div>
              <button onClick={() => setOpen(false)} aria-label={t("Close")} className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">{t("The server checks that the address really exists in Google before saving it.")}</p>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search address or name…")} className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:border-primary" />
            </div>
            <div className="max-h-80 space-y-0.5 overflow-y-auto">
              {current && !accounts.some((a) => a.email === current) && (
                // Akun yang baru dibuat BELUM tentu ada di daftar: Google menerbitkan user secara
                // asinkron dan pembacaan tepat setelah insert bisa menjawab 404 (terbukti saat uji).
                <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-2 py-1.5 text-sm font-semibold text-primary"><AtSign className="h-3.5 w-3.5" /> {current} <span className="text-[11px] font-normal">{t("(just created)")}</span></div>
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
                        {a.fullName || "—"}{a.suspended && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{t("suspended")}</span>}{taken && <span className="ml-1">{t("· used by {name}", { name: taken })}</span>}
                      </span>
                    </span>
                    {isCurrent && <span className="text-xs font-bold text-primary">✓</span>}
                  </button>
                );
              })}
              {rows.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">{t("Nothing matches.")}</div>}
            </div>
            {problem && <div className="mt-2 text-xs text-destructive">{problem}</div>}
            {link.isPending && <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("Linking…")}</div>}
          </div>
        </div>
      )}

      {/* Formulir buat mailbox baru. Modal sendiri: ini mengisi seat lisensi berbayar, dan formulir
          yang ditempel di dalam baris tabel terbaca seperti sesuatu yang boleh diisi asal-asalan. */}
      {making && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 dark:bg-scrim p-4" onClick={() => setMaking(false)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-soft" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-sm font-bold">{user.name ? t("Create a work email for {name}", { name: user.name }) : t("Create a work email for this person")}</div>
              <button onClick={() => setMaking(false)} aria-label={t("Close")} className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">{t("A new account takes one paid Workspace license seat. Its temporary password is shown only once, and is sent to their personal email.")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div><div className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("First name")}</div><input value={givenName} onChange={(e) => setGivenName(e.target.value)} className={inputCls} /></div>
              <div><div className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("Last name")}</div><input value={familyName} onChange={(e) => setFamilyName(e.target.value)} className={inputCls} /></div>
            </div>
            <div className="mt-2">
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("Address")}</div>
              <div className="flex items-center gap-1.5">
                <input value={localPart} onChange={(e) => setLocalPart(e.target.value.toLowerCase())} placeholder={t("first.last")} className={cn(inputCls, "font-mono")} />
                <span className="text-muted-foreground">@</span>
                <select value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-2 text-sm font-semibold outline-none focus:border-primary">
                  {domains.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              {localPart && domain && <div className="mt-1 text-[11px] text-muted-foreground">{t("Will be created:")} <b className="font-mono text-foreground">{localPart}@{domain}</b></div>}
            </div>
            {problem && <div className="mt-2 text-xs text-destructive">{problem}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => { setMaking(false); setProblem(null); }} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-accent">{t("Cancel")}</button>
              <button type="button" disabled={create.isPending || !localPart || !domain || !givenName || !familyName} onClick={() => { setProblem(null); create.mutate(); }} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
                {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {create.isPending ? t("Creating…") : t("Create and link")}
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
  /** Offboard (a member who left the company) and, on an offboarded account, Reinstate. */
  canOffboard: boolean; onOffboard: () => void; canReinstate: boolean; onReinstate: () => void;
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
  const { user, orgInfo, isMember, canDelete, canJoin, joinPending, onJoin, onDelete, workspaceName, memberships, membershipsLoading, gwConfigured, canReinstate, onReinstate } = props;
  const [open, setOpen] = useState(false);
  const { t, tn, locale } = useLang();
  // Offboarded: no membership left, so this row would otherwise read "not in a workspace yet" and offer
  // to add them back as Staff. It says when they left instead, and offers Reinstate.
  const deactivated = !!user.deactivatedAt;
  const leftAt = user.formerMemberships?.[0]?.leftAt ?? null;
  const projectCount = memberships?.projects.length ?? 0;
  const teamCount = memberships?.teams.length ?? 0;
  const overrideCount = Object.keys(orgInfo?.shiftByDay ?? {}).length;
  const shiftLabel = orgInfo?.shiftStart && orgInfo?.shiftEnd ? `${fmtClock(orgInfo.shiftStart, locale)}–${fmtClock(orgInfo.shiftEnd, locale)}` : null;

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
              <div className="truncate font-semibold">{user.name || t("Unnamed")}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
              {/* Approver absensi — hanya untuk STAFF. "Belum ditaruh" berwarna peringatan karena
                  request orang ini masih jatuh ke BoD; bukan galat, tapi pekerjaan yang belum selesai. */}
              {orgInfo && (
                orgInfo.approverName
                  ? <div className="truncate text-[11px] text-muted-foreground">{t("Approver:")} <b className="text-foreground">{orgInfo.approverName}</b></div>
                  : (orgInfo.role === "STAFF" || orgInfo.role === "MANAGER")
                    ? <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">{t("Not placed in the Approval chart yet")}</div>
                    : <div className="text-[11px] text-muted-foreground">{t("Approver: another BoD")}</div>
              )}
              {isMember && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {membershipsLoading ? "…" : tn(projectCount, "{n} project", "{n} projects") + (teamCount > 0 ? " · " + tn(teamCount, "{n} team", "{n} teams") : "")}
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
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"><Zap className="h-3 w-3 fill-amber-400" /> Flexi 12:00–15:00</span>
              ) : (
                <span className="font-semibold tabular-nums text-foreground">{shiftLabel ?? <span className="font-normal text-muted-foreground">{t("Office hours")}</span>}</span>
              )}
              {!orgInfo.flexi && overrideCount > 0 && <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{t("per day ×{n}", { n: overrideCount })}</span>}
              {orgInfo.noGeofence && <span className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300"><Smartphone className="h-3 w-3" /> Mobile</span>}
              {gwConfigured && user.googleWorkspaceEmail && <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground" title={user.googleWorkspaceEmail}><AtSign className="h-3 w-3" /> Google</span>}
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            {orgInfo ? (
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", ORG_ROLE_TONE[orgInfo.role] ?? "bg-muted text-muted-foreground")}>{ORG_ROLE_LABEL[orgInfo.role] ?? orgInfo.role}</span>
            ) : deactivated ? (
              leftAt
                ? <LeftTag leftAt={leftAt} className="px-2 text-[11px] font-bold" />
                : <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{t("Left")}</span>
            ) : (
              <span className="text-xs text-muted-foreground/60">{t("not in the workspace yet")}</span>
            )}
            {/* Akun yang mendaftar sendiri tanpa kode workspace berhenti di sini — terdaftar,
                tapi tidak di mana pun. Satu tombol, langsung jadi Staff; perannya bisa diubah
                sesudahnya di panel yang sama. */}
            {deactivated && canReinstate && (
              <button type="button" onClick={onReinstate} title={t("Reinstate")} aria-label={t("Reinstate")} className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-bold text-foreground transition hover:border-primary hover:text-primary">
                <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t("Reinstate")}</span>
              </button>
            )}
            {!isMember && !deactivated && canJoin && (
              <button type="button" onClick={onJoin} disabled={joinPending} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15">
                {joinPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {t("Add to {workspace}", { workspace: workspaceName })}
              </button>
            )}
            {canDelete && !isMember && (
              <button type="button" onClick={onDelete} title={t("Delete account permanently")} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            {isMember && (
              <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground transition hover:border-primary hover:text-primary">
                <Settings2 className="h-3.5 w-3.5" /> {t("Details")}
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
  const { t, tn } = useLang();

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
    <button type="button" disabled={!canManageShift || p} onClick={onToggle} className={cn("flex w-full items-start gap-3 rounded-lg border p-3 text-left transition disabled:cursor-default", on ? (tone === "amber" ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10" : "border-sky-300 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-500/10") : "border-border bg-card hover:bg-accent/40")}>
      <span className={cn("mt-0.5 shrink-0", on ? (tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-sky-600 dark:text-sky-400") : "text-muted-foreground")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{desc}</span>
      </span>
      <span className={cn("mt-1 h-5 w-9 shrink-0 rounded-full p-0.5 transition", on ? (tone === "amber" ? "bg-amber-500" : "bg-sky-500") : "bg-muted dark:bg-control-border")}>
        <span className={cn("block h-4 w-4 rounded-full bg-white shadow transition", on && "translate-x-4")} />
      </span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-scrim p-4 md:p-8" onClick={onClose}>
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
              <h2 className="truncate text-lg font-bold tracking-tight">{user.name || t("Unnamed")}</h2>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", ORG_ROLE_TONE[orgInfo.role] ?? "bg-muted text-muted-foreground")}>{ORG_ROLE_LABEL[orgInfo.role] ?? orgInfo.role}</span>
            </div>
            <div className="truncate text-sm text-muted-foreground">{user.email}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
              {user.joinedAt && <span>{t("Joined {date}", { date: fmtDate(user.joinedAt) })}</span>}
              {user.googleWorkspaceEmail && <span className="inline-flex items-center gap-1"><AtSign className="h-3 w-3" /> {user.googleWorkspaceEmail}</span>}
              <span>{tn(teamCount, "{n} team", "{n} teams")} · {tn(projectCount, "{n} project", "{n} projects")}</span>
            </div>
          </div>
          <Link to="/people/$userId" params={{ userId: user.id }} title={t("This person's attendance, XP log and requests per period")} className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-accent">{t("Recap →")}</Link>
          <button onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-4 md:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            {/* ── kiri ── */}
            <div className="space-y-4">
              {canDelete && <AccountCard user={user} memberId={orgInfo.memberId} Card={Card} />}
              <Card title={t("Role")}>
                {canEdit ? (
                  <select value={orgInfo.role} disabled={pending} onChange={(e) => onOrgRole(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold outline-none focus:border-primary disabled:opacity-50">
                    {[...assignable].reverse().map((r) => <option key={r} value={r}>{ORG_ROLE_LABEL[r]}</option>)}
                  </select>
                ) : (
                  <span className="text-sm text-muted-foreground">{t("This person's role is at or above yours, so you can't change it here.")}</span>
                )}
              </Card>

              <Card title={t("Attendance approver")} hint={t("This person's leave, permit and sick requests go to the person above them in the Approval chart, whatever their role.")}>
                  <div className="flex items-center justify-between gap-3">
                    {orgInfo.approverName
                      ? <span className="text-sm font-semibold">{orgInfo.approverName}</span>
                      : (orgInfo.role === "STAFF" || orgInfo.role === "MANAGER")
                        ? <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">{t("Not placed yet, so requests still go to every BoD")}</span>
                        : <span className="text-sm text-muted-foreground">{t("Not placed, so requests go to the other BoD")}</span>}
                    <button type="button" onClick={() => { onClose(); onOpenApproval(); }} className="shrink-0 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-accent">{t("Open Approval chart →")}</button>
                  </div>
                </Card>

              <Card title={t("Attendance mode")}>
                <div className="space-y-2">
                  <ToggleRow on={orgInfo.flexi} pending={flexiPending} onToggle={onToggleFlexi} icon={<Zap className={cn("h-4 w-4", orgInfo.flexi && "fill-amber-400")} />} title="Flexi Time" desc={t("Check in any time 12:00–15:00 with no late penalty; check-out = check-in + 9 hours.")} tone="amber" />
                  <ToggleRow on={orgInfo.noGeofence} pending={geofencePending} onToggle={onToggleGeofence} icon={<Smartphone className="h-4 w-4" />} title={t("Mobile mode")} desc={t("Check in from anywhere: no geofence, and check-out outside the office needs no approval.")} tone="sky" />
                </div>
              </Card>

              {canManageShift && (
                <Card title={t("Day-off quota")}>
                  <button type="button" onClick={onDayoff} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition hover:border-primary hover:text-primary">
                    <CalendarDays className="h-4 w-4" /> {t("Manage day-off quota and history")}
                  </button>
                </Card>
              )}

              {gwConfigured && (
                <Card title="Google Workspace" hint={t("The work email linked to this profile.")}>
                  <GoogleLinkCell user={user} accounts={gwAccounts} domains={gwDomains} configured={gwConfigured} canEdit={canLinkGoogle} />
                </Card>
              )}
            </div>

            {/* ── kanan ── */}
            <Card title={t("Work hours")} hint={orgInfo.flexi ? t("Flexi Time is on, so the fixed hours below are ignored.") : t("Leave empty to follow office or team hours. Per-day hours apply only to the days filled in.")} className="self-start">
              <div className={cn("space-y-4", orgInfo.flexi && "pointer-events-none opacity-40")}>
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{t("Default")}</div>
                  <ShiftCell start={orgInfo.shiftStart} end={orgInfo.shiftEnd} canEdit={canManageShift && !orgInfo.flexi} pending={shiftPending} onSave={onSaveShift} />
                </div>
                {canManageShift && (
                  <div>
                    <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{t("Per day")} <span className="font-normal text-muted-foreground/70">{t("— only the days that differ from the default")}</span></div>
                    <div className="space-y-1.5">
                      {WEEKDAYS.map(([wd, label]) => (
                        <div key={wd} className={cn("flex items-center gap-3 rounded-lg px-2 py-1", byDay[wd] && "bg-primary/5")}>
                          <span className={cn("w-9 shrink-0 text-xs font-bold", byDay[wd] ? "text-primary" : "text-muted-foreground")}>{t(label)}</span>
                          <ShiftCell start={byDay[wd]?.start ?? null} end={byDay[wd]?.end ?? null} canEdit={canManageShift} pending={shiftByDayPending} onSave={(s, e) => saveDay(wd, s, e)} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* ── bawah, melebar ── */}
            <Card title={t("Teams and projects")} hint={canManageTeams ? t("Teams were replaced by the IP & Division Chart. Project access is set per person here.") : undefined} className="md:col-span-2">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"><UsersIcon className="h-3.5 w-3.5" /> {t("Teams · {n}", { n: teamCount })}</div>
                  {!membershipsLoading && teamCount === 0 && <div className="mb-1.5 text-xs text-muted-foreground/70">{t("Teams were replaced by the IP & Division Chart.")}</div>}
                  <div className="flex flex-wrap gap-1.5">
                    {(memberships?.teams ?? []).map((tm) => {
                      // Project yang orang ini dapat GARA-GARA tim ini — dipakai untuk memberi tahu
                      // apa yang hilang sebelum dia dikeluarkan, bukan sesudahnya.
                      const losing = (memberships?.projects ?? []).filter((pr) => pr.viaTeam === tm.name).map((pr) => pr.name);
                      return (
                        <span key={tm.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card py-1 pl-2 pr-1 text-[11px] font-semibold text-foreground">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tm.color ?? "#7B2FBE" }} />
                          {canManageTeams ? (
                            <button type="button" onClick={() => onTeamOpen(tm.id)} title={t("Set up this team (name, division, shift hours, projects)")} className="font-semibold underline-offset-2 transition hover:text-primary hover:underline">{tm.name}</button>
                          ) : tm.name}
                          {tm.division && <span className="font-normal text-muted-foreground">· {tm.division}</span>}
                          {canManageTeams && (
                            <button type="button" disabled={teamPending} onClick={() => onTeamExit({ id: tm.id, name: tm.name }, losing)} title={t("Remove from this team")} className="rounded p-0.5 text-muted-foreground/50 transition hover:bg-rose-100 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-500/15 dark:hover:text-rose-400">
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
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"><FolderKanban className="h-3.5 w-3.5" /> {t("Projects · {n}", { n: projectCount })}</div>
                  {membershipsLoading && <div className="text-xs text-muted-foreground/70">{t("Loading…")}</div>}
                  {!membershipsLoading && projectCount === 0 && <div className="mb-1.5 text-xs text-muted-foreground/70">{t("Not in any project yet.")}</div>}
                  <div className="flex flex-wrap gap-1.5">
                    {(memberships?.projects ?? []).map((pr) => (
                      <span key={pr.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card py-1 pl-2 pr-1 text-[11px] font-semibold text-foreground">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: pr.color ?? "#94A3B8" }} />
                        <Link to="/projects/$projectId" params={{ projectId: pr.id }} className="underline-offset-2 hover:text-primary hover:underline">{pr.name}</Link>
                        {/* Lewat tim, bukan langsung: mencabutnya dari halaman project TIDAK bertahan —
                            sinkronisasi tim menuliskannya lagi. Sebut timnya, dan jangan beri tombol lepas. */}
                        {pr.viaTeam && <span className="font-normal text-muted-foreground">{t("· via {team}", { team: pr.viaTeam })}</span>}
                        {pr.role !== "MEMBER" && <span className="rounded bg-primary/10 px-1 text-[10px] font-bold text-primary">{pr.role}</span>}
                        {canManageTeams && !pr.viaTeam ? (
                          <button type="button" disabled={projectPending} onClick={() => onProjectRemove(pr.id)} title={t("Remove from this project")} className="rounded p-0.5 text-muted-foreground/50 transition hover:bg-rose-100 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-500/15 dark:hover:text-rose-400"><X className="h-3 w-3" /></button>
                        ) : <span className="w-1" />}
                      </span>
                    ))}
                    {canManageTeams && <ProjectAddPicker projects={allProjects} already={new Set((memberships?.projects ?? []).map((p) => p.id))} pending={projectPending} onPick={onProjectAdd} />}
                  </div>
                </div>
              </div>
            </Card>

            {/* Offboard: rare and heavy, so last, and only for those who may (BoD+, system admin, rank). */}
            {props.canOffboard && (
              <section className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 md:col-span-2 dark:border-rose-900/50 dark:bg-rose-950/20">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">{t("Offboard")}</div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{t("For someone who resigned, whose contract ended, or who was let go. Their history stays.")}</p>
                  </div>
                  <button type="button" onClick={() => { onClose(); props.onOffboard(); }} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-rose-300 bg-card px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
                    <UserMinus className="h-3.5 w-3.5" /> {t("Offboard {name}…", { name: user.name || user.email || "" })}
                  </button>
                </div>
              </section>
            )}
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
  const { t } = useLang();
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [password, setPassword] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["nexus", "admin-users"] }); qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }); qc.invalidateQueries({ queryKey: ["nexus", "approval-chart"] }); };
  const save = useMutation({
    mutationFn: (body: { name?: string; email?: string; password?: string }) => nexusApi.updateAdminAccount(user.id, body),
    onSuccess: (_r, body) => {
      refresh();
      setPassword("");
      toast.success(body.password ? t("Password changed") : t("Account saved"), { description: body.password ? t("Give the new password to them directly, not in a group chat.") : undefined });
    },
    onError: (e: unknown) => toast.error(t("Couldn't save."), { description: e instanceof ApiError ? e.message : t("Try again.") }),
  });
  const photo = useMutation({
    mutationFn: (file: File) => nexusApi.uploadMemberAvatar(memberId, file),
    onSuccess: () => { refresh(); toast.success(t("Profile photo changed")); },
    onError: (e: unknown) => toast.error(t("Couldn't upload the photo"), { description: e instanceof ApiError ? e.message : t("PNG/JPG/WEBP, up to 5 MB.") }),
  });
  const dirtyIdentity = name.trim() !== (user.name ?? "") || email.trim().toLowerCase() !== (user.email ?? "");
  const inputCls = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary";
  return (
    <Card title={t("Account")} hint={t("Photo, name, sign-in email and password. Only BoD see this card.")}>
      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-3">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary ring-1 ring-border">{initialsOf(user.name)}</span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold transition hover:border-primary hover:text-primary">
            {photo.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t("Change photo")}
          </span>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={photo.isPending} onChange={(e) => { const f = e.target.files?.[0]; if (f) photo.mutate(f); e.target.value = ""; }} />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("Name")}</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("Sign-in email")}</div>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </div>
        </div>
        <button type="button" disabled={!dirtyIdentity || save.isPending} onClick={() => save.mutate({ ...(name.trim() !== (user.name ?? "") ? { name: name.trim() } : {}), ...(email.trim().toLowerCase() !== (user.email ?? "") ? { email: email.trim() } : {}) })} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
          {save.isPending && !password ? t("Saving…") : t("Save name and email")}
        </button>
        <div className="border-t border-border pt-3">
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("New password")} <span className="font-normal text-muted-foreground/70">{t("— at least 8 characters, visible as you type")}</span></div>
          <div className="flex gap-2">
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("Type a new password…")} autoComplete="off" spellCheck={false} className={cn(inputCls, "font-mono")} />
            <button type="button" disabled={password.length < 8 || save.isPending} onClick={() => save.mutate({ password })} className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-40 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15">
              {t("Change password")}
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
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const options = projects.filter((p) => !already.has(p.id)).filter((p) => !q.trim() || p.name.toLowerCase().includes(q.toLowerCase()));
  if (!open) {
    return (
      <button type="button" disabled={pending} onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-40">
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} {t("project")}
      </button>
    );
  }
  return (
    <div className="w-full rounded-lg border border-primary/40 bg-background p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search projects…")} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary" />
        <button type="button" onClick={() => { setOpen(false); setQ(""); }} className="text-xs font-semibold text-muted-foreground hover:text-foreground">{t("Close")}</button>
      </div>
      <div className="max-h-44 space-y-0.5 overflow-y-auto">
        {options.length === 0 && <div className="px-1 py-2 text-[11px] text-muted-foreground/70">{t("Nothing matches.")}</div>}
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
  // `t` is the team in the callbacks below, so the translator goes by another name here.
  const { t: tl } = useLang();
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
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} {tl("team")}
      </button>
    );
  }
  return (
    <div className="w-full rounded-lg border border-primary/40 bg-background p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tl("Search teams…")} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary" />
        <button type="button" onClick={() => { setOpen(false); setQ(""); }} className="text-xs font-semibold text-muted-foreground hover:text-foreground">{tl("Close")}</button>
      </div>
      <div className="max-h-44 space-y-0.5 overflow-y-auto">
        {options.length === 0 && <div className="px-1 py-2 text-[11px] text-muted-foreground/70">{teams.length === 0 ? tl("No teams yet.") : tl("Nothing matches.")}</div>}
        {q.trim().length > 1 && !teams.some((t) => t.name.toLowerCase() === q.trim().toLowerCase()) && (
          <button type="button" disabled={create.isPending} onClick={() => create.mutate(q.trim())} className="mt-0.5 flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-1.5 py-1.5 text-left text-[11px] font-semibold text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-50">
            {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} {tl("Create team “{name}”", { name: q.trim() })}
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
// Display only (not the typed inputs): "h:mm AM/PM" in English, "19.00" in Indonesian.
function fmtClock(hhmm: string | null | undefined, locale: string): string {
  if (!hhmm) return "";
  if (!locale.startsWith("id")) return to12h(hhmm);
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h)) return "";
  return new Date(2000, 0, 1, h, m || 0).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
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
  const { t, locale } = useLang();
  const [s, setS] = useState(() => to12h(start));
  const [e, setE] = useState(() => to12h(end));
  useEffect(() => { setS(to12h(start)); setE(to12h(end)); }, [start, end]);

  if (!canEdit) {
    return start && end
      ? <span className="text-xs font-semibold tabular-nums">{fmtClock(start, locale)} – {fmtClock(end, locale)}</span>
      : <span className="text-xs text-muted-foreground/50">{t("default")}</span>;
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
  const inputCls = (bad: boolean) => cn("w-[6.75rem] rounded-md border bg-background px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-50", bad ? "border-rose-400 text-rose-600 dark:text-rose-400" : "border-border");

  return (
    <div className="flex items-center gap-1">
      <input type="text" inputMode="text" placeholder="09:00 AM" value={s} disabled={pending} onChange={(evt) => setS(evt.target.value)} onBlur={() => snap(s, setS)} className={inputCls(ps === "invalid")} />
      <span className="text-muted-foreground">–</span>
      <input type="text" inputMode="text" placeholder="06:00 PM" value={e} disabled={pending} onChange={(evt) => setE(evt.target.value)} onBlur={() => snap(e, setE)} className={inputCls(pe === "invalid")} />
      {overnight && <span title={t("Overnight: check-out is the next day")} role="img" aria-label={t("overnight shift")} className="ml-0.5 text-sm">🌙</span>}
      {dirty ? (
        <button
          type="button"
          disabled={pending || invalid}
          onClick={() => onSave(startVal, endVal)}
          title={badFmt ? t("The time format isn't right (e.g. 09:00 AM)") : partial ? t("Fill in both check-in and check-out") : sameTime ? t("Check-in and check-out can't be the same") : overnight ? t("Save shift (overnight)") : t("Save shift")}
          className="ml-0.5 rounded-md bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : t("Save")}
        </button>
      ) : hasShift ? (
        <button type="button" disabled={pending} onClick={() => onSave(null, null)} title={t("Clear shift (back to default)")} className="ml-0.5 rounded-md border border-border px-1.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-accent hover:text-rose-600 dark:hover:text-rose-400">×</button>
      ) : null}
    </div>
  );
}

// Editable monthly day-off quota per person (override the workspace default of 4).
function QuotaEditor({ userId, quota, override, defaultQuota }: { userId: string; quota: number; override: number | null; defaultQuota: number }) {
  const qc = useQueryClient();
  const { t } = useLang();
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
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Day-off quota per month")}</div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="number" min={0} max={366} value={val} onChange={(e) => setVal(e.target.value)} className="w-20 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-primary" />
        <span className="text-xs text-muted-foreground">{t("days per month")}</span>
        <button type="button" disabled={!dirty || m.isPending} onClick={() => m.mutate(n)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
          {m.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("Save")}
        </button>
        {override !== null && <button type="button" disabled={m.isPending} onClick={() => m.mutate(null)} className="text-xs font-semibold text-muted-foreground transition hover:text-foreground hover:underline">{t("Reset to default ({n})", { n: defaultQuota })}</button>}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{override === null ? t("Using the workspace default ({n} days).", { n: defaultQuota }) : t("Custom: {n} days (default {d}).", { n: override, d: defaultQuota })}</p>
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
  const { t } = useLang();
  const membersQ = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const me = membersQ.data?.members?.find((m) => m.userId === userId);
  const current = me?.restDays ?? [];
  const m = useMutation({
    mutationFn: (days: number[]) => nexusApi.updateWorkspaceMember({ memberId: me!.id, restDays: days }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }),
    onError: (e: unknown) => alert(e instanceof Error ? e.message : t("Couldn't save the rest days.")),
  });
  if (!me) return null;
  const toggle = (d: number) => m.mutate(current.includes(d) ? current.filter((x) => x !== d) : [...current, d].sort((a, b) => a - b));
  const preset = (days: number[]) => m.mutate(days);
  return (
    <div className="mb-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Rest days")}</span>
        {m.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {REST_WEEKDAYS.map((w) => {
          const on = current.includes(w.d);
          return (
            <button key={w.d} type="button" disabled={!canEdit || m.isPending} onClick={() => toggle(w.d)}
              className={cn("rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition", on ? "bg-violet-600 text-white ring-violet-600" : "bg-background text-muted-foreground ring-border hover:text-foreground", !canEdit && "opacity-70")}>
              {t(w.label)}
            </button>
          );
        })}
      </div>
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <button type="button" onClick={() => preset([7])} className="text-primary hover:underline">{t("Sunday off")}</button>
          <button type="button" onClick={() => preset([6, 7])} className="text-primary hover:underline">{t("Sat + Sun off")}</button>
          <button type="button" onClick={() => preset([])} className="text-muted-foreground hover:underline">{t("Works every day")}</button>
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {current.length ? t("No reminders, lateness or absence on these days. No day-off request needed.") : t("Works every office day; a day off must be requested.")}
      </p>
    </div>
  );
}

function DayoffModal({ user, canEdit, onClose }: { user: { id: string; name: string }; canEdit: boolean; onClose: () => void }) {
  const { t } = useLang();
  const q = useQuery({ queryKey: ["nexus", "dayoffs", user.id], queryFn: () => nexusApi.userDayoffs(user.id), retry: false });
  const data = q.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-scrim p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-bold tracking-tight">{t("Day off — {name}", { name: user.name })}</h2>
          <button onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        {q.isLoading && <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}

        {/* Jatah day-off per bulan — bisa diubah dari default (4). */}
        {canEdit && data && <QuotaEditor userId={user.id} quota={data.baseQuota ?? data.quotaOverride ?? data.defaultQuota} override={data.quotaOverride} defaultQuota={data.defaultQuota} />}
        <RestDaysEditor userId={user.id} canEdit={canEdit} />

        {data && (
          <p className="text-xs text-muted-foreground">
            {t("Used this period:")} <b className="text-foreground">{data.used} / {data.quota}</b>
            {(data.bonusDays ?? 0) > 0 && <span className="ml-1">({t("{base} + {n} extra", { base: data.baseQuota ?? "", n: data.bonusDays ?? 0 })}{data.bonusGrants?.length ? `: ${data.bonusGrants.map((g) => g.reason).join(", ")}` : ""})</span>}
            {data.used > data.quota && <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">{t("(over quota)")}</span>}
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
  const { t, tn } = useLang();
  const extraDays = (d: number) => tn(d, "{n} extra day off", "{n} extra days off");
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
      toast.success(t("{people} got {days}", { people: tn(r.grants.length, "{n} person", "{n} people"), days: extraDays(r.days) }), {
        description: t("Period {period}.", { period: r.periodLabel }) + " " + (r.notified < r.grants.length ? t("{a} of {b} notified.", { a: r.notified, b: r.grants.length }) : r.grants.length === 1 ? t("They were notified.") : t("All {n} were notified.", { n: r.grants.length })),
      });
      setSelected(new Set()); setReason(""); setDays("1");
    },
    onError: (e: unknown) => toast.error(t("Couldn't give extra day off"), { description: e instanceof ApiError ? e.message : t("Try again.") }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => nexusApi.revokeDayOffBonus(id),
    onSuccess: (r) => { refreshAll(); toast.success(r.alreadyRevoked ? t("Already revoked") : r.grant.user?.name ? t("Revoked {name}’s extra day off", { name: r.grant.user.name }) : t("Extra day off revoked")); },
    onError: (e: unknown) => toast.error(t("Couldn't revoke"), { description: e instanceof ApiError ? e.message : t("Try again.") }),
  });
  const submit = () => {
    if (!canSubmit) return;
    const who = selected.size === 1 ? (members.find((m) => selected.has(m.userId))?.name ?? tn(1, "{n} person", "{n} people")) : tn(selected.size, "{n} person", "{n} people");
    if (!window.confirm(t("Give {who} {days} for the period {period}?\n\nReason: {reason}\n\nEach person gets a notification. Unused days expire when the period ends.", { who, days: extraDays(n), period: periodLabelOf(periodKey), reason: reason.trim() }))) return;
    grant.mutate();
  };
  const grants = list.data?.grants ?? [];
  const active = grants.filter((g) => g.active);
  const revoked = grants.filter((g) => !g.active);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-soft md:p-5">
        <div>
          <h2 className="font-display text-base font-bold tracking-tight">{t("Give extra day off")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("Adds day-off days for one attendance period (28th → 27th) on top of each person’s quota, for example after working an event. Unused days expire when the period ends. Missed check-ins are still deducted as usual.")}</p>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Attendance period")}</div>
          {list.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
            <div className="flex flex-wrap gap-1.5">
              {periods.map((p) => (
                <button key={p.periodKey} type="button" onClick={() => setPeriodKey(p.periodKey)}
                  className={cn("rounded-full px-3 py-1 text-xs font-semibold ring-1 transition", periodKey === p.periodKey ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border hover:text-foreground")}>
                  {p.periodLabel} · {p.periodKey === current ? t("current") : p.periodKey < (current ?? "") ? t("previous") : t("next")}
                </button>
              ))}
            </div>
          )}
          {list.isError && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{list.error instanceof ApiError ? list.error.message : t("Couldn't load the extra day off list.")}</p>}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("People · {n} selected", { n: selected.size })}</span>
            <span className="flex gap-2 text-[11px]">
              <button type="button" onClick={() => setSelected((cur) => new Set([...cur, ...shown.map((m) => m.userId)]))} className="font-semibold text-primary hover:underline">{t("Select shown")}</button>
              <button type="button" onClick={() => setSelected(new Set())} className="text-muted-foreground hover:underline">{t("Clear")}</button>
            </span>
          </div>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search name or email…")} className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" />
          </div>
          {selected.size > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {sorted.filter((m) => selected.has(m.userId)).map((m) => (
                <span key={m.userId} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {m.name || m.email}
                  <button type="button" aria-label={t("Remove {name}", { name: m.name })} onClick={() => toggle(m.userId)}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
            {shown.length === 0 && <div className="py-6 text-center text-xs text-muted-foreground">{t("No one matches “{q}”.", { q: search })}</div>}
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
            <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Days")}</span>
            <input type="number" inputMode="numeric" min={1} max={31} value={days} onChange={(e) => setDays(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Reason (required)")}</span>
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. Worked the 3-day Jakarta event")} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </label>
        </div>
        {!daysValid && days !== "" && <p className="text-[11px] text-rose-600 dark:text-rose-400">{t("Days must be a whole number from 1 to 31.")}</p>}

        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/40 px-3 py-2">
          <span className="text-sm">
            <b>{selected.size}</b> {selected.size === 1 ? t("person") : t("people")} × <b>{daysValid ? n : "?"}</b> {n === 1 ? t("day") : t("days")}
            {periodKey && <span className="text-muted-foreground"> · {periodLabelOf(periodKey)}</span>}
          </span>
          <button type="button" disabled={!canSubmit || grant.isPending} onClick={submit} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
            {grant.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />} {t("Give extra day off")}
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft md:p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-bold tracking-tight">{t("Given · {period}", { period: periodLabelOf(periodKey) })}</h2>
          <span className="text-xs text-muted-foreground">{t("{n} active", { n: active.length })}{revoked.length ? " · " + t("{n} revoked", { n: revoked.length }) : ""}</span>
        </div>
        {list.isLoading && <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {!list.isLoading && grants.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <CalendarPlus className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60" />
            <div className="text-sm font-semibold">{t("No extra day off in this period yet")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("Pick people on the left, set the days and a reason, and they’ll see it in their day-off quota right away.")}</p>
          </div>
        )}
        <ul className="divide-y divide-border">
          {[...active, ...revoked].map((g: NexusDayOffBonus) => (
            <li key={g.id} className={cn("flex items-start gap-2 py-2", !g.active && "opacity-50")}>
              <Avatar userId={g.userId} name={g.user?.name ?? null} avatar={g.user?.avatar ?? null} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="truncate text-sm font-semibold">{g.user?.name ?? g.user?.email ?? t("Unknown")}</span>
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">+{g.days} DO</span>
                </div>
                <div className="truncate text-xs text-muted-foreground" title={g.reason}>{g.reason}</div>
                <div className="text-[10px] text-muted-foreground">
                  {g.active
                    ? t("by {name} · {date}", { name: g.grantedBy?.name ?? "—", date: fmtDate(g.createdAt) })
                    : t("revoked by {name} · {date}", { name: g.revokedBy?.name ?? "—", date: g.revokedAt ? fmtDate(g.revokedAt) : "" })}
                </div>
              </div>
              {g.active && (
                <button type="button" disabled={revoke.isPending}
                  onClick={() => { if (window.confirm(t("Revoke {name}’s {days} ({reason})?\n\nDays already taken are not undone.", { name: g.user?.name ?? t("this person"), days: extraDays(g.days), reason: g.reason }))) revoke.mutate(g.id); }}
                  className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-500/10">
                  {t("Revoke")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Today in Jakarta as "YYYY-MM-DD" (the attendance calendar), whatever the browser's time zone. */
function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const OFFBOARD_REASON_LABEL: Record<OffboardReason, string> = {
  RESIGNED: "Resigned",
  CONTRACT_ENDED: "Contract ended",
  DISMISSED: "Dismissed",
  OTHER: "Other",
};

/** The server's refusal `code` → a sentence in the interface language. Unknown codes show the server's text. */
function offboardErrorText(e: unknown, t: (en: string, vars?: Record<string, string | number>) => string): string {
  const code = e instanceof ApiError ? (e.payload as { code?: string } | null)?.code : undefined;
  switch (code) {
    case "SELF": return t("You can't do this to your own account.");
    case "RANK": return t("You can't do this to someone at or above your level.");
    case "FORBIDDEN": return t("Only BoD and above can do this.");
    case "BAD_DATE": return t("Check the last working day: not after today, and not before they joined.");
    case "NOT_MEMBER": return t("They aren't a member of the company workspace.");
    case "ALREADY_OFFBOARDED": return t("This account is offboarded already.");
    case "NOT_OFFBOARDED": return t("This account isn't offboarded.");
    default: return e instanceof ApiError ? e.message : t("Something went wrong. Nothing was changed.");
  }
}

/**
 * Offboard: someone resigned, their contract ended, or they were let go (POST /api/admin/users/:id/offboard).
 * Says plainly what happens and what stays before, and what is left for someone to do after: their pending
 * requests, their open tasks, and the people who lost them as approver.
 */
function OffboardUserModal({ user, onClose, onOpenApproval }: { user: NexusAdminUser; onClose: () => void; onOpenApproval: () => void }) {
  const qc = useQueryClient();
  const { t, tn, locale } = useLang();
  const today = jakartaToday();
  const [day, setDay] = useState(today);
  const [reason, setReason] = useState<OffboardReason>("RESIGNED");
  const [note, setNote] = useState("");
  const name = user.name || user.email || "";
  const m = useMutation({
    mutationFn: () => nexusApi.offboardUser(user.id, { lastWorkingDay: day, reason, note: note.trim() || null }),
    onSuccess: () => {
      for (const key of ["admin-users", "workspace-members", "approval-chart", "admin-user-memberships", "teams"]) qc.invalidateQueries({ queryKey: ["nexus", key] });
    },
  });
  const result: NexusOffboardResult | undefined = m.data;
  const minDay = user.firstJoinedAt
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(user.firstJoinedAt))
    : undefined;
  const dayValid = /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today && (!minDay || day >= minDay);
  const fmtDay = (key: string) => new Date(`${key}T00:00:00.000Z`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !m.isPending) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, m.isPending]);

  const happens = [
    t("Can't sign in anymore, on any device."),
    t("Removed from projects, teams and chats."),
    t("Their attendance, requests, projects, tasks and messages stay."),
    t("Their open tasks stay assigned to them."),
    t("Anyone who had them as approver goes back to the BoD safety net."),
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/40 dark:bg-scrim p-4" onClick={() => { if (!m.isPending) onClose(); }}>
      <div className="my-auto w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="min-w-0 font-display text-base font-bold tracking-tight">{result ? t("{name} is offboarded.", { name: result.user.name }) : t("Offboard {name}", { name })}</h2>
          <button onClick={onClose} disabled={m.isPending} aria-label={t("Close")} className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>

        {result ? (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">{t("Last working day: {date}", { date: fmtDay(result.lastWorkingDay) })}{result.workspaces.length > 0 ? ` · ${result.workspaces.join(", ")}` : ""}</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border bg-background p-3">
                <div className="text-2xl font-bold tabular-nums">{result.pendingRequests}</div>
                <div className="text-xs font-semibold">{t("Pending requests")}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{result.pendingRequests > 0 ? t("Still waiting for a decision in Attendance.") : t("Nothing waiting.")}</div>
              </div>
              <div className="rounded-xl border border-border bg-background p-3">
                <div className="text-2xl font-bold tabular-nums">{result.openTasks}</div>
                <div className="text-xs font-semibold">{t("Open tasks")}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{result.openTasks > 0 ? t("Still assigned to them. Reassign them if someone should take over.") : t("Nothing open.")}</div>
              </div>
            </div>
            {result.approverEdgesCleared.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                <div className="text-xs font-bold text-amber-800 dark:text-amber-300">{tn(result.approverEdgesCleared.length, "{n} person lost their approver", "{n} people lost their approver")}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {result.approverEdgesCleared.map((p) => <span key={p.id} className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">{p.name}</span>)}
                </div>
                <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-300">{t("Their requests go to the BoD until you set a new approver in the Approval chart.")}</p>
                <button type="button" onClick={onOpenApproval} className="mt-2 rounded-lg border border-amber-300 bg-card px-2.5 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40">{t("Open Approval chart")}</button>
              </div>
            )}
            {result.autoDeductionsCanceled > 0 && (
              <p className="text-[11px] text-muted-foreground">{tn(result.autoDeductionsCanceled, "{n} automatic deduction dated after their last day was canceled.", "{n} automatic deductions dated after their last day were canceled.")}</p>
            )}
            <button onClick={onClose} className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90">{t("Done")}</button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (dayValid && !m.isPending) m.mutate(); }}>
            <p className="text-xs text-muted-foreground">{t("For someone who resigned, whose contract ended, or who was let go. Their history stays.")}</p>
            <label className="block text-xs font-semibold text-muted-foreground">{t("Last working day")}
              <input type="date" required value={day} max={today} min={minDay} onChange={(e) => setDay(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-primary" />
            </label>
            <fieldset>
              <legend className="mb-1 text-xs font-semibold text-muted-foreground">{t("Reason")}</legend>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(OFFBOARD_REASON_LABEL) as OffboardReason[]).map((r) => (
                  <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r} className={cn("rounded-lg border px-3 py-2 text-left text-sm font-semibold transition", reason === r ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:bg-accent")}>
                    {t(OFFBOARD_REASON_LABEL[r])}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block text-xs font-semibold text-muted-foreground">{t("Note (optional)")}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </label>
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("What happens")}</div>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-foreground">
                {happens.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
            {m.isError && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{offboardErrorText(m.error, t)}</p>}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} disabled={m.isPending} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-40">{t("Cancel")}</button>
              <button type="submit" disabled={!dayValid || m.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-40">
                {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />} {m.isPending ? t("Offboarding…") : t("Offboard")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Undo an offboarding (POST /api/admin/users/:id/reinstate). Says what does NOT come back. */
function ReinstateUserModal({ user, onClose }: { user: NexusAdminUser; onClose: () => void }) {
  const qc = useQueryClient();
  const { t } = useLang();
  const name = user.name || user.email || "";
  const workspaces = Array.from(new Set((user.formerMemberships ?? []).map((f) => f.workspaceName)));
  const m = useMutation({
    mutationFn: () => nexusApi.reinstateUser(user.id),
    onSuccess: (r) => {
      for (const key of ["admin-users", "workspace-members", "approval-chart", "admin-user-memberships"]) qc.invalidateQueries({ queryKey: ["nexus", key] });
      toast.success(t("{name} is back.", { name: r.user.name }));
      onClose();
    },
  });
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 dark:bg-scrim p-4" onClick={() => { if (!m.isPending) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="min-w-0 font-display text-base font-bold tracking-tight">{t("Reinstate {name}?", { name })}</h2>
          <button onClick={onClose} disabled={m.isPending} aria-label={t("Close")} className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2 text-sm">
          <p>{workspaces.length > 0
            ? t("They can sign in again and are back in {workspaces} with the role and settings they had.", { workspaces: workspaces.join(", ") })
            : t("They can sign in again.")}</p>
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">{t("Not restored: projects, teams, passkeys, devices, and anyone who had them as approver. Set those again by hand.")}</p>
        </div>
        {m.isError && <p className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-400">{offboardErrorText(m.error, t)}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={m.isPending} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-40">{t("Cancel")}</button>
          <button onClick={() => m.mutate()} disabled={m.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
            {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} {t("Reinstate")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Permanent account deletion (BoD / One Above All). Reassigns the target's owned content to the
// acting admin, purges personal/ephemeral rows, then deletes. Requires typing HAPUS to confirm.
function DeleteUserModal({ user, onClose }: { user: { id: string; name: string; email: string; deactivated?: boolean }; onClose: () => void }) {
  const qc = useQueryClient();
  const { t, tn } = useLang();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-scrim p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-bold tracking-tight text-rose-700 dark:text-rose-300">{t("Delete account permanently")}</h2>
          <button onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm">{t("The account {name} ({email}) has been permanently deleted.", { name: result.deletedUser.name, email: result.deletedUser.email })}</p>
            {reassignedTotal > 0 && <p className="text-xs text-muted-foreground">{tn(reassignedTotal, "{n} item they created (task, file, goal, portfolio) was moved to your account, so nothing is lost.", "{n} items they created (tasks, files, goals, portfolios) were moved to your account, so nothing is lost.")}</p>}
            <button onClick={onClose} className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90">{t("Done")}</button>
          </div>
        ) : (
          <>
            <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              <p>{t("You're about to permanently delete this account:")}</p>
              <p className="mt-1 font-bold">{user.name} <span className="font-normal">· {user.email}</span></p>
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                <li>{t("Tasks, files, goals, portfolios, docs and schedules they created move to you, so they aren't lost.")}</li>
                <li>{t("Their status updates, pending invites and audit trail are deleted. Their comments are removed too.")}</li>
                <li><b>{t("This can't be undone.")}</b></li>
              </ul>
            </div>
            <label className="block text-xs font-semibold text-muted-foreground">{t("Type DELETE to confirm")}
              <input autoFocus value={confirmTxt} onChange={(e) => setConfirmTxt(e.target.value)} placeholder="DELETE" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-rose-400" />
            </label>
            {err && (
              // An account with attendance history is never deleted (owner, 8 Oct 2026): it is offboarded.
              (err.payload as { code?: string } | undefined)?.code === "HAS_ATTENDANCE_DATA" ? (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                  {user.deactivated
                    ? t("This account has attendance records or requests, so it can't be deleted. It's offboarded already: it can't sign in, and its history stays.")
                    : t("This account has attendance records or requests. Use Offboard instead, so they stay.")}
                </p>
              ) : (
                <p className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-400">{(err.payload as { message?: string } | undefined)?.message ?? err.message}</p>
              )
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={onClose} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-accent">{t("Cancel")}</button>
              <button disabled={!ready || m.isPending} onClick={() => m.mutate()} className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-40">
                {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {t("Delete permanently")}
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
  // `t` is a task or a team in the callbacks below, so the translator goes by another name here.
  const { t: tq, tn } = useLang();
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
      {list.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><Trophy className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">{tq("BoD access required")}</div><p className="mt-2 text-sm text-muted-foreground">{tq("You need the BoD or Manager role to manage goals.")}</p></div>}
      {!list.isError && (
        <>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <h2 className="mb-1 font-display text-base font-bold tracking-tight">{tq("Assign a new goal")}</h2>
            <p className="mb-3 text-xs text-muted-foreground">{tq("Create a goal: finish tasks against a target and a due date, for an XP reward (max 50).")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tq("Goal title (e.g. Finish 5 tasks this week)")} className={cn(inputCls, "sm:col-span-2")} />
              <label className="text-xs font-semibold text-muted-foreground">{tq("Type")}
                <select value={requirementType} onChange={(e) => setRequirementType(e.target.value)} className={cn(inputCls, "mt-1 w-full font-normal")}>
                  {REQ_TYPES.filter((r) => r.value !== "penalty").map((r) => <option key={r.value} value={r.value}>{tq(r.label)}</option>)}
                </select>
              </label>
              {!isTasks && (
                <label className="text-xs font-semibold text-muted-foreground">{tq("Target (number of tasks)")}
                  <input value={requiredCount} onChange={(e) => setRequiredCount(e.target.value.replace(/[^0-9]/g, ""))} className={cn(inputCls, "mt-1 w-full")} />
                </label>
              )}
              <label className="text-xs font-semibold text-muted-foreground">{tq("Deadline")}
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={cn(inputCls, "mt-1 w-full")} />
              </label>
              <label className="text-xs font-semibold text-muted-foreground">{tq("XP reward (max 50)")}
                <input type="number" min={0} max={50} value={xpReward} onChange={(e) => setXpReward(String(Math.min(50, Math.max(0, parseInt(e.target.value, 10) || 0))))} className={cn(inputCls, "mt-1 w-full")} />
              </label>
            </div>
            {isTasks ? (
              <div className="mt-3">
                <span className="text-xs font-semibold text-muted-foreground">{tq("Tasks for this goal")} <span className="font-normal">{tq("(complete when all are done · XP goes to whoever does them · visible to members of the task's project)")}</span></span>
                <div className="mt-1.5 space-y-1">
                  {questTasks.length === 0 && <p className="text-xs text-muted-foreground">{tq("No tasks picked yet. Search below.")}</p>}
                  {questTasks.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <button type="button" onClick={() => setQuestTasks((prev) => prev.filter((x) => x.id !== t.id))} className="rounded p-0.5 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
                <div className="relative mt-1.5">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} placeholder={tq("Search tasks to add (at least 2 letters)…")} className={cn(inputCls, "w-full border-dashed pl-8")} />
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
                <span className="text-xs font-semibold text-muted-foreground">{tq("Assign to team")} <span className="font-normal">{tq("(pick one or more · empty = everyone)")}</span></span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {teams.length === 0 && <span className="text-xs text-muted-foreground">{tq("No teams yet.")}</span>}
                  {teams.map((t) => {
                    const on = selectedTeams.has(t.id);
                    return <button key={t.id} type="button" onClick={() => toggleTeam(t.id)} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}><span className="h-2 w-2 rounded-full" style={{ background: t.color ?? "#7b68ee" }} />{t.name}</button>;
                  })}
                </div>
              </div>
            )}
            <button disabled={!title.trim() || !workspaceId || create.isPending || (isTasks && questTasks.length === 0)} onClick={() => create.mutate()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {isTasks ? tq("Create goal") : tq("Assign goal")}</button>
            {create.isError && <span className="ml-2 text-xs font-semibold text-destructive">{tq("Couldn't save. Check your access.")}</span>}
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            {list.isLoading && <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            <div className="divide-y divide-border">
              {rows.map((q) => (
                <div key={q.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Trophy className="h-4 w-4 shrink-0 text-warning-foreground dark:text-warning" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{q.title}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{(() => { const lbl = REQ_TYPES.find((r) => r.value === q.requirementType)?.label; return lbl ? tq(lbl) : q.requirementType; })()} · {q.requirementType === "specific_tasks" ? tn(q.requiredCount, "{n} task", "{n} tasks") : tq("target {n}", { n: q.requiredCount })}</span>
                      <span className="font-bold text-success">+{q.xpReward} XP</span>
                      {q.deadline && <span>· ⏰ {tq("until {date}", { date: fmtDate(q.deadline) })}</span>}
                      {q.requirementType === "specific_tasks"
                        ? <span>· {tq("members of the task's project")}</span>
                        : <span>· {q.teamIds && q.teamIds.length > 0 ? q.teamIds.map(teamName).join(", ") : tq("Everyone")}</span>}
                    </div>
                  </div>
                  <button onClick={() => { if (confirm(tq("Delete this goal?"))) del.mutate(q.id); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            {!list.isLoading && rows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">{tq("No goals yet. Create one above.")}</div>}
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
        active ? "border-primary ring-1 ring-primary dark:border-ring dark:ring-ring" : "border-border",
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
  const { t, tn, locale } = useLang();
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
    onError: (e: unknown) => toast.error(t("Couldn't attach the PDF"), { description: e instanceof ApiError ? e.message : t("Try again.") }),
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
    onSuccess: () => { setTitle(""); setBody(""); setTone("info"); setAudience("all"); setTargetIds([]); setMemberSearch(""); setRepeatDays(0); setRepeatAtTime("09:00"); setSpOn(false); setAttachment(null); invalidate(); toast.success(t("Posted")); },
    onError: (e: unknown) => toast.error(t("Couldn't post"), { description: e instanceof ApiError ? e.message : t("Try again.") }),
  });
  const toggle = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => nexusApi.updateAnnouncement(id, { active }), onSuccess: invalidate });
  const del = useMutation({ mutationFn: (id: string) => nexusApi.deleteAnnouncement(id), onSuccess: invalidate });
  const rows = list.data?.announcements ?? [];

  return (
    <div className="space-y-5">
      {list.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><Megaphone className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">{t("BoD access required")}</div><p className="mt-2 text-sm text-muted-foreground">{t("You need the BoD role or above to manage announcements.")}</p></div>}
      {!list.isError && (
        <>
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="text-sm font-bold">{t("Create a pop-up announcement")}</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Announcement title")} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder={t("Announcement text… (several lines are fine)")} className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />

            {/* Audience: everyone, or specific people */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("Audience")}</span>
                <div className="flex rounded-lg border border-border p-0.5">
                  {(["all", "some"] as const).map((a) => (
                    <button key={a} onClick={() => setAudience(a)} className={cn("rounded-md px-2.5 py-1 text-xs font-bold transition-colors", audience === a ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>{a === "all" ? t("Everyone") : t("Selected people")}</button>
                  ))}
                </div>
              </div>
              {audience === "some" && (
                <div className="space-y-2 rounded-xl border border-border bg-background p-2.5">
                  {targetIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {targetIds.map((id) => { const u = members.find((m) => m.id === id); return (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                          {u?.name ?? t("user")} <button onClick={() => toggleTarget(id)} aria-label={t("Remove")}><X className="h-3 w-3" /></button>
                        </span>
                      ); })}
                    </div>
                  )}
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder={t("Search a name to add…")} className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary" />
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
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" /> {t("Attach PDF (SP)")}
              </label>
              {spOn && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/50 p-2.5 dark:border-rose-900 dark:bg-rose-950/20">
                  {attachment ? (
                    <>
                      <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white">SP</span>
                      <a href={attachment.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-sm font-semibold text-foreground hover:underline"><FileText className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />{attachment.name}</a>
                      <span className="text-xs text-muted-foreground">{(attachment.size / 1024 / 1024).toFixed(2)} MB</span>
                      <button onClick={() => setAttachment(null)} aria-label={t("Remove PDF")} className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
                    </>
                  ) : (
                    <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent", upload.isPending && "pointer-events-none opacity-60")}>
                      {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                      {upload.isPending ? t("Uploading…") : t("Choose PDF (max 10 MB)")}
                      <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        if (f.size > 10 * 1024 * 1024) { toast.error(t("The PDF is larger than 10 MB")); return; }
                        upload.mutate(f);
                      }} />
                    </label>
                  )}
                  <span className="w-full text-xs text-muted-foreground">{t("Shown with a red SP badge and an Open PDF button in the pop-up.")}{audience === "all" ? " " + t("This goes to everyone. Pick Selected people for a personal SP.") : ""}</span>
                </div>
              )}
            </div>

            {/* Repeat. A notice posted once reaches whoever happened to open NEXUS that hour; "wear
                your ID card this week" has to be said on each of those days, and re-typing it daily
                is how it stops being said at all. */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("Repeat")}</span>
                <div className="flex rounded-lg border border-border p-0.5">
                  {[0, 2, 3, 5, 7].map((d) => (
                    <button key={d} onClick={() => setRepeatDays(d)} className={cn("rounded-md px-2.5 py-1 text-xs font-bold transition-colors", repeatDays === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>{d === 0 ? t("Once") : t("{n} more days", { n: d })}</button>
                  ))}
                </div>
                {repeatDays > 0 && (
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    {t("at")}
                    <input type="time" value={repeatAtTime} onChange={(e) => setRepeatAtTime(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary" />
                    WIB
                  </label>
                )}
              </div>
              {repeatDays > 0 && (
                <p className="text-xs text-muted-foreground">
                  {tn(repeatDays, "Goes out now, then again each day for {n} more day at about {time}, as a pop-up and a push. It shows again for everyone each time, including people who already closed it.", "Goes out now, then again each day for {n} more days at about {time}, as a pop-up and a push. It shows again for everyone each time, including people who already closed it.", { time: repeatAtTime })}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select value={tone} onChange={(e) => setTone(e.target.value)} className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="info">{t("Info (blue)")}</option>
                <option value="success">{t("Success (green)")}</option>
                <option value="warning">{t("Warning (yellow)")}</option>
              </select>
              <button onClick={() => create.mutate()} disabled={!title.trim() || !body.trim() || create.isPending || (audience === "some" && targetIds.length === 0) || (spOn && !attachment)} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />} {t("Post")}
              </button>
              <span className="text-xs text-muted-foreground">{audience === "some" ? tn(targetIds.length, "Shows only to the {n} selected person.", "Shows only to the {n} selected people.") : t("Shows once to everyone.")}</span>
            </div>
          </div>

          <div className="space-y-2">
            {list.isLoading && <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            {rows.map((a: NexusAdminAnnouncement) => (
              <div key={a.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-soft">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.kind === "sp" && <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white">SP</span>}
                    {a.kind === "warning" && <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-black uppercase text-white">{t("Warning")}</span>}
                    <span className="text-sm font-bold">{a.title}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", a.active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{a.active ? t("Active") : t("Inactive")}</span>
                    {a.repeatUntil && new Date(a.repeatUntil) >= new Date(new Date().toDateString()) && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">{t("Repeats daily {time} until {date}", { time: a.repeatAtTime ?? "", date: new Date(a.repeatUntil).toLocaleDateString(locale) })}</span>
                    )}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{a.tone}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{a.body}</p>
                  {a.attachmentUrl && (
                    <a href={a.attachmentUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><FileText className="h-3.5 w-3.5" />{a.attachmentName ?? "PDF"}</a>
                  )}
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {fmtDate(a.createdAt)} · {a.targetCount
                      ? t("to {who}", { who: a.targets?.length ? a.targets.slice(0, 4).map((x) => x.name ?? "?").join(", ") + (a.targets.length > 4 ? ` +${a.targets.length - 4}` : "") : tn(a.targetCount, "{n} person", "{n} people") })
                      : t("to everyone")} · {t("{n} read", { n: a.seenCount })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => toggle.mutate({ id: a.id, active: !a.active })} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-accent">{a.active ? t("Deactivate") : t("Activate")}</button>
                  <button onClick={() => del.mutate(a.id)} aria-label={t("Delete")} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-rose-600 dark:hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
            {!list.isLoading && rows.length === 0 && <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">{t("No announcements yet.")}</div>}
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
/** Control Room › GIDEON: Insights (every run, 12 Oct 2026) and People (who uses it, counts only). */
function GideonAdmin() {
  const { t } = useLang();
  const [tab, setTab] = useState<"insights" | "people">("insights");
  const btn = (on: boolean) => cn("rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent");
  return (
    <div className="space-y-4">
      <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-background p-0.5">
        <button type="button" className={btn(tab === "insights")} onClick={() => setTab("insights")}>{t("Insights")}</button>
        <button type="button" className={btn(tab === "people")} onClick={() => setTab("people")}>{t("People")}</button>
      </div>
      {tab === "insights" ? <GideonInsights /> : <GideonUsage />}
    </div>
  );
}

function GideonUsage() {
  const { t, locale } = useLang();
  const q = useQuery({ queryKey: ["nexus", "gideon-usage"], queryFn: nexusApi.gideonUsage, retry: false });
  const users = q.data?.users ?? [];
  const totals = q.data?.totals;

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : "—";

  if (q.isLoading) return <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">{t("Loading…")}</div>;
  if (q.isError) return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">{t("Couldn't load GIDEON usage.")}</div>;

  return (
    <div className="space-y-4">
      {totals && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t("Users")} value={totals.people} />
          <Stat label={t("Questions")} value={totals.asked} />
          <Stat label={t("Tools used")} value={totals.toolCalls} />
        </div>
      )}

      {users.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft">
          <GideonMark className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <div className="text-lg font-bold">{t("No one has used GIDEON yet")}</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">{t("Person")}</th>
                <th className="px-4 py-3 text-right font-semibold">{t("Questions")}</th>
                <th className="px-4 py-3 text-right font-semibold">{t("Tool calls")}</th>
                <th className="px-4 py-3 font-semibold">{t("First")}</th>
                <th className="px-4 py-3 font-semibold">{t("Last")}</th>
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
  const { t, locale } = useLang();
  const q = useQuery({ queryKey: ["nexus", "app-installs"], queryFn: nexusApi.appInstalls, retry: false });
  const installs = q.data?.installs ?? [];
  const notInstalled = q.data?.notInstalled ?? [];
  const totals = q.data?.totals;

  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short" });

  if (q.isLoading) return <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">{t("Loading…")}</div>;
  if (q.isError) return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">{t("Couldn't load the app list.")}</div>;

  return (
    <div className="space-y-4">
      {totals && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t("Using the app")} value={totals.people} />
          <Stat label={t("Not using it")} value={totals.notInstalled ?? notInstalled.length} />
          <Stat label={t("Devices")} value={totals.devices} />
        </div>
      )}

      {totals && totals.versions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {totals.versions.map((v) => (
            <span key={v.version} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold">
              {v.version === "unknown" ? t("Not reported") : v.version} · {v.count}
            </span>
          ))}
        </div>
      )}

      {installs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft">
          <Smartphone className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <div className="text-lg font-bold">{t("Nobody has installed the app yet")}</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">{t("Person")}</th>
                <th className="px-4 py-3 font-semibold">{t("Version")}</th>
                <th className="px-4 py-3 font-semibold">{t("Device")}</th>
                <th className="px-4 py-3 font-semibold">{t("Last seen")}</th>
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
                            <span className="text-muted-foreground">{t("Not reported")}</span>
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
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("Not using the app · {n}", { n: notInstalled.length })}</div>
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
                      {m.lastActiveAt ? t("Web only · last active {date}", { date: when(m.lastActiveAt) }) : t("Never signed in")}
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
