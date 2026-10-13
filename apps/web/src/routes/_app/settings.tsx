import { createFileRoute } from "@tanstack/react-router";
import { failureText, toastFailure } from "@/lib/failure";
import { LoadError } from "@/components/LoadError";
import { EscClose } from "@/hooks/use-escape";
import { SelectPicker } from "@/components/SelectPicker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Segmented } from "@/components/PageLayout";
import { nexusApi, ORG_ROLE_LABEL, ORG_ROLE_TONE, assignableRoles, canEditTier, type OrgRole, type NexusWorkspaceMember } from "@/lib/nexus-api";
import { Settings as SettingsIcon, User, Bell, Lock, Palette, Zap, Loader2, Trash2, ImagePlus, Users, UserPlus, ShieldCheck, KeyRound, Copy, Check, X, Plug, Sparkles, AlertTriangle, Globe, Terminal, Monitor, AtSign, Sun, Moon, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useEdgeFade } from "@/hooks/use-edge-fade";
import { passkeysSupported, registerPasskey } from "@/lib/passkey";
import { useTheme, type Theme } from "@/lib/theme";
import { useLang, type Lang } from "@/lib/lang";
import { thumbUrl } from "@/lib/thumb";
import { ActiveSessions } from "@/components/settings/ActiveSessions";

// The section is in the URL (?section=security), so a reload, Back or a shared link opens the same one
// (QA 13 Oct 2026: it always fell back to Profile).
const SECTION_IDS = ["profile", "members", "notifications", "security", "appearance", "mcp"] as const;
type SectionId = (typeof SECTION_IDS)[number];
export const Route = createFileRoute("/_app/settings")({
  validateSearch: (s: Record<string, unknown>): { section?: SectionId } => ({
    section: typeof s.section === "string" && (SECTION_IDS as readonly string[]).includes(s.section) && s.section !== "profile" ? (s.section as SectionId) : undefined,
  }),
  component: Settings,
});

/** "12 Oct" in the interface language (lib/nexus-api fmtDate is English-only and says "No due date" for empty). */
function fmtDay(value: string | null | undefined, locale: string) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

// Every tab here has controls. "Automation" was only a card saying automations live in each project
// (a dead tab, owner 12 Oct 2026); it is gone, and anything that pointed at it lands on Profile.
const sections = [
  { id: "profile", label: "Profile", icon: User },
  { id: "members", label: "Members", icon: Users },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Lock },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "mcp", label: "Claude (MCP)", icon: Plug },
];

function Settings() {
  const { t } = useLang();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const active: string = search.section ?? "profile";
  const setActive = (id: string) => { void navigate({ search: { section: id === "profile" ? undefined : (id as SectionId) }, replace: true }); };
  const strip = useRef<HTMLElement>(null);
  const stripFade = useEdgeFade(strip);
  return (
    <div>
      <PageHeader title={t("Settings")} subtitle={t("Your profile, security, notifications and workspace preferences.")} />
      {/* Room under the last card for the floating GIDEON button, so a right-aligned action ("Change
          password", "Delete account") can always be scrolled clear of it (UI tour run 7, 14 Oct 2026). */}
      <div className="p-4 md:p-8 md:pb-28 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Below lg the sections are a sideways-scrolling strip (stacked, the list pushed the section below the fold). */}
        <aside ref={strip} className={cn("relative -mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:-mx-8 md:px-8 lg:col-span-1 lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:px-0", stripFade)}>
          {sections.map((s) => (
            <button key={s.id} onClick={() => setActive(s.id)} aria-current={active === s.id ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap min-h-11 lg:min-h-0 lg:w-full text-left flex items-center gap-2 px-3 py-2 rounded-md text-sm transition ${active === s.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent text-muted-foreground"}`}>
              <s.icon className="h-4 w-4 shrink-0" /> {t(s.label)}
            </button>
          ))}
        </aside>
        <div className="lg:col-span-3 space-y-6">
          {active === "profile" && <ProfileSection />}
          {active === "members" && <WorkspaceMembersSection />}
          {active === "notifications" && <NotificationsSection />}
          {active === "security" && <SecuritySection />}
          {active === "appearance" && <AppearanceSection />}
          {active === "mcp" && <McpTokensSection />}
          {!["profile","members","notifications","security","appearance","mcp"].includes(active) && (
            <div className="rounded-xl border border-border bg-card p-8 shadow-soft text-center text-muted-foreground text-sm">
              {t("Coming soon.")}
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
  const { t, tn } = useLang();
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

  const invite = useMutation({ mutationFn: () => nexusApi.inviteWorkspaceMember({ email: email.trim(), role: inviteRole, workspaceId: wsId }), onSuccess: () => { setEmail(""); refresh(); }, onError: (e) => toastFailure(t("Couldn't invite them"), e) });
  const changeRole = useMutation({ mutationFn: (p: { memberId: string; role: OrgRole }) => nexusApi.updateWorkspaceMember({ memberId: p.memberId, role: p.role, workspaceId: wsId }), onSuccess: refresh, onError: (e) => toastFailure(t("Couldn't change the role"), e) });
  const remove = useMutation({ mutationFn: (memberId: string) => nexusApi.removeWorkspaceMember(memberId, wsId), onSuccess: refresh, onError: (e) => toastFailure(t("Couldn't remove them"), e) });
  // BoD ke atas bisa reset password member lain (tier rule sama kayak ganti role).
  const isBodPlus = myRole === "BOD" || myRole === "ONE_ABOVE_ALL";
  const [pwTarget, setPwTarget] = useState<{ memberId: string; name: string } | null>(null);

  if (q.isError) {
    return <LoadError error={q.error} what={t("the members")} onRetry={() => void q.refetch()} />;
  }

  const s = search.trim().toLowerCase();
  const members = (data?.members ?? []).filter((m) => !s || (m.name ?? "").toLowerCase().includes(s) || (m.email ?? "").toLowerCase().includes(s));

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
          <div>
            <h2 className="font-semibold">{t("Invite member")}</h2>
            <p className="text-xs text-muted-foreground">{t("Add someone to the workspace and set their role (up to your own level).")}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-[200px]"><span className="text-xs font-medium text-muted-foreground">{t("Email")}</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("someone@patsgroup.id")} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </label>
            <label><span className="text-xs font-medium text-muted-foreground">{t("Role")}</span>
              <SelectPicker variant="field" value={inviteRole} onChange={(v) => setInviteRole(v as OrgRole)} ariaLabel={t("Role")} options={[...myAssignable].reverse().map((r) => ({ value: r, label: ORG_ROLE_LABEL[r] }))} className="mt-1 flex px-3 py-2" />
            </label>
            <button disabled={!email.trim() || invite.isPending} onClick={() => invite.mutate()} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{invite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} {t("Invite")}</button>
          </div>
          {invite.isError && <p className="text-xs font-semibold text-destructive">{(invite.error as Error)?.message ?? t("Couldn't send the invite.")}</p>}
          {invite.isSuccess && invite.data && (() => {
            const r = invite.data;
            const to = r.member?.email ?? t("them");
            if (r.emailSent === true) return <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t("Invite email sent to {email}.", { email: to })}</p>;
            if (r.emailSent !== false) return <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t("Added {email}.", { email: to })}</p>;
            // Same link the email would have carried: a new account sets its password first.
            const origin = typeof window !== "undefined" ? window.location.origin : "";
            const signIn = r.accountCreated ? `${origin}/forgot-password?email=${encodeURIComponent(r.member?.email ?? "")}&invited=1` : `${origin}/login`;
            return <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">{t("Added {email}, but the email couldn't be sent. Share the sign-in link yourself:", { email: to })} <span className="select-all break-all font-mono font-normal">{signIn}</span></p>;
          })()}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div><h2 className="font-semibold">{t("Workspace members")}</h2><p className="text-xs text-muted-foreground">{tn(data?.members.length ?? 0, "{n} person", "{n} people")} · {t("your role:")} <RoleBadge role={myRole} /></p></div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search name or email…")} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary" />
        </div>
        {q.isLoading ? (
          <div className="grid place-items-center py-12 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="divide-y divide-border">
            {members.map((m: NexusWorkspaceMember) => {
              const isSelf = m.userId === me?.id;
              return (
                // Phone: who on the first line (full width), the controls on a second line under the name. In one
                // squeezed row the name fell to one letter, the phone field overflowed and the bin wrapped (QA B11).
                <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  {m.avatar ? <img src={thumbUrl(m.avatar, 40)} loading="lazy" decoding="async" alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-border" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary ring-1 ring-border">{(m.name ?? m.email ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}</span>}
                  <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-3rem)]">
                    <div className="truncate text-sm font-semibold">{m.name}{isSelf && <span className="ml-1 text-xs font-normal text-muted-foreground">{t("(you)")}</span>}</div>
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                  </div>
                  <div className="flex items-center gap-2 max-sm:w-full max-sm:flex-wrap max-sm:pl-12">
                  <MemberPhoneEditor member={m} workspaceId={wsId} canEdit={canManage} />
                  <span className="flex-1 sm:hidden" />
                  {canEditTier(myRole, m.role) && !isSelf ? (
                    <SelectPicker variant="field" size="sm" align="end" value={m.role} onChange={(v) => changeRole.mutate({ memberId: m.id, role: v as OrgRole })} disabled={changeRole.isPending} ariaLabel={t("Role")} options={[...myAssignable].reverse().map((r) => ({ value: r, label: ORG_ROLE_LABEL[r] }))} className="h-8 px-2 font-semibold" />
                  ) : <RoleBadge role={m.role} />}
                  {isBodPlus && !isSelf && canEditTier(myRole, m.role) && <button onClick={() => setPwTarget({ memberId: m.id, name: m.name })} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label={t("Reset password")} title={t("Reset password")}><KeyRound className="h-4 w-4" /></button>}
                  {canManage && !isSelf && <button onClick={() => { if (confirm(t("Remove {name} from the workspace?", { name: m.name }))) remove.mutate(m.id); }} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive" aria-label={t("Remove")}><Trash2 className="h-4 w-4" /></button>}
                  </div>
                </div>
              );
            })}
            {members.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t("No members match.")}</div>}
          </div>
        )}
        {changeRole.isError && <p className="border-t border-border px-4 py-2 text-xs font-semibold text-destructive">{(changeRole.error as Error)?.message ?? t("Couldn't change the role.")}</p>}
      </div>
      {pwTarget && <PasswordResetModal target={pwTarget} onClose={() => setPwTarget(null)} />}
    </div>
  );
}

// BoD+ inline editor for a member's phone number (contact detail on the account).
function MemberPhoneEditor({ member, workspaceId, canEdit }: { member: NexusWorkspaceMember; workspaceId?: string; canEdit: boolean }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [val, setVal] = useState(member.phoneNumber ?? "");
  const dirty = val.trim() !== (member.phoneNumber ?? "");
  const save = useMutation({
    mutationFn: () => nexusApi.updateWorkspaceMember({ memberId: member.id, workspaceId, phoneNumber: val.trim() || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] }),
  });
  if (!canEdit) return member.phoneNumber ? <span className="hidden text-xs text-muted-foreground sm:inline">{member.phoneNumber}</span> : null;
  return (
    // Wide enough for "+62 8xx xxxx xxxx" (QA B11: the number was cut on a phone).
    <div className="flex min-w-0 items-center gap-1 max-sm:basis-full">
      <input value={val} onChange={(e) => setVal(e.target.value)} placeholder={t("08xx / +65…")} inputMode="tel" title={t("Phone number. For numbers outside Indonesia, use + and the country code.")} className="w-36 min-w-0 rounded-lg tabular-nums max-sm:flex-1 border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary" />
      {dirty && <button onClick={() => save.mutate()} disabled={save.isPending} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50" aria-label={t("Save number")} title={t("Save")}>{save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</button>}
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
  const { t } = useLang();
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(true);
  const [copied, setCopied] = useState(false);
  const reset = useMutation({ mutationFn: () => nexusApi.resetMemberPassword(target.memberId, pw) });
  const copy = () => { navigator.clipboard?.writeText(pw).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 dark:bg-scrim p-4 backdrop-blur-sm" onClick={onClose}>
      <EscClose onClose={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t("Reset password")} className="w-full max-w-md rounded-2xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /><h3 className="font-bold">{t("Reset password")}</h3></div>
          <button onClick={onClose} aria-label={t("Close")} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          {reset.isSuccess ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">{t("{name}'s password was changed.", { name: target.name })}</div>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                <code className="flex-1 truncate text-sm font-semibold">{pw}</code>
                <button onClick={copy} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-accent">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? t("Copied") : t("Copy")}</button>
              </div>
              <p className="text-xs text-muted-foreground">{t("Send this password to {name} through a secure channel, and ask them to change it themselves in Security.", { name: target.name })}</p>
              <button onClick={onClose} className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">{t("Done")}</button>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t("Set a new password for {name}. At least 8 characters.", { name: target.name })}</p>
              <div className="flex items-center gap-2">
                <input type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t("New password")} autoFocus className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                <button onClick={() => setShow((v) => !v)} className="rounded-lg border border-border px-2.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent">{show ? t("Hide") : t("Show")}</button>
              </div>
              <button onClick={() => { setPw(randomPassword()); setShow(true); }} className="text-xs font-semibold text-primary hover:underline">{t("Generate a random password")}</button>
              {reset.isError && <p className="text-xs font-semibold text-destructive">{(reset.error as Error)?.message ?? t("Couldn't reset the password.")}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent">{t("Cancel")}</button>
                <button disabled={pw.length < 8 || reset.isPending} onClick={() => reset.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{reset.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {t("Set password")}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Self-service email change with OTP-to-the-new-address (backend: /api/user/email/request + /verify).
function EmailChangeField({ currentEmail, onChanged }: { currentEmail: string; onChanged: () => void }) {
  const { t } = useLang();
  const [mode, setMode] = useState<"idle" | "editing" | "sent">("idle");
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const reset = () => { setMode("idle"); setNewEmail(""); setPassword(""); setCode(""); setMsg(null); };
  const request = useMutation({
    mutationFn: () => nexusApi.requestEmailChange(newEmail.trim(), password),
    onSuccess: (r) => { setMode("sent"); setCode(""); setMsg(null); setCooldown(r.resendInSeconds ?? 60); },
    onError: (e) => setMsg(e instanceof Error ? e.message : t("Couldn't send the code.")),
  });
  const verify = useMutation({
    mutationFn: () => nexusApi.verifyEmailChange(newEmail.trim(), code.trim()),
    onSuccess: () => { onChanged(); reset(); },
    onError: (e) => setMsg(e instanceof Error ? e.message : t("Wrong code.")),
  });

  return (
    <div className="block">
      <span className="text-xs font-medium text-muted-foreground">{t("Email")}</span>
      {mode === "idle" ? (
        <div className="mt-1 flex items-center gap-2">
          <input value={currentEmail} disabled className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground dark:text-foreground/80" />
          <button type="button" onClick={() => { setMode("editing"); setMsg(null); }} className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-accent">{t("Change")}</button>
        </div>
      ) : (
        <div className="mt-1 space-y-2 rounded-lg border border-border bg-muted/20 p-3">
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            disabled={mode === "sent" || request.isPending}
            type="email"
            placeholder={t("Your new email")}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
          />
          {mode === "editing" && (
            <>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={request.isPending}
              type="password"
              autoComplete="current-password"
              placeholder={t("Your current password")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
            />
            <p className="text-[11px] text-muted-foreground">{t("To make sure it's you. Your old email will be told about this change.")}</p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={!newEmail.trim() || !password || request.isPending} onClick={() => request.mutate()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">{request.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("Send code")}</button>
              <button type="button" onClick={reset} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-accent">{t("Cancel")}</button>
            </div>
            </>
          )}
          {mode === "sent" && (
            <>
              <p className="text-[11px] text-muted-foreground">{t("A 6-digit code was sent to {email}. Check your inbox (and spam).", { email: newEmail.trim() })}</p>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="______"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-center text-sm font-bold tracking-[0.4em] outline-none focus:border-primary"
              />
              <div className="flex items-center gap-2">
                <button type="button" disabled={code.length !== 6 || verify.isPending} onClick={() => verify.mutate()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">{verify.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t("Verify & change")}</button>
                <button type="button" disabled={cooldown > 0 || request.isPending} onClick={() => request.mutate()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-accent disabled:opacity-50">{cooldown > 0 ? t("Resend ({n}s)", { n: cooldown }) : t("Resend code")}</button>
                <button type="button" onClick={reset} className="ml-auto rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-accent">{t("Cancel")}</button>
              </div>
            </>
          )}
          {msg && <p className="text-[11px] font-semibold text-destructive">{msg}</p>}
        </div>
      )}
    </div>
  );
}

function ProfileSection() {
  const { t } = useLang();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false });
  const u = profile.data?.user;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loaded, setLoaded] = useState(false);
  if (u && !loaded) { setName(u.name ?? ""); setPhone(u.phoneNumber ?? ""); setLoaded(true); }
  const save = useMutation({ mutationFn: () => nexusApi.updateProfile({ name: name.trim(), phoneNumber: phone.trim() || null }), onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "profile"] }), onError: (e) => toastFailure(t("Couldn't save your profile"), e) });

  const fileRef = useRef<HTMLInputElement>(null);
  const refreshProfile = () => qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("profile") });
  const uploadAvatar = useMutation({ mutationFn: (file: File) => nexusApi.uploadAvatar(file), onSuccess: refreshProfile, onError: (e) => toastFailure(t("Couldn't upload the photo"), e) });
  const removeAvatar = useMutation({ mutationFn: () => nexusApi.deleteAvatar(), onSuccess: refreshProfile, onError: (e) => toastFailure(t("Couldn't remove the photo"), e) });
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) uploadAvatar.mutate(f); e.target.value = ""; };
  const ini = (u?.name ?? u?.email ?? "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const busy = uploadAvatar.isPending || removeAvatar.isPending;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-6">
        <div>
          <h2 className="font-semibold">{t("Profile")}</h2>
          <p className="text-xs text-muted-foreground">{t("Visible to your teammates")}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            {u?.avatar ? (
              <img src={thumbUrl(u.avatar, 80)} loading="lazy" decoding="async" alt="" className="h-20 w-20 rounded-full object-cover ring-2 ring-border" />
            ) : (
              <div className="grid h-20 w-20 place-items-center rounded-full bg-primary/10 text-xl font-black text-primary ring-2 ring-border">{ini}</div>
            )}
            {busy && <div className="absolute inset-0 grid place-items-center rounded-full bg-background/60"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition hover:bg-accent disabled:opacity-50"><ImagePlus className="h-4 w-4" />{t("Change photo")}</button>
              {u?.avatar && <button onClick={() => removeAvatar.mutate()} disabled={busy} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"><Trash2 className="h-4 w-4" />{t("Remove")}</button>}
            </div>
            <p className="text-xs text-muted-foreground">{t("PNG, JPG or WEBP. Max 5 MB.")}</p>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPick} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block"><span className="text-xs font-medium text-muted-foreground">{t("Full name")}</span><input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" /></label>
          <EmailChangeField currentEmail={u?.email ?? ""} onChanged={refreshProfile} />
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Google Workspace</span>
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              {u?.googleWorkspaceEmail
                ? <><AtSign className="h-4 w-4 shrink-0 text-primary" /><span className="truncate font-medium">{u.googleWorkspaceEmail}</span></>
                : <span className="text-muted-foreground">{t("No company Google account linked yet. A BoD links it from Control Room.")}</span>}
            </div>
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">{t("Phone number")}</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("08xxxxxxxxxx · outside Indonesia, start with + (e.g. +65…)")} inputMode="tel" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <span className="mt-1 block text-[11px] text-muted-foreground">{t("For numbers outside Indonesia, type + and the country code.")}</span>
          </label>
        </div>
        <div className="pt-4 border-t border-border flex justify-end gap-2">
          <button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()} className="inline-flex items-center gap-2 text-sm rounded-md bg-primary text-primary-foreground px-4 py-1.5 shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save")}</button>
        </div>
        {save.isSuccess && <p className="text-right text-xs font-semibold text-success">{t("Profile saved.")}</p>}
      </div>
      <PasswordSection />
      <DeleteAccountSection />
    </div>
  );
}

function DeleteAccountSection() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-destructive/40 bg-card p-6 shadow-soft space-y-3">
      <div>
        <h2 className="font-semibold text-destructive">{t("Delete account")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("Permanently delete your NEXUS account. You won't be able to sign in again, and this can't be undone.")}</p>
      </div>
      <div className="flex justify-end">
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-1.5 text-sm font-semibold text-destructive-foreground shadow-soft transition-all duration-150 hover:bg-destructive/90 active:scale-[0.98]"><Trash2 className="h-4 w-4" /> {t("Delete account")}</button>
      </div>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const [typed, setTyped] = useState("");
  const del = useMutation({
    mutationFn: () => nexusApi.deleteMyAccount(),
    onSuccess: async () => {
      // The account is gone server-side; clear the session cookie the same way the sidebar's
      // Log out does, then a full reload to /login drops every cached query.
      try { await nexusApi.logout(); } catch { /* best effort — the session is already dead on the server */ }
      window.location.href = "/login";
    },
  });
  const confirmed = typed.trim() === "DELETE";
  const busy = del.isPending || del.isSuccess;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 dark:bg-scrim p-4 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <EscClose onClose={() => { if (!busy) onClose(); }} />
      <div role="dialog" aria-modal="true" aria-labelledby="delete-account-title" className="w-full max-w-md rounded-2xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /><h3 id="delete-account-title" className="font-bold">{t("Delete your account?")}</h3></div>
          <button onClick={onClose} disabled={busy} aria-label={t("Close")} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">{t("Here's exactly what happens:")}</p>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>{t("You're signed out everywhere and can no longer sign in, on the web or in the app.")}</li>
            <li>{t("Your name, email, photo and phone number are removed from NEXUS.")}</li>
            <li>{t("Your company keeps your attendance, task and XP history. It will show as “Deleted account”.")}</li>
            <li>{t("This can't be undone. Your email becomes free, so you could sign up again later as a new account.")}</li>
          </ul>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">{t("Type {word} to confirm", { word: "DELETE" })}</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy} placeholder="DELETE" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-destructive" />
          </label>
          {del.isError && <p className="text-xs font-semibold text-destructive">{(del.error as Error)?.message ?? t("Couldn't delete your account. Try again.")}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold transition hover:bg-accent disabled:opacity-50">{t("Cancel")}</button>
            <button disabled={!confirmed || busy} onClick={() => del.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition hover:bg-destructive/90 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {t("Delete my account")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordSection() {
  const { t } = useLang();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({ mutationFn: () => nexusApi.changePassword(current, next), onSuccess: () => { setCurrent(""); setNext(""); } });
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
      <h2 className="font-semibold">{t("Password")}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block"><span className="text-xs font-medium text-muted-foreground">{t("Current password")}</span><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" /></label>
        <label className="block"><span className="text-xs font-medium text-muted-foreground">{t("New password")}</span><input type="password" value={next} onChange={(e) => setNext(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" /></label>
      </div>
      <div className="flex items-center justify-end gap-2">
        {change.isSuccess && <span className="text-xs font-semibold text-success">{t("Password updated.")}</span>}
        {change.isError && <span className="text-xs font-semibold text-destructive">{t("Couldn't change it. Check your current password.")}</span>}
        <button disabled={!current || next.length < 6 || change.isPending} onClick={() => change.mutate()} className="inline-flex items-center gap-2 text-sm rounded-md bg-primary text-primary-foreground px-4 py-1.5 shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{change.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Change password")}</button>
      </div>
    </div>
  );
}

function PasskeysSection() {
  const { t, locale } = useLang();
  const qc = useQueryClient();
  // WebAuthn is a browser API, so this can only be answered after mount — never during SSR.
  const [supported, setSupported] = useState(false);
  const [label, setLabel] = useState("");
  useEffect(() => { setSupported(passkeysSupported()); }, []);
  const list = useQuery({ queryKey: ["nexus", "passkeys"], queryFn: nexusApi.passkeys, retry: false });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "passkeys"] });
  // Resolves to false when the system prompt was dismissed: nothing was added, nothing went wrong.
  const add = useMutation({ mutationFn: () => registerPasskey(label), onSuccess: (created) => { if (created) { setLabel(""); invalidate(); } } });
  const revoke = useMutation({ mutationFn: (id: string) => nexusApi.deletePasskey(id), onSuccess: invalidate, onError: (e) => toastFailure(t("Couldn't remove the passkey"), e) });
  const rows = list.data?.passkeys ?? [];
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
      <div>
        <h2 className="font-semibold">{t("Passkeys")}</h2>
        <p className="text-xs text-muted-foreground">{t("Sign in with Face ID, Touch ID, Windows Hello or your phone, without typing a password. The key stays on your device; NEXUS only keeps the public half.")}</p>
      </div>
      {!supported ? (
        <p className="text-sm text-muted-foreground">{t("This browser doesn't support passkeys. Try a recent Chrome, Safari or Edge. You can still remove the ones below.")}</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("Device name (e.g. MacBook Pro)")} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <button disabled={add.isPending} onClick={() => add.mutate()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">
              {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {t("Add passkey")}
            </button>
          </div>
          {add.isSuccess && add.data && <p className="text-xs font-semibold text-success">{t("Passkey added. Use it to sign in next time.")}</p>}
          {add.isError && <p className="text-xs font-semibold text-destructive">{t("Couldn't add that passkey.")} {failureText(add.error)}</p>}
        </>
      )}

      <div className="space-y-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">{t("Your passkeys")} {rows.length > 0 && <span className="text-xs font-normal text-muted-foreground">({rows.length})</span>}</h3>
        {list.isLoading && <p className="text-sm text-muted-foreground">{t("Loading…")}</p>}
        {list.isError && <p className="text-sm text-muted-foreground">{(list.error as Error)?.message ?? t("Couldn't load your passkeys.")}</p>}
        {!list.isLoading && !list.isError && rows.length === 0 && <p className="text-sm text-muted-foreground">{t("No passkeys yet. Add one above and you can skip the password next time.")}</p>}
        {rows.map((k) => {
          const name = k.label?.trim() || t("Unnamed device");
          const pending = revoke.isPending && revoke.variables === k.id;
          return (
            <div key={k.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t("Added {date}", { date: fmtDay(k.createdAt, locale) })} · {k.lastUsedAt ? t("last used {date}", { date: fmtDay(k.lastUsedAt, locale) }) : t("never used")}</div>
              </div>
              {/* Revoking is permanent — that device has to enrol all over again — so confirm first. */}
              <button disabled={pending} onClick={() => { if (confirm(t("Remove “{name}”? This can't be undone. That device will have to add a new passkey.", { name }))) revoke.mutate(k.id); }} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition hover:bg-destructive/10 hover:text-destructive active:scale-[0.97] disabled:opacity-50">
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} {t("Remove")}
              </button>
            </div>
          );
        })}
        {revoke.isError && <p className="text-xs font-semibold text-destructive">{(revoke.error as Error)?.message ?? t("Couldn't remove that passkey.")}</p>}
      </div>
    </div>
  );
}

function NotificationsSection() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["nexus", "notif-prefs"], queryFn: nexusApi.notificationPreferences, retry: false });
  const p = prefs.data?.preferences;
  const update = useMutation({ mutationFn: (patch: Record<string, boolean>) => nexusApi.updateNotificationPreferences(patch), onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "notif-prefs"] }), onError: (e) => { toastFailure(t("Couldn't save that setting"), e); void qc.invalidateQueries({ queryKey: ["nexus", "notif-prefs"] }); } });
  const { t } = useLang();
  const toggles: Array<{ key: "emailEnabled" | "slackEnabled" | "desktopEnabled" | "desktopSoundEnabled" | "automation"; label: string; desc: string; defaultOn?: boolean }> = [
    { key: "emailEnabled", label: t("Email notifications"), desc: t("Mentions, assignments and updates by email") },
    { key: "slackEnabled", label: t("Slack notifications"), desc: t("Send important events to your Slack") },
    { key: "desktopEnabled", label: t("Desktop notifications"), desc: t("Browser and desktop notifications") },
    { key: "desktopSoundEnabled", label: t("Desktop sound"), desc: t("Play a sound with desktop notifications") },
    { key: "automation", label: t("Automation notifications"), desc: t("Push when a project automation notifies you. Off: they still land in your inbox, silently."), defaultOn: true },
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
      <h2 className="font-semibold">{t("Notifications")}</h2>
      {prefs.isLoading && <p className="text-sm text-muted-foreground">{t("Loading preferences…")}</p>}
      <div className="space-y-2">
        {toggles.map((o) => {
          const on = p?.[o.key] === undefined ? !!o.defaultOn : Boolean(p?.[o.key]);
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

// Was a static mock with two made-up rules and a dead "+ New rule" button (fixed 12 Oct 2026). Automations
// belong to a project; this points there.
// The server this page is on (dev, prod, a LAN shortcut), not a hard-coded prod address (QA B19).
const MCP_URL = typeof window !== "undefined" ? `${window.location.origin}/api/mcp` : "https://nexus.patsgroup.id/api/mcp";

function CopyBox({ label, value, mono = true }: { label?: string; value: string; mono?: boolean }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };
  return (
    <div className="space-y-1">
      {label && <div className="text-xs font-medium text-muted-foreground">{label}</div>}
      <div className="flex items-stretch gap-2">
        <div className={cn("min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-background px-3 py-2 text-xs", mono && "font-mono")}>{value}</div>
        <button onClick={copy} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold transition hover:bg-accent active:scale-[0.97]">
          {copied ? <><Check className="h-3.5 w-3.5 text-emerald-500" /> {t("Copied")}</> : <><Copy className="h-3.5 w-3.5" /> {t("Copy")}</>}
        </button>
      </div>
    </div>
  );
}

/**
 * A translated sentence that keeps its emphasis inside the string, so each language puts it where its
 * grammar wants: `**Settings → Connectors**` is bold, a `backtick` part is code.
 */
function rich(s: string): React.ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <span key={i} className="font-semibold">{part.slice(2, -2)}</span>;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <span key={i} className="font-mono text-xs">{part.slice(1, -1)}</span>;
    return part;
  });
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
  const { t } = useLang();
  const [tab, setTab] = useState<"app" | "cli" | "desktop">("app");
  const tabs = [
    { id: "app" as const, label: "Claude app", icon: Globe },
    { id: "cli" as const, label: "Claude Code", icon: Terminal },
    { id: "desktop" as const, label: "Claude Desktop", icon: Monitor },
  ];
  const desktopConfig = `{
  "mcpServers": {
    "nexus": {
      "command": "npx",
      "args": ["mcp-remote@latest", "${MCP_URL}",
               "--header", "Authorization: Bearer nxs_YOUR_TOKEN"]
    }
  }
}`;
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
      <h2 className="font-semibold">{t("How to set it up")}</h2>
      <Segmented label={t("How to set it up")} size="xs" value={tab} onChange={setTab} options={tabs.map((o) => ({ key: o.id, label: t(o.label), icon: o.icon }))} />

      {tab === "app" && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{rich(t("For Claude on **web (claude.ai), desktop or mobile**. The easiest option: no token needed, just sign in."))}</p>
          <ol className="space-y-3">
            <Step n={1}>{rich(t("Open Claude → **Settings → Connectors** (on mobile: Settings → Connectors)."))}</Step>
            <Step n={2}>{rich(t("Tap **“Add custom connector”**."))}</Step>
            <Step n={3}>{t("Paste this URL as the server URL:")}</Step>
          </ol>
          <CopyBox value={MCP_URL} />
          <ol className="space-y-3" start={4}>
            <Step n={4}>{rich(t("Claude opens a **NEXUS** page. Sign in (if you haven't) and tap **“Allow”**."))}</Step>
            <Step n={5}>{t("Done. The NEXUS tools show up in Claude right away.")}</Step>
          </ol>
        </div>
      )}

      {tab === "cli" && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{rich(t("For **Claude Code** (the CLI in your terminal). Uses a token."))}</p>
          <ol className="space-y-3">
            <Step n={1}>{t("Generate a token below (the “Generate a token” section), then copy it.")}</Step>
            <Step n={2}>{rich(t("Run this command in your terminal (replace `nxs_…` with your token):"))}</Step>
          </ol>
          <CopyBox value={`claude mcp add --transport http nexus ${MCP_URL} --header "Authorization: Bearer nxs_YOUR_TOKEN"`} />
          <ol className="space-y-3" start={3}>
            <Step n={3}>{rich(t("Check with `/mcp` inside Claude Code. The “nexus” server should be connected."))}</Step>
          </ol>
        </div>
      )}

      {tab === "desktop" && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{rich(t("For **Claude Desktop** through a config file (if you'd rather not use Connectors). Needs **Node.js** installed."))}</p>
          <ol className="space-y-3">
            <Step n={1}>{t("Generate a token below, then copy it.")}</Step>
            <Step n={2}>{rich(t("Open **Claude Desktop → Settings → Developer → Edit Config**."))}</Step>
            <Step n={3}>{t("Fill it in (or merge it) like this, with your token:")}</Step>
          </ol>
          <CopyBox value={desktopConfig} />
          <ol className="space-y-3" start={4}>
            <Step n={4}>{rich(t("**Restart** Claude Desktop. The NEXUS tools show up under the connector icon."))}</Step>
          </ol>
          <p className="text-xs text-muted-foreground">{rich(t("If it doesn't connect, add `\"--transport\", \"http-only\"` to `args`."))}</p>
        </div>
      )}
    </div>
  );
}

function McpTokensSection() {
  const { t, locale } = useLang();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [fresh, setFresh] = useState<string | null>(null); // plaintext token, shown once
  const list = useQuery({ queryKey: ["nexus", "mcp-tokens"], queryFn: nexusApi.mcpTokens, retry: false });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "mcp-tokens"] });
  const create = useMutation({
    mutationFn: () => nexusApi.createMcpToken({ name: name.trim() || undefined, expiresInDays }),
    onSuccess: (r) => { setFresh(r.token); setName(""); invalidate(); },
  });
  const revoke = useMutation({ mutationFn: (id: string) => nexusApi.revokeMcpToken(id), onSuccess: invalidate, onError: (e) => toastFailure(t("Couldn't revoke the token"), e) });
  const rows = list.data?.tokens ?? [];
  const connectCmd = fresh ? `claude mcp add --transport http nexus ${MCP_URL} --header "Authorization: Bearer ${fresh}"` : "";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10"><Sparkles className="h-5 w-5 text-primary" /></div>
          <div>
            <h2 className="font-semibold">{t("Connect Claude to NEXUS")}</h2>
            <p className="text-xs text-muted-foreground">{rich(t("Generate a personal token so Claude (Claude Code or the API) can read and manage **tasks** for you. The token acts as you, with the same access you already have. It **can't** touch XP, day off, attendance or any admin-only setting."))}</p>
          </div>
        </div>
      </div>

      <McpTutorial />

      {fresh && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 shadow-soft space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400"><Check className="h-4 w-4" /> {t("Token created")}</div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("Copy it now. For security it's shown only once and can't be shown again.")}
          </div>
          <CopyBox label={t("Your token")} value={fresh} />
          <CopyBox label={t("Run this in your terminal (Claude Code)")} value={connectCmd} />
          <button onClick={() => setFresh(null)} className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline">{t("I've copied it, hide it")}</button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-4">
        <h2 className="font-semibold">{t("Generate a token")}</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Label (e.g. My laptop)")} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <SelectPicker variant="field" value={String(expiresInDays)} onChange={(v) => setExpiresInDays(Number(v))} options={[30, 90, 180, 365].map((d) => ({ value: String(d), label: t("Expires in {n} days", { n: d }) }))} className="px-3 py-2 font-semibold" />
        </div>
        <button disabled={create.isPending} onClick={() => create.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} {t("Generate token")}
        </button>
        {create.isError && <span className="ml-2 text-xs font-semibold text-destructive">{t("Couldn't create the token.")} {failureText(create.error)}</span>}
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-3">
        <h2 className="font-semibold">{t("Your tokens")} {rows.length > 0 && <span className="text-xs font-normal text-muted-foreground">({rows.length}/10)</span>}</h2>
        {list.isLoading && <p className="text-sm text-muted-foreground">{t("Loading…")}</p>}
        {!list.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">{t("No tokens yet. Generate one above to connect Claude.")}</p>}
        <div className="space-y-2">
          {rows.map((tok) => {
            const expired = tok.expiresAt ? new Date(tok.expiresAt).getTime() < Date.now() : false;
            return (
              <div key={tok.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 truncate text-sm font-medium">
                    {tok.name}
                    {expired && <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive">{t("Expired")}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("Created {date}", { date: fmtDay(tok.createdAt, locale) })} · {tok.lastUsedAt ? t("last used {date}", { date: fmtDay(tok.lastUsedAt, locale) }) : t("never used")}{tok.expiresAt ? ` · ${t("expires {date}", { date: fmtDay(tok.expiresAt, locale) })}` : ""}
                  </div>
                </div>
                <button onClick={() => { if (confirm(t("Revoke “{name}”? Claude loses access right away.", { name: tok.name }))) revoke.mutate(tok.id); }} className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition hover:bg-destructive/10 hover:text-destructive active:scale-[0.97]">{t("Revoke")}</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Theme and interface language — both per browser (localStorage), like the toggles in the sidebar and
// the More sheet. Language names are shown in their own language, so each is findable whatever is on.
function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useLang();
  const themes: Array<{ id: Theme; label: string; icon: typeof Sun }> = [
    { id: "light", label: t("Light"), icon: Sun },
    { id: "dark", label: t("Dark"), icon: Moon },
  ];
  const langs: Array<{ id: Lang; label: string }> = [
    { id: "id", label: "Bahasa Indonesia" },
    { id: "en", label: "English" },
  ];
  const choice = (on: boolean) => cn(
    "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition",
    on ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent text-muted-foreground",
  );
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-soft space-y-6">
      <div>
        <h2 className="font-semibold">{t("Appearance")}</h2>
        <p className="text-xs text-muted-foreground">{t("How NEXUS looks on this device.")}</p>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">{t("Theme")}</div>
        <div className="flex gap-2">
          {themes.map((o) => (
            <button key={o.id} type="button" aria-pressed={theme === o.id} onClick={() => setTheme(o.id)} className={choice(theme === o.id)}>
              <o.icon className="h-4 w-4" /> {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium"><Languages className="h-4 w-4 text-muted-foreground" /> {t("Language")}</div>
        <div className="flex gap-2">
          {langs.map((o) => (
            <button key={o.id} type="button" aria-pressed={lang === o.id} lang={o.id} onClick={() => setLang(o.id)} className={choice(lang === o.id)}>
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("Not every screen is translated yet; those keep their current text.")}</p>
      </div>
    </div>
  );
}

function SecuritySection() {
  return (
    <div className="space-y-6">
      <PasswordSection />
      <PasskeysSection />
      <ActiveSessions />
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
