import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, ImagePlus, Loader2, Mail, Trash2, UserPlus, X } from "lucide-react";
import { nexusApi, statusLabel, type NexusProject, type NexusUser } from "@/lib/nexus-api";
import { ProjectCustomFieldsManager } from "@/components/projects/ProjectCustomFieldsManager";
import { cn } from "@/lib/utils";

// Shared layout id so the modal morphs out of the "Tune" button (same as board task cards).
export const TUNE_MORPH_ID = "project-tune-card";

const STATUSES = ["ACTIVE", "ARCHIVED", "COMPLETED"];
const COLORS = ["#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#64748b"];

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function MiniAvatar({ user, size = 26 }: { user?: NexusUser | null; size?: number }) {
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary ring-1 ring-border" style={{ width: size, height: size, fontSize: size * 0.36 }} title={user?.name ?? ""}>
      {initialsOf(user?.name)}
    </span>
  );
}

function toMembers(data: { members?: NexusUser[] } | NexusUser[] | undefined): NexusUser[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.members ?? [];
}

/** Pill switch matching the core-NEXUS "Customize Project" toggles. */
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}

export function ProjectSettingsDrawer({ project, onClose, onDeleted }: { project: NexusProject; onClose: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const morph = !reduce;
  const [open, setOpen] = useState(true);
  const requestClose = () => setOpen(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []);
  const [name, setName] = useState(project.name ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [icon, setIcon] = useState(project.icon ?? "🚀");
  const [color, setColor] = useState(project.color ?? COLORS[0]);
  const [status, setStatus] = useState(project.status ?? "ACTIVE");
  const [inviteEmail, setInviteEmail] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  // Customize-project settings (shared columns with core NEXUS).
  const [enableBatch, setEnableBatch] = useState(!!project.enableTaskBatchDuplicate);
  const [autoAssignEnabled, setAutoAssignEnabled] = useState(!!project.autoAssignEnabled);
  const [autoAssignIds, setAutoAssignIds] = useState<string[]>(project.autoAssignAssigneeIds ?? []);
  const [autoAssignError, setAutoAssignError] = useState<string | null>(null);
  const [enablePnl, setEnablePnl] = useState(!!project.enablePnlDashboard);
  const [reqAttach, setReqAttach] = useState(!!project.requireAttachmentForDone);
  const [noStatus, setNoStatus] = useState(!!project.disableTaskStatus);
  // P&L toggle is BoD-and-above only (financial data) — hidden from managers/staff entirely.
  // Role is checked against THIS project's workspace, not the user's first workspace.
  const wsm = useQuery({
    queryKey: ["nexus", "workspace-members", project.workspaceId ?? ""],
    queryFn: () => nexusApi.workspaceMembers(project.workspaceId ?? undefined),
    retry: false,
    staleTime: 60_000,
  });
  const isBod = wsm.data?.role === "BOD" || wsm.data?.role === "ONE_ABOVE_ALL";

  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => nexusApi.members(), enabled: showPicker, staleTime: 300_000 });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "project", project.id] });

  const save = useMutation({
    mutationFn: () => nexusApi.updateProject(project.id, { name: name.trim(), description: description || null, icon, color, status }),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("projects") }); },
  });
  const addMember = useMutation({
    mutationFn: (userId: string) => nexusApi.addProjectMember(project.id, userId),
    onSuccess: () => { setShowPicker(false); invalidate(); },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => nexusApi.removeProjectMember(project.id, userId),
    onSuccess: invalidate,
  });
  const invite = useMutation({
    mutationFn: () => nexusApi.inviteToProject(project.id, inviteEmail.trim()),
    onSuccess: () => { setInviteMsg(`Invite sent to ${inviteEmail.trim()}`); setInviteEmail(""); },
    onError: () => setInviteMsg("Invite failed — check the email / access."),
  });
  const duplicate = useMutation({
    mutationFn: () => nexusApi.duplicateProject(project.id),
    onSuccess: () => { qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("projects") }); requestClose(); },
  });
  const del = useMutation({
    mutationFn: () => nexusApi.deleteProject(project.id),
    onSuccess: () => { qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("projects") }); onDeleted(); },
  });
  // One mutation for all "Customize project" toggles; mirrors core-NEXUS optimistic + revert.
  const settings = useMutation({
    mutationFn: (payload: Parameters<typeof nexusApi.updateProject>[1]) => nexusApi.updateProject(project.id, payload),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("projects") }); },
  });
  const iconFileRef = useRef<HTMLInputElement>(null);
  const uploadIcon = useMutation({
    mutationFn: (file: File) => nexusApi.uploadProjectIcon(project.id, file),
    onSuccess: (r) => { setIcon(r.url); settings.mutate({ icon: r.url }); },
  });
  const onPickIcon = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) uploadIcon.mutate(f); e.target.value = ""; };
  const iconIsImage = /^(\/|https?:)/.test(icon);
  const toggleBatch = (checked: boolean) => { setEnableBatch(checked); settings.mutate({ enableTaskBatchDuplicate: checked }); };
  const togglePnl = (checked: boolean) => {
    setEnablePnl(checked);
    settings.mutate({ enablePnlDashboard: checked }, { onError: () => setEnablePnl(!checked) });
  };
  const toggleReqAttach = (checked: boolean) => {
    setReqAttach(checked);
    settings.mutate({ requireAttachmentForDone: checked }, { onError: () => setReqAttach(!checked) });
  };
  const toggleNoStatus = (checked: boolean) => {
    setNoStatus(checked);
    settings.mutate({ disableTaskStatus: checked }, { onError: () => setNoStatus(!checked) });
  };
  const toggleAutoAssign = (checked: boolean) => {
    if (checked && autoAssignIds.length === 0) { setAutoAssignError("Pick at least one member before turning on auto assign."); return; }
    setAutoAssignError(null);
    setAutoAssignEnabled(checked);
    settings.mutate({ autoAssignEnabled: checked });
  };
  const toggleAutoAssignMember = (memberId: string, checked: boolean) => {
    const next = Array.from(new Set(checked ? [...autoAssignIds, memberId] : autoAssignIds.filter((id) => id !== memberId)));
    const nextEnabled = next.length > 0;
    setAutoAssignError(null);
    setAutoAssignIds(next);
    setAutoAssignEnabled(nextEnabled);
    settings.mutate({ autoAssignEnabled: nextEnabled, autoAssignAssigneeIds: next });
  };

  const [bundleId, setBundleId] = useState("");
  const bundles = useQuery({ queryKey: ["workflow-bundles"], queryFn: () => nexusApi.workflowBundles(), retry: false });
  const applyBundle = useMutation({ mutationFn: () => nexusApi.applyWorkflowBundle(project.id, bundleId), onSuccess: invalidate });

  const currentMembers = project.members ?? [];
  const memberIds = useMemo(() => new Set(currentMembers.map((m) => m.userId || m.user?.id).filter(Boolean) as string[]), [currentMembers]);
  const assignable = useMemo(() => toMembers(membersQuery.data).filter((m) => !memberIds.has(m.id)), [membersQuery.data, memberIds]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence onExitComplete={onClose}>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-0 sm:p-4">
          <motion.div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={requestClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            layoutId={morph ? TUNE_MORPH_ID : undefined}
            style={{ transformOrigin: "center", ...(morph ? { borderRadius: 24 } : null) }}
            initial={morph ? undefined : { opacity: 0 }}
            animate={morph ? undefined : { opacity: 1 }}
            exit={morph ? undefined : { opacity: 0 }}
            transition={reduce ? { duration: 0.18 } : { type: "spring", stiffness: 480, damping: 38, mass: 0.7 }}
            className="relative z-10 flex h-[100dvh] max-h-[100dvh] w-full max-w-md flex-col overflow-hidden border-border bg-card shadow-pop sm:h-auto sm:max-h-[92dvh] sm:rounded-3xl sm:border"
          >
            <motion.div initial={morph ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ delay: morph ? 0.05 : 0, duration: 0.16 }} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
          <h2 className="font-display text-lg font-bold tracking-tight">Project settings</h2>
          <button onClick={requestClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex flex-1 flex-col gap-6 p-5">
          {/* identity */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                {iconIsImage ? (
                  <img src={icon} alt="" className="h-12 w-12 rounded-2xl border border-border object-cover" />
                ) : (
                  <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={2} className="h-12 w-12 rounded-2xl border border-border bg-background text-center text-2xl outline-none focus:border-primary" />
                )}
                {uploadIcon.isPending && <div className="absolute inset-0 grid place-items-center rounded-2xl bg-background/60"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>}
              </div>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => iconFileRef.current?.click()} disabled={uploadIcon.isPending} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50"><ImagePlus className="h-3.5 w-3.5" />Upload icon image</button>
              {iconIsImage && <button onClick={() => { setIcon("🚀"); settings.mutate({ icon: "🚀" }); }} disabled={uploadIcon.isPending} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Use an emoji again</button>}
              <span className="text-[11px] text-muted-foreground">PNG/JPG/SVG/WEBP, max 5MB</span>
              <input ref={iconFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={onPickIcon} />
            </div>
            {uploadIcon.isError && <p className="text-xs font-semibold text-destructive">{(uploadIcon.error as Error)?.message ?? "Icon upload failed."}</p>}
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Description…" className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Color</span>
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} className={cn("h-6 w-6 rounded-full ring-2 transition", color === c ? "ring-foreground" : "ring-transparent")} style={{ background: c }} />
              ))}
            </div>
            <label className="block space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary">
                {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </label>
            <button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
            </button>
            {save.isError && <p className="text-xs font-semibold text-destructive">Couldn't save.</p>}
          </div>

          {/* customize project — task duplicate mode + auto assign (parity with core NEXUS) */}
          <div className="space-y-4 border-t border-border pt-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Customize project</span>

            {/* task duplicate mode */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">Task duplicate mode</div>
                <p className="mt-0.5 text-xs text-muted-foreground">Turn on multi-select duplicate with a due-date popup for setting up recurring tasks (e.g. PATS Socials).</p>
              </div>
              <Toggle checked={enableBatch} onChange={toggleBatch} disabled={settings.isPending} />
            </div>

            {/* P&L dashboard — BoD-and-above only */}
            {isBod && (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">P&L Dashboard</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">Standalone finance view: log daily expenses (+receipts), incoming-money pipeline (deposits/installments), monthly budget. Only visible to BoD and above.</p>
                </div>
                <Toggle checked={enablePnl} onChange={togglePnl} disabled={settings.isPending} />
              </div>
            )}

            {/* Require ≥1 attachment before a task can be marked Done — finance proof-of-completion */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">Wajib Bukti Pencairan sebelum Done</div>
                <p className="mt-0.5 text-xs text-muted-foreground">Task di project ini nggak bisa dipindah ke <b>Done</b> sebelum ada minimal 1 <b>Bukti Pencairan</b> — slot terpisah dari Attachments biasa (dokumen pengajuan dari form nggak ke-hitung). Cocok buat pengajuan finance.</p>
              </div>
              <Toggle checked={reqAttach} onChange={toggleReqAttach} disabled={settings.isPending} />
            </div>

            {/* Calendar-only project (Master Calendar): status/done is noise, so hide it */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">Mode kalender (matikan status)</div>
                <p className="mt-0.5 text-xs text-muted-foreground">Buat project yang isinya cuma jadwal, bukan task — misal <b>Master Calendar</b>. Kalau nyala, <b>checkbox Done</b>, <b>pilihan status</b>, dan kolom <b>Status</b> di Table view disembunyiin. Datanya nggak dihapus, tinggal matiin lagi kalau mau balik.</p>
              </div>
              <Toggle checked={noStatus} onChange={toggleNoStatus} disabled={settings.isPending} />
            </div>

            {/* auto assign */}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Auto assign</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">Automatically assign the selected members to new tasks in this project. If you pick an assignee manually while creating a task, auto assign is skipped.</p>
                </div>
                <Toggle checked={autoAssignEnabled} onChange={toggleAutoAssign} disabled={settings.isPending} />
              </div>
              {autoAssignError && <p className="text-xs font-semibold text-destructive">{autoAssignError}</p>}

              <div className="rounded-2xl border border-border bg-muted/30 p-2">
                <div className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Default assignees · {autoAssignIds.length}</div>
                {currentMembers.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground">No members in this project yet — add some below first.</p>}
                <div className="space-y-1">
                  {currentMembers.map((m) => {
                    const id = (m.userId || m.user?.id) ?? "";
                    const checked = autoAssignIds.includes(id);
                    return (
                      <button key={id} type="button" onClick={() => id && toggleAutoAssignMember(id, !checked)} className={cn("flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors", checked ? "bg-primary/10" : "hover:bg-accent")}>
                        {checked ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />}
                        <MiniAvatar user={m.user} size={22} />
                        <span className="flex-1 truncate text-sm font-medium">{m.user?.name ?? m.user?.email ?? id}</span>
                        {m.role && <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{m.role}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* workflow bundle */}
          <div className="space-y-2 border-t border-border pt-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Apply workflow bundle</span>
            <p className="text-xs text-muted-foreground">Spin saved lists & automations into this project.</p>
            <div className="flex gap-2">
              <select value={bundleId} onChange={(e) => setBundleId(e.target.value)} className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="">{(bundles.data?.bundles?.length ?? 0) === 0 ? "No bundles available" : "Pick a bundle…"}</option>
                {(bundles.data?.bundles ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button disabled={!bundleId || applyBundle.isPending} onClick={() => applyBundle.mutate()} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">{applyBundle.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Apply</button>
            </div>
            {applyBundle.isSuccess && <p className="text-xs font-semibold text-success">Bundle applied ✓</p>}
            {applyBundle.isError && <p className="text-xs font-semibold text-destructive">Apply failed — check your access / bundle.</p>}
          </div>

          {/* custom fields */}
          <ProjectCustomFieldsManager projectId={project.id} />

          {/* members */}
          <div className="space-y-2 border-t border-border pt-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Members · {currentMembers.length}</span>
            <div className="space-y-1.5">
              {currentMembers.map((m) => (
                <div key={m.userId || m.user?.id} className="flex items-center gap-2 rounded-xl bg-muted/50 px-2 py-1.5">
                  <MiniAvatar user={m.user} />
                  <span className="flex-1 truncate text-sm font-semibold">{m.user?.name ?? m.user?.email ?? m.userId}</span>
                  <button onClick={() => { const id = m.userId || m.user?.id; if (id) removeMember.mutate(id); }} className="rounded p-1 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="relative">
              <button onClick={() => setShowPicker((v) => !v)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary active:scale-[0.98]"><UserPlus className="h-3.5 w-3.5" /> Add member</button>
              {showPicker && (
                <div className="absolute z-20 mt-1 max-h-56 w-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-pop">
                  {membersQuery.isLoading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>}
                  {!membersQuery.isLoading && assignable.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No more members</div>}
                  {assignable.map((m) => (
                    <button key={m.id} onClick={() => addMember.mutate(m.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"><MiniAvatar user={m} size={22} /><span className="truncate">{m.name ?? m.email}</span></button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* invite by email */}
          <div className="space-y-2 border-t border-border pt-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Invite by email</span>
            <div className="flex items-center gap-2">
              <input value={inviteEmail} onChange={(e) => { setInviteEmail(e.target.value); setInviteMsg(null); }} type="email" placeholder="teammate@company.com" className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
              <button disabled={!inviteEmail.includes("@") || invite.isPending} onClick={() => invite.mutate()} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-accent active:scale-[0.98] disabled:opacity-50">
                {invite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Invite
              </button>
            </div>
            {inviteMsg && <p className="text-xs font-semibold text-muted-foreground">{inviteMsg}</p>}
          </div>

          {/* danger zone */}
          <div className="mt-auto space-y-2 border-t border-border pt-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Danger zone</span>
            <div className="flex gap-2">
              {/* BoD+ only — duplicating clones every task, assignee and member at once. The server
                  enforces the same gate; this just keeps the button out of everyone else's way. */}
              {isBod && (
                <button onClick={() => duplicate.mutate()} disabled={duplicate.isPending} className="flex-1 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition-colors hover:bg-accent active:scale-[0.98] disabled:opacity-50">
                  {duplicate.isPending ? "Duplicating…" : "Duplicate"}
                </button>
              )}
              <button onClick={() => { if (confirm(`Delete project "${project.name}"? This cannot be undone.`)) del.mutate(); }} disabled={del.isPending} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20 active:scale-[0.98] disabled:opacity-50">
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
          </div>
        </div>
            </motion.div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
