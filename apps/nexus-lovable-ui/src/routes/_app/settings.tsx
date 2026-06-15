import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate, nexusApi, ORG_ROLE_LABEL, ORG_ROLE_TONE, assignableRoles, canEditTier, type OrgRole, type NexusWorkspaceMember } from "@/lib/nexus-api";
import { Settings as SettingsIcon, User, Bell, Lock, Palette, Webhook, Zap, CreditCard, Loader2, Trash2, ImagePlus, Users, UserPlus, ShieldCheck, KeyRound, Copy, Check, X, Plug, Sparkles, AlertTriangle, Globe, Terminal, Monitor, MessageCircle } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings")({ component: Settings });

const sections = [
  { id: "profile", label: "Profile", icon: User },
  { id: "members", label: "Members", icon: Users },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Lock },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "automation", label: "Automation", icon: Zap },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "mcp", label: "Claude (MCP)", icon: Plug },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "billing", label: "Billing", icon: CreditCard },
];

function Settings() {
  const [active, setActive] = useState("profile");
  return (
    <div>
      <PageHeader title="Tuning Room" subtitle="Workspace preferences, personal setup, and tiny switches that make NEXUS feel yours." icon={<SettingsIcon className="h-6 w-6 text-primary" />} />
      <div className="p-4 md:p-8 grid grid-cols-1 lg:grid-cols-4 gap-6">
        <aside className="lg:col-span-1 space-y-1">
          {sections.map((s) => (
            <button key={s.id} onClick={() => setActive(s.id)}
              className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-md text-sm transition ${active === s.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent text-muted-foreground"}`}>
              <s.icon className="h-4 w-4" /> {s.label}
            </button>
          ))}
        </aside>
        <div className="lg:col-span-3 space-y-6">
          {active === "profile" && <ProfileSection />}
          {active === "members" && <WorkspaceMembersSection />}
          {active === "notifications" && <NotificationsSection />}
          {active === "security" && <SecuritySection />}
          {active === "automation" && <AutomationSection />}
          {active === "webhooks" && <WebhooksSection />}
          {active === "mcp" && <McpTokensSection />}
          {active === "whatsapp" && <WhatsAppLinkCard />}
          {!["profile","members","notifications","security","automation","webhooks","mcp","whatsapp"].includes(active) && (
            <div className="rounded-xl border border-border bg-card p-8 shadow-soft text-center text-muted-foreground text-sm">
              {sections.find((s) => s.id === active)?.label} settings — coming soon.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", ORG_ROLE_TONE[role] ?? "bg-muted text-muted-foreground")}>{ORG_ROLE_LABEL[role] ?? role}</span>;
}

function WorkspaceMembersSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false });
  const me = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false }).data?.user;
  const data = q.data;
  const myRole = data?.role ?? "STAFF";
  const myAssignable = assignableRoles(myRole); // roles this viewer may grant (Super Admin/BoD only)
  const canManage = myAssignable.length > 0;
  const wsId = data?.workspaceId;

  const refresh = () => qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] });
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("STAFF");
  const [search, setSearch] = useState("");

  const invite = useMutation({ mutationFn: () => nexusApi.inviteWorkspaceMember({ email: email.trim(), role: inviteRole, workspaceId: wsId }), onSuccess: () => { setEmail(""); refresh(); } });
  const changeRole = useMutation({ mutationFn: (p: { memberId: string; role: OrgRole }) => nexusApi.updateWorkspaceMember({ memberId: p.memberId, role: p.role, workspaceId: wsId }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (memberId: string) => nexusApi.removeWorkspaceMember(memberId, wsId), onSuccess: refresh });
  // BoD ke atas bisa reset password member lain (tier rule sama kayak ganti role).
  const isBodPlus = myRole === "BOD" || myRole === "ONE_ABOVE_ALL";
  const [pwTarget, setPwTarget] = useState<{ memberId: string; name: string } | null>(null);

  if (q.isError) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-soft">
        <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
        <div className="text-lg font-bold">Workspace tidak ditemukan</div>
        <p className="mt-2 text-sm text-muted-foreground">Login/sesi diperlukan untuk kelola member.</p>
      </div>
    );
  }

  const s = search.trim().toLowerCase();
  const members = (data?.members ?? []).filter((m) => !s || (m.name ?? "").toLowerCase().includes(s) || (m.email ?? "").toLowerCase().includes(s));

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
          <div>
            <h2 className="font-semibold">Invite member</h2>
            <p className="text-xs text-muted-foreground">Tambah orang ke workspace & set role-nya (sesuai level kamu).</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-[200px]"><span className="text-xs font-medium text-muted-foreground">Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orang@patsgroup.id" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </label>
            <label><span className="text-xs font-medium text-muted-foreground">Role</span>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as OrgRole)} className="mt-1 block rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60">
                {[...myAssignable].reverse().map((r) => <option key={r} value={r}>{ORG_ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <button disabled={!email.trim() || invite.isPending} onClick={() => invite.mutate()} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{invite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Invite</button>
          </div>
          {invite.isError && <p className="text-xs font-semibold text-destructive">{(invite.error as Error)?.message ?? "Gagal invite."}</p>}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div><h2 className="font-semibold">Workspace members</h2><p className="text-xs text-muted-foreground">{data?.members.length ?? 0} orang · role kamu: <RoleBadge role={myRole} /></p></div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama/email…" className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary" />
        </div>
        {q.isLoading ? (
          <div className="grid place-items-center py-12 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="divide-y divide-border">
            {members.map((m: NexusWorkspaceMember) => {
              const isSelf = m.userId === me?.id;
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  {m.avatar ? <img src={m.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-border" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary ring-1 ring-border">{(m.name ?? m.email ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{m.name}{isSelf && <span className="ml-1 text-xs font-normal text-muted-foreground">(kamu)</span>}</div>
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                  </div>
                  <MemberPhoneEditor member={m} workspaceId={wsId} canEdit={canManage} />
                  {canEditTier(myRole, m.role) && !isSelf ? (
                    <select value={m.role} onChange={(e) => changeRole.mutate({ memberId: m.id, role: e.target.value as OrgRole })} disabled={changeRole.isPending} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-semibold outline-none focus:border-primary">
                      {[...myAssignable].reverse().map((r) => <option key={r} value={r}>{ORG_ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : <RoleBadge role={m.role} />}
                  {isBodPlus && !isSelf && canEditTier(myRole, m.role) && <button onClick={() => setPwTarget({ memberId: m.id, name: m.name })} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label="Reset password" title="Reset password"><KeyRound className="h-4 w-4" /></button>}
                  {canManage && !isSelf && <button onClick={() => { if (confirm(`Keluarkan ${m.name} dari workspace?`)) remove.mutate(m.id); }} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>}
                </div>
              );
            })}
            {members.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nggak ada member yang cocok.</div>}
          </div>
        )}
        {changeRole.isError && <p className="border-t border-border px-4 py-2 text-xs font-semibold text-destructive">{(changeRole.error as Error)?.message ?? "Gagal ubah role."}</p>}
      </div>
      {pwTarget && <PasswordResetModal target={pwTarget} onClose={() => setPwTarget(null)} />}
    </div>
  );
}

// BoD+ inline editor for a member's WhatsApp/phone number (notif target + WA-bot fallback).
function MemberPhoneEditor({ member, workspaceId, canEdit }: { member: NexusWorkspaceMember; workspaceId?: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [val, setVal] = useState(member.phoneNumber ?? "");
  const dirty = val.trim() !== (member.phoneNumber ?? "");
  const save = useMutation({
    mutationFn: () => nexusApi.updateWorkspaceMember({ memberId: member.id, workspaceId, phoneNumber: val.trim() || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }),
  });
  if (!canEdit) return member.phoneNumber ? <span className="hidden text-xs text-muted-foreground sm:inline">{member.phoneNumber}</span> : null;
  return (
    <div className="flex items-center gap-1">
      <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="08xx / +65…" inputMode="tel" title="Nomor HP / WhatsApp — nomor luar pakai + kode negara" className="w-28 rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary" />
      {dirty && <button onClick={() => save.mutate()} disabled={save.isPending} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50" aria-label="Simpan nomor" title="Simpan">{save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</button>}
    </div>
  );
}

function randomPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$%";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

function PasswordResetModal({ target, onClose }: { target: { memberId: string; name: string }; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(true);
  const [copied, setCopied] = useState(false);
  const reset = useMutation({ mutationFn: () => nexusApi.resetMemberPassword(target.memberId, pw) });
  const copy = () => { navigator.clipboard?.writeText(pw).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /><h3 className="font-bold">Reset password</h3></div>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          {reset.isSuccess ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Password <b>{target.name}</b> berhasil diubah ✅</div>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                <code className="flex-1 truncate text-sm font-semibold">{pw}</code>
                <button onClick={copy} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-accent">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Tersalin" : "Salin"}</button>
              </div>
              <p className="text-xs text-muted-foreground">Kasih password ini ke {target.name} lewat jalur aman. Sarankan dia ganti sendiri di Security.</p>
              <button onClick={onClose} className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Selesai</button>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Set password baru buat <b className="text-foreground">{target.name}</b>. Minimal 8 karakter.</p>
              <div className="flex items-center gap-2">
                <input type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password baru" autoFocus className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                <button onClick={() => setShow((v) => !v)} className="rounded-lg border border-border px-2.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent">{show ? "Hide" : "Show"}</button>
              </div>
              <button onClick={() => { setPw(randomPassword()); setShow(true); }} className="text-xs font-semibold text-primary hover:underline">Buat password acak</button>
              {reset.isError && <p className="text-xs font-semibold text-destructive">{(reset.error as Error)?.message ?? "Gagal reset password."}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent">Batal</button>
                <button disabled={pw.length < 8 || reset.isPending} onClick={() => reset.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{reset.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Set password</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false });
  const u = profile.data?.user;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loaded, setLoaded] = useState(false);
  if (u && !loaded) { setName(u.name ?? ""); setPhone(u.phoneNumber ?? ""); setLoaded(true); }
  const save = useMutation({ mutationFn: () => nexusApi.updateProfile({ name: name.trim(), phoneNumber: phone.trim() || null }), onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "profile"] }) });

  const fileRef = useRef<HTMLInputElement>(null);
  const refreshProfile = () => qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("profile") });
  const uploadAvatar = useMutation({ mutationFn: (file: File) => nexusApi.uploadAvatar(file), onSuccess: refreshProfile });
  const removeAvatar = useMutation({ mutationFn: () => nexusApi.deleteAvatar(), onSuccess: refreshProfile });
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) uploadAvatar.mutate(f); e.target.value = ""; };
  const ini = (u?.name ?? u?.email ?? "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const busy = uploadAvatar.isPending || removeAvatar.isPending;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-6">
        <div>
          <h2 className="font-semibold">Profile</h2>
          <p className="text-xs text-muted-foreground">Visible to your teammates</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            {u?.avatar ? (
              <img src={u.avatar} alt="" className="h-20 w-20 rounded-full object-cover ring-2 ring-border" />
            ) : (
              <div className="grid h-20 w-20 place-items-center rounded-full bg-primary/10 text-xl font-black text-primary ring-2 ring-border">{ini}</div>
            )}
            {busy && <div className="absolute inset-0 grid place-items-center rounded-full bg-background/60"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition hover:bg-accent disabled:opacity-50"><ImagePlus className="h-4 w-4" />Change photo</button>
              {u?.avatar && <button onClick={() => removeAvatar.mutate()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"><Trash2 className="h-4 w-4" />Remove</button>}
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPG, atau WEBP. Maks 5MB.</p>
            {uploadAvatar.isError && <p className="text-xs font-semibold text-destructive">{(uploadAvatar.error as Error)?.message ?? "Upload gagal."}</p>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPick} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block"><span className="text-xs font-medium text-muted-foreground">Full name</span><input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" /></label>
          <label className="block"><span className="text-xs font-medium text-muted-foreground">Email</span><input value={u?.email ?? ""} disabled className="mt-1 w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" /></label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Nomor HP (WhatsApp)</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx · nomor luar pakai + (mis. +65…)" inputMode="tel" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <span className="mt-1 block text-[11px] text-muted-foreground">Dipakai buat notif WhatsApp (assign &amp; mention) dan fallback kalau belum link akun WA. Nomor luar negeri ketik pakai <code>+</code> kode negara.</span>
          </label>
        </div>
        <div className="pt-4 border-t border-border flex justify-end gap-2">
          <button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()} className="inline-flex items-center gap-2 text-sm rounded-md bg-primary text-primary-foreground px-4 py-1.5 shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
        </div>
        {save.isSuccess && <p className="text-right text-xs font-semibold text-success">Profile saved.</p>}
      </div>
      <PasswordSection />
    </div>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({ mutationFn: () => nexusApi.changePassword(current, next), onSuccess: () => { setCurrent(""); setNext(""); } });
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
      <h2 className="font-semibold">Password</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block"><span className="text-xs font-medium text-muted-foreground">Current password</span><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" /></label>
        <label className="block"><span className="text-xs font-medium text-muted-foreground">New password</span><input type="password" value={next} onChange={(e) => setNext(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" /></label>
      </div>
      <div className="flex items-center justify-end gap-2">
        {change.isSuccess && <span className="text-xs font-semibold text-success">Password updated.</span>}
        {change.isError && <span className="text-xs font-semibold text-destructive">Gagal — cek password lama.</span>}
        <button disabled={!current || next.length < 6 || change.isPending} onClick={() => change.mutate()} className="inline-flex items-center gap-2 text-sm rounded-md bg-primary text-primary-foreground px-4 py-1.5 shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{change.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Change password</button>
      </div>
    </div>
  );
}

function NotificationsSection() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["nexus", "notif-prefs"], queryFn: nexusApi.notificationPreferences, retry: false });
  const p = prefs.data?.preferences;
  const update = useMutation({ mutationFn: (patch: Record<string, boolean>) => nexusApi.updateNotificationPreferences(patch), onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "notif-prefs"] }) });
  const toggles: Array<{ key: "emailEnabled" | "slackEnabled" | "desktopEnabled" | "desktopSoundEnabled"; label: string; desc: string }> = [
    { key: "emailEnabled", label: "Email notifications", desc: "Mentions, assignments, and updates via email" },
    { key: "slackEnabled", label: "Slack notifications", desc: "Push key events to your Slack" },
    { key: "desktopEnabled", label: "Desktop notifications", desc: "Browser/desktop push" },
    { key: "desktopSoundEnabled", label: "Desktop sound", desc: "Play a sound on desktop alerts" },
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
      <h2 className="font-semibold">Notifications</h2>
      {prefs.isLoading && <p className="text-sm text-muted-foreground">Loading preferences…</p>}
      <div className="space-y-2">
        {toggles.map((o) => {
          const on = Boolean(p?.[o.key]);
          return (
            <label key={o.key} className="flex items-start justify-between p-3 rounded-lg border border-border hover:bg-accent/30 cursor-pointer">
              <div>
                <div className="text-sm font-medium">{o.label}</div>
                <div className="text-xs text-muted-foreground">{o.desc}</div>
              </div>
              <input type="checkbox" checked={on} disabled={update.isPending} onChange={(e) => update.mutate({ [o.key]: e.target.checked })} className="h-4 w-4 accent-primary mt-1" />
            </label>
          );
        })}
      </div>
    </div>
  );
}

function WhatsAppLinkCard() {
  const qc = useQueryClient();
  // Poll while unlinked so the card auto-flips to "Terhubung" the moment the user sends /link in WhatsApp.
  const status = useQuery({ queryKey: ["wa-link"], queryFn: nexusApi.waLinkStatus, retry: false, refetchInterval: 5000 });
  const linked = status.data?.linked;
  const [gen, setGen] = useState<{ code: string; deepLink: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const generate = useMutation({ mutationFn: nexusApi.waLinkGenerate, onSuccess: (d) => setGen({ code: d.code, deepLink: d.deepLink }) });
  const unlink = useMutation({ mutationFn: nexusApi.waUnlink, onSuccess: () => { setGen(null); qc.invalidateQueries({ queryKey: ["wa-link"] }); } });

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">WhatsApp (Gideon)</h2>
        {linked && <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">Terhubung</span>}
      </div>
      <p className="text-xs text-muted-foreground">Hubungkan WhatsApp kamu biar bisa pakai perintah cepat (<code>/today</code>, <code>/done</code>, …) langsung dari chat, dan notif assign/mention nyampe tepat ke kamu.</p>

      {linked ? (
        <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/5 p-3">
          <span className="text-sm font-medium text-success">✅ WhatsApp terhubung</span>
          <button onClick={() => unlink.mutate()} disabled={unlink.isPending} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50">{unlink.isPending ? "…" : "Putuskan"}</button>
        </div>
      ) : gen ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">Kirim pesan ini ke bot WhatsApp NEXUS (nomor yang biasa ngirim notif):</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-background px-3 py-2 text-sm font-bold tracking-wider">/link {gen.code}</code>
            <button onClick={() => { navigator.clipboard?.writeText(`/link ${gen.code}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent" aria-label="Salin">{copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}</button>
          </div>
          {gen.deepLink && <a href={gen.deepLink} target="_blank" rel="noreferrer" className="block rounded-lg bg-primary py-2 text-center text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90">Buka WhatsApp →</a>}
          <p className="text-[11px] text-muted-foreground">Kode berlaku 10 menit. Halaman ini otomatis update begitu kamu kirim.</p>
        </div>
      ) : (
        <button onClick={() => generate.mutate()} disabled={generate.isPending} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60">{generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} Hubungkan WhatsApp</button>
      )}
    </div>
  );
}

function AutomationSection() {
  const rules = [
    { id: "r1", name: "Auto-assign bugs to QA", trigger: "form.bug_report submitted", action: "Create task in Atlas → assign Marcus" },
    { id: "r2", name: "Move stale tasks", trigger: "Task idle > 7 days", action: "Add 'stale' tag, notify owner" },
    { id: "r3", name: "Sprint complete cleanup", trigger: "Sprint ends", action: "Move incomplete → next sprint" },
  ];
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-6 shadow-soft">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Automation rules</h2>
          <button className="text-xs rounded-md bg-primary text-primary-foreground px-3 py-1.5">+ New rule</button>
        </div>
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-3 hover:bg-accent/30">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{r.name}</div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked className="sr-only peer" />
                  <div className="w-9 h-5 bg-muted peer-checked:bg-primary rounded-full relative transition after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-background after:rounded-full after:h-4 after:w-4 after:transition peer-checked:after:translate-x-4" />
                </label>
              </div>
              <div className="text-xs text-muted-foreground mt-1.5"><span className="font-medium text-foreground/70">When</span> {r.trigger} <span className="font-medium text-foreground/70">→ then</span> {r.action}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const WEBHOOK_EVENTS = ["task.created", "task.updated", "task.completed", "comment.created", "project.updated"];

function WebhooksSection() {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["task.created"]);
  const list = useQuery({ queryKey: ["nexus", "webhooks"], queryFn: nexusApi.webhooks, retry: false });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "webhooks"] });
  const create = useMutation({ mutationFn: () => nexusApi.createWebhook({ url: url.trim(), events }), onSuccess: () => { setUrl(""); invalidate(); } });
  const del = useMutation({ mutationFn: (id: string) => nexusApi.deleteWebhook(id), onSuccess: invalidate });
  const toggle = (e: string) => setEvents((cur) => cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]);
  const rows = list.data ?? [];

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
      <h2 className="font-semibold">Webhooks</h2>
      <div className="space-y-2">
        {list.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!list.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">No webhooks yet.</p>}
        {rows.map((w) => (
          <div key={w.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <div className="truncate font-mono text-sm">{w.url}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{(w.events ?? []).join(", ")}{w.project?.name ? ` · ${w.project.name}` : ""}</div>
            </div>
            <button onClick={() => { if (confirm("Delete webhook?")) del.mutate(w.id); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t border-border pt-4">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-endpoint.com/hook" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        <div className="flex flex-wrap gap-1.5">
          {WEBHOOK_EVENTS.map((e) => (
            <button key={e} onClick={() => toggle(e)} className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${events.includes(e) ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>{e}</button>
          ))}
        </div>
        <button disabled={!url.includes("http") || events.length === 0 || create.isPending} onClick={() => create.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add webhook</button>
        {create.isError && <span className="ml-2 text-xs font-semibold text-destructive">Gagal — cek URL/akses.</span>}
      </div>
    </div>
  );
}

const MCP_URL = "https://nexus.patsgroup.id/api/mcp";

function CopyBox({ label, value, mono = true }: { label?: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };
  return (
    <div className="space-y-1">
      {label && <div className="text-xs font-medium text-muted-foreground">{label}</div>}
      <div className="flex items-stretch gap-2">
        <div className={cn("min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-background px-3 py-2 text-xs", mono && "font-mono")}>{value}</div>
        <button onClick={copy} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold transition hover:bg-accent active:scale-[0.97]">
          {copied ? <><Check className="h-3.5 w-3.5 text-emerald-500" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
        </button>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{n}</span>
      <div className="pt-0.5 text-sm leading-relaxed">{children}</div>
    </li>
  );
}

function McpTutorial() {
  const [tab, setTab] = useState<"app" | "cli" | "desktop">("app");
  const tabs = [
    { id: "app" as const, label: "Aplikasi Claude", icon: Globe },
    { id: "cli" as const, label: "Claude Code", icon: Terminal },
    { id: "desktop" as const, label: "Claude Desktop", icon: Monitor },
  ];
  const desktopConfig = `{
  "mcpServers": {
    "nexus": {
      "command": "npx",
      "args": ["mcp-remote@latest", "${MCP_URL}",
               "--header", "Authorization: Bearer nxs_TOKEN_KAMU"]
    }
  }
}`;
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
      <h2 className="font-semibold">Cara pasang</h2>
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${tab === t.id ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"}`}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "app" && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Buat Claude di <span className="font-semibold">web (claude.ai), desktop, atau HP</span>. Paling gampang — nggak perlu token, tinggal login.</p>
          <ol className="space-y-3">
            <Step n={1}>Buka Claude → <span className="font-semibold">Settings → Connectors</span> (di HP: Settings → Connectors).</Step>
            <Step n={2}>Tap <span className="font-semibold">“Add custom connector”</span>.</Step>
            <Step n={3}>Tempel URL ini sebagai server URL-nya:</Step>
          </ol>
          <CopyBox value={MCP_URL} />
          <ol className="space-y-3" start={4}>
            <Step n={4}>Claude bakal buka halaman <span className="font-semibold">NEXUS</span> — login (kalau belum) terus tap <span className="font-semibold">“Izinkan”</span>.</Step>
            <Step n={5}>Kelar! Tool NEXUS langsung muncul di Claude. 🎉</Step>
          </ol>
        </div>
      )}

      {tab === "cli" && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Buat <span className="font-semibold">Claude Code</span> (CLI di terminal). Pakai token.</p>
          <ol className="space-y-3">
            <Step n={1}>Generate token di bawah (bagian “Generate a token”), terus copy.</Step>
            <Step n={2}>Jalanin command ini di terminal (ganti <span className="font-mono text-xs">nxs_…</span> sama token kamu):</Step>
          </ol>
          <CopyBox value={`claude mcp add --transport http nexus ${MCP_URL} --header "Authorization: Bearer nxs_TOKEN_KAMU"`} />
          <ol className="space-y-3" start={3}>
            <Step n={3}>Cek dengan <span className="font-mono text-xs">/mcp</span> di dalam Claude Code — server “nexus” harus connected.</Step>
          </ol>
        </div>
      )}

      {tab === "desktop" && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Buat <span className="font-semibold">Claude Desktop</span> lewat file config (alternatif kalau nggak mau pakai Connectors UI). Butuh <span className="font-semibold">Node.js</span> keinstall.</p>
          <ol className="space-y-3">
            <Step n={1}>Generate token di bawah, terus copy.</Step>
            <Step n={2}>Buka <span className="font-semibold">Claude Desktop → Settings → Developer → Edit Config</span>.</Step>
            <Step n={3}>Isi (atau gabung) seperti ini — ganti token-nya:</Step>
          </ol>
          <CopyBox value={desktopConfig} />
          <ol className="space-y-3" start={4}>
            <Step n={4}><span className="font-semibold">Restart</span> Claude Desktop. Tool NEXUS muncul di ikon connector.</Step>
          </ol>
          <p className="text-xs text-muted-foreground">Kalau gagal connect, tambahin <span className="font-mono">"--transport", "http-only"</span> di <span className="font-mono">args</span>.</p>
        </div>
      )}
    </div>
  );
}

function McpTokensSection() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [fresh, setFresh] = useState<string | null>(null); // plaintext token, shown once
  const list = useQuery({ queryKey: ["nexus", "mcp-tokens"], queryFn: nexusApi.mcpTokens, retry: false });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "mcp-tokens"] });
  const create = useMutation({
    mutationFn: () => nexusApi.createMcpToken({ name: name.trim() || undefined, expiresInDays }),
    onSuccess: (t) => { setFresh(t.token); setName(""); invalidate(); },
  });
  const revoke = useMutation({ mutationFn: (id: string) => nexusApi.revokeMcpToken(id), onSuccess: invalidate });
  const rows = list.data?.tokens ?? [];
  const connectCmd = fresh ? `claude mcp add --transport http nexus ${MCP_URL} --header "Authorization: Bearer ${fresh}"` : "";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10"><Sparkles className="h-5 w-5 text-primary" /></div>
          <div>
            <h2 className="font-semibold">Connect Claude to NEXUS</h2>
            <p className="text-xs text-muted-foreground">Generate a personal token so Claude (Claude Code / API) can read &amp; manage <span className="font-semibold">tasks</span> on your behalf. The token acts as you — same access you already have. It <span className="font-semibold">cannot</span> touch XP, day-off, attendance, or any admin-only setting.</p>
          </div>
        </div>
      </div>

      <McpTutorial />

      {fresh && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 shadow-soft space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400"><Check className="h-4 w-4" /> Token created</div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Copy it now — for security it&apos;s shown only once and can&apos;t be retrieved again.
          </div>
          <CopyBox label="Your token" value={fresh} />
          <CopyBox label="Run this in your terminal (Claude Code)" value={connectCmd} />
          <button onClick={() => setFresh(null)} className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline">I&apos;ve copied it — hide</button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
        <h2 className="font-semibold">Generate a token</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Label (e.g. My laptop)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <select value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))} className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary">
            <option value={30}>Expires in 30 days</option>
            <option value={90}>Expires in 90 days</option>
            <option value={180}>Expires in 180 days</option>
            <option value={365}>Expires in 365 days</option>
          </select>
        </div>
        <button disabled={create.isPending} onClick={() => create.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} Generate token
        </button>
        {create.isError && <span className="ml-2 text-xs font-semibold text-destructive">{(create.error as Error)?.message ?? "Gagal bikin token."}</span>}
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-3">
        <h2 className="font-semibold">Your tokens {rows.length > 0 && <span className="text-xs font-normal text-muted-foreground">({rows.length}/10)</span>}</h2>
        {list.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!list.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">No tokens yet. Generate one above to connect Claude.</p>}
        <div className="space-y-2">
          {rows.map((t) => {
            const expired = t.expiresAt ? new Date(t.expiresAt).getTime() < Date.now() : false;
            return (
              <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 truncate text-sm font-medium">
                    {t.name}
                    {expired && <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold text-destructive">EXPIRED</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    created {fmtDate(t.createdAt)} · {t.lastUsedAt ? `last used ${fmtDate(t.lastUsedAt)}` : "never used"}{t.expiresAt ? ` · expires ${fmtDate(t.expiresAt)}` : ""}
                  </div>
                </div>
                <button onClick={() => { if (confirm(`Revoke "${t.name}"? Claude will lose access immediately.`)) revoke.mutate(t.id); }} className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition hover:bg-destructive/10 hover:text-destructive active:scale-[0.97]">Revoke</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SecuritySection() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["nexus", "sessions"], queryFn: nexusApi.userSessions, retry: false });
  const revoke = useMutation({ mutationFn: (id: string) => nexusApi.revokeSession(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "sessions"] }) });
  const rows = sessions.data?.sessions ?? [];
  return (
    <div className="space-y-6">
      <PasswordSection />
      <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-3">
        <h2 className="font-semibold">Active sessions</h2>
        {sessions.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!sessions.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">No active sessions.</p>}
        <div className="space-y-2">
          {rows.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{s.userAgent || "Unknown device"}</div>
                <div className="text-xs text-muted-foreground">{s.ipAddress || "—"} · started {fmtDate(s.createdAt)}</div>
              </div>
              <button onClick={() => revoke.mutate(s.id)} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-destructive/10 hover:text-destructive active:scale-[0.97]">Revoke</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input defaultValue={value} className="mt-1 w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/30" />
    </div>
  );
}
