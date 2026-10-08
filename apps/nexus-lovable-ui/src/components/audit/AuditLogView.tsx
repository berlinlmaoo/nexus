import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, Loader2, RotateCcw, ScrollText, Search, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import {
  ApiError, nexusApi,
  type NexusAuditEntryDetail, type NexusAuditLink, type NexusAuditLog, type NexusAuditRestoreResult,
} from "@/lib/nexus-api";
import { useDocumentLang, useLang, type LangApi } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * The admin audit log: who did what, when, and — on click — exactly what changed.
 *
 * Rows come from GET /api/audit (limit/offset paging, `search` over entity name/action/type,
 * `action` as an exact match). The server may add a readable `summary` per row; older rows or an
 * older server fall back to "Action · entity". The drawer reads GET /api/audit/{id}, which turns the
 * raw metadata into a title, a list of field changes and linked details; the raw bits stay under
 * "Technical" for whoever needs them.
 *
 * A deleted project or task carries `restore` (owner, 8 Oct 2026): the drawer offers to put it back
 * with POST /api/audit/{id}/restore. The server's summary sentences stay English; everything this
 * screen writes itself is EN/ID.
 */

const PAGE_SIZE = 50;
const JAKARTA = "Asia/Jakarta";

// Filter chips: the verbs most of the log is written in. The server matches `action` exactly.
const ACTION_CHIPS = [
  { value: "", label: "All" },
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
  { value: "restore", label: "Restore" },
  { value: "login", label: "Login" },
  { value: "view", label: "View" },
] as const;

type Tone = "create" | "update" | "delete" | "login" | "view" | "other";
const TONE_CLASS: Record<Tone, string> = {
  create: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  update: "bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300",
  delete: "bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300",
  login: "bg-muted text-muted-foreground ring-border",
  view: "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300",
  other: "bg-amber-500/12 text-amber-800 ring-amber-500/25 dark:text-amber-300",
};

/** The colour family of an action. The five core verbs map directly; the long tail of specific
 *  actions ("correction_approved", "revoke_all", …) is sorted by what it does. */
function actionTone(action?: string | null): Tone {
  const a = (action || "").toLowerCase();
  if (a === "create" || a === "update" || a === "delete" || a === "login" || a === "view") return a;
  if (a === "restore") return "create";
  if (/delete|remove|revoke|reject|withdraw|cancel/.test(a)) return "delete";
  if (/create|add|grant|filed|approve|verif|present/.test(a)) return "create";
  if (/update|edit|status|set_|correction|override|reset|refund|clear/.test(a)) return "update";
  if (/login|logout|sign/.test(a)) return "login";
  if (/view|export|read/.test(a)) return "view";
  return "other";
}

const CORE_VERBS: Record<string, string> = {
  create: "Create", update: "Update", delete: "Delete", restore: "Restore", login: "Login", view: "View",
};

function actionLabel(action: string | null | undefined, t: LangApi["t"]) {
  const a = (action || "").trim();
  if (!a) return t("Event");
  const core = CORE_VERBS[a.toLowerCase()];
  if (core) return t(core);
  const words = a.replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function entityLabel(type?: string | null) {
  return (type || "").replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** What the row says when the server sent no summary — the old "Action · entity" text. */
function fallbackSummary(l: Pick<NexusAuditLog, "action" | "entityType" | "entityName">, t: LangApi["t"]) {
  const what = l.entityName || entityLabel(l.entityType) || t("record");
  const kind = l.entityName && l.entityType ? ` · ${entityLabel(l.entityType)}` : "";
  return `${actionLabel(l.action, t)} ${what}${kind}`;
}

function relativeTime(iso: string | null | undefined, { t, locale }: LangApi, now = Date.now()) {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return t("just now");
  const m = Math.round(s / 60);
  if (m < 60) return t("{n}m ago", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("{n}h ago", { n: h });
  const d = Math.round(h / 24);
  if (d < 7) return t("{n}d ago", { n: d });
  return new Date(ms).toLocaleDateString(locale, { timeZone: JAKARTA, day: "numeric", month: "short", year: d > 300 ? "numeric" : undefined });
}

function fullTime(iso: string | null | undefined, locale: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { timeZone: JAKARTA, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " WIB";
}

/** "8 Oct, 02:16 WIB" — when a restorable copy is from. */
function shortTime(iso: string | null | undefined, locale: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { timeZone: JAKARTA, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + " WIB";
}

/** "2026-09-24" on the Jakarta calendar — the key the day headers group by. */
function jakartaDayKey(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: JAKARTA });
}

function dayHeader(key: string, { t, locale }: LangApi) {
  if (!key) return t("Unknown date");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: JAKARTA });
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: JAKARTA });
  if (key === today) return t("Today");
  if (key === yesterday) return t("Yesterday");
  const d = new Date(`${key}T12:00:00+07:00`);
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString(locale, { timeZone: JAKARTA, weekday: "long", day: "numeric", month: "long", year: sameYear ? undefined : "numeric" });
}

function ActionBadge({ action, className }: { action?: string | null; className?: string }) {
  const { t } = useLang();
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset", TONE_CLASS[actionTone(action)], className)}>
      {actionLabel(action, t)}
    </span>
  );
}

function Actor({ user, size = 20 }: { user?: { id?: string | null; name?: string | null; avatar?: string | null } | null; size?: number }) {
  const { t } = useLang();
  if (!user?.id) {
    return <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground"><span className="grid shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold" style={{ width: size, height: size }}>⚙</span><span className="truncate">{t("System")}</span></span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar userId={user.id} name={user.name} avatar={user.avatar} size={size} />
      <span className="truncate">{user.name || t("Unknown user")}</span>
    </span>
  );
}

/** On a delete row: whether it can still come back. Absent on deletes that kept no copy. */
function RestorePill({ row }: { row: NexusAuditLog }) {
  const { t } = useLang();
  if (row.action !== "delete" || !row.restore) return null;
  return row.restore.available ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold text-primary ring-1 ring-inset ring-primary/30">
      <RotateCcw className="h-2.5 w-2.5" aria-hidden /> {t("Restorable")}
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold text-muted-foreground ring-1 ring-inset ring-border">
      <Check className="h-2.5 w-2.5" aria-hidden /> {t("Restored")}
    </span>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const id = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(id); }, [value, ms]);
  return v;
}

export function AuditLogView() {
  const L = useLang();
  const { lang, t } = L;
  useDocumentLang(lang);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const search = useDebounced(q.trim(), 300);

  const logs = useInfiniteQuery({
    queryKey: ["nexus", "audit", search, action],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageParam) });
      if (search) p.set("search", search);
      if (action) p.set("action", action);
      return nexusApi.auditLogs(p.toString());
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, pg) => n + (pg.logs?.length ?? 0), 0);
      return (last.logs?.length ?? 0) > 0 && loaded < (last.total ?? 0) ? loaded : undefined;
    },
    retry: false,
  });

  const rows = useMemo(() => {
    // Offset paging over a live table can repeat a row when new entries land between pages.
    const seen = new Set<string>();
    const out: NexusAuditLog[] = [];
    for (const pg of logs.data?.pages ?? []) for (const l of pg.logs ?? []) if (!seen.has(l.id)) { seen.add(l.id); out.push(l); }
    return out;
  }, [logs.data]);
  const total = logs.data?.pages[0]?.total ?? 0;
  const groups = useMemo(() => {
    const out: { key: string; rows: NexusAuditLog[] }[] = [];
    for (const l of rows) {
      const k = jakartaDayKey(l.createdAt);
      const last = out[out.length - 1];
      if (last && last.key === k) last.rows.push(l); else out.push({ key: k, rows: [l] });
    }
    return out;
  }, [rows]);
  const openRow = rows.find((r) => r.id === openId) ?? null;
  const forbidden = logs.error instanceof ApiError && (logs.error.status === 401 || logs.error.status === 403);
  const filtered = Boolean(search || action);

  return (
    <div lang={lang} className="space-y-4">
      {logs.isError && forbidden && (
        <EmptyState icon={ScrollText} title={t("Audit access required")} tone="muted"
          message={t("The audit log is visible to BoD, managers and owners. Ask one of them if you need to know who changed something.")} />
      )}
      {logs.isError && !forbidden && (
        <EmptyState icon={ScrollText} title={t("Couldn't load the audit log")} tone="muted"
          message={logs.error instanceof Error ? logs.error.message : t("The server didn't answer.")}
          action={<EmptyAction onClick={() => void logs.refetch()}>{t("Try again")}</EmptyAction>} />
      )}
      {!logs.isError && (
        <>
          <div className="space-y-2">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search entity, action or type…")} aria-label={t("Search the audit log")}
                className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-9 text-sm outline-none focus:border-primary" />
              {q && <button type="button" onClick={() => setQ("")} aria-label={t("Clear search")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
            </div>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {ACTION_CHIPS.map((c) => {
                const on = action === c.value;
                return (
                  <button key={c.value || "all"} type="button" onClick={() => setAction(c.value)} aria-pressed={on}
                    className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-all active:scale-[0.97]",
                      on ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border hover:text-foreground")}>
                    {t(c.label)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            {logs.isLoading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            {!logs.isLoading && rows.length === 0 && (
              <div className="p-4">
                <EmptyState icon={ScrollText} compact tone="muted"
                  title={filtered ? t("No matching entries") : t("No audit entries yet")}
                  message={filtered
                    ? t("Search looks at the entity name, the action and the entity type. Try a shorter word or another action.")
                    : t("Creating, changing and deleting things in NEXUS is recorded here, with who did it and when.")}
                  action={filtered ? <EmptyAction onClick={() => { setQ(""); setAction(""); }}>{t("Clear filters")}</EmptyAction> : undefined} />
              </div>
            )}
            {groups.map((g) => (
              <div key={g.key || "unknown"}>
                <div className="sticky top-0 z-[1] border-b border-border bg-muted/60 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground backdrop-blur">
                  {dayHeader(g.key, L)}
                </div>
                <ul className="divide-y divide-border">
                  {g.rows.map((l) => (
                    <li key={l.id}>
                      <button type="button" onClick={() => setOpenId(l.id)}
                        className="flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none">
                        <ActionBadge action={l.action} className="mt-0.5 w-[4.75rem] justify-center truncate" />
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 break-words font-medium">{l.summary || fallbackSummary(l, t)}</div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                            <Actor user={l.user} size={18} />
                            <RestorePill row={l} />
                          </div>
                        </div>
                        <time dateTime={l.createdAt ?? undefined} title={fullTime(l.createdAt, L.locale)} className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                          {relativeTime(l.createdAt, L)}
                        </time>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <span>{t("{shown} of {total} entries", { shown: rows.length, total })}</span>
                {logs.hasNextPage && (
                  <button type="button" onClick={() => void logs.fetchNextPage()} disabled={logs.isFetchingNextPage}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent disabled:opacity-50">
                    {logs.isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />} {t("Load more")}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
      {openId && <AuditEntryDrawer id={openId} row={openRow} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function DetailLink({ link, children }: { link: NexusAuditLink; children: ReactNode }) {
  const cls = "font-semibold text-primary underline-offset-2 hover:underline";
  switch (link.type) {
    case "task": return <Link to="/tasks/$taskId" params={{ taskId: link.id }} className={cls}>{children}</Link>;
    case "project": return <Link to="/projects/$projectId" params={{ projectId: link.id }} className={cls}>{children}</Link>;
    case "user": return <Link to="/reports/$userId" params={{ userId: link.id }} className={cls}>{children}</Link>;
    case "attendance": return <Link to="/attendance" search={{ request: link.id }} className={cls}>{children}</Link>;
    case "form": return <Link to="/f/$formId" params={{ formId: link.id }} className={cls}>{children}</Link>;
    default: return <>{children}</>;
  }
}

const RESTORE_FAILURE: Record<string, string> = {
  ALREADY_RESTORED: "Someone has restored this already.",
  ALREADY_EXISTS: "It's already back.",
  PARENT_MISSING: "Its project was deleted too. Restore the project first, then this task.",
  NOT_RESTORABLE: "No copy of this delete was kept, so it can't be restored.",
};

/** "226 tasks, 7 lists, 155 files and 5 comments" — only what there is. */
function whatComesBack(r: NonNullable<NexusAuditEntryDetail["restore"]>, entityType: string, { tn, lang }: LangApi) {
  const c = r.counts;
  const parts = [
    c.tasks ? (entityType === "task" ? tn(c.tasks, "{n} subtask", "{n} subtasks") : tn(c.tasks, "{n} task", "{n} tasks")) : "",
    c.lists ? tn(c.lists, "{n} list", "{n} lists") : "",
    c.files ? tn(c.files, "{n} file", "{n} files") : "",
    c.comments ? tn(c.comments, "{n} comment", "{n} comments") : "",
    c.sheets ? tn(c.sheets, "{n} sheet", "{n} sheets") : "",
    c.members ? tn(c.members, "{n} member", "{n} members") : "",
  ].filter(Boolean);
  if (parts.length < 2) return parts.join("");
  return new Intl.ListFormat(lang === "id" ? "id" : "en", { style: "long", type: "conjunction" }).format(parts);
}

/** The Restore block of a deleted project or task: what comes back, then one confirmed tap. */
function RestoreSection({ entryId, entityType, entityId, entityName, restore }: {
  entryId: string; entityType: string; entityId: string | null; entityName: string | null;
  restore: NonNullable<NexusAuditEntryDetail["restore"]>;
}) {
  const L = useLang();
  const { t } = L;
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<NexusAuditRestoreResult | null>(null);
  const run = useMutation({
    mutationFn: () => nexusApi.auditRestore(entryId),
    onSuccess: (result) => {
      setDone(result);
      setConfirming(false);
      // The project, its tasks, folders and chat room are back everywhere: refresh what's on screen.
      void qc.invalidateQueries({ queryKey: ["nexus"] });
    },
    onError: () => {
      setConfirming(false);
      // Someone else may have restored it meanwhile: show the entry as it is now.
      void qc.invalidateQueries({ queryKey: ["nexus", "audit-entry", entryId] });
    },
  });
  const isProject = entityType === "project";
  const what = whatComesBack(restore, entityType, L);
  const when = shortTime(restore.dataAsOf, L.locale);
  const openLink = (id: string | null, children: ReactNode) => id
    ? (isProject
      ? <Link to="/projects/$projectId" params={{ projectId: id }} className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline">{children}<ArrowRight className="h-3.5 w-3.5" /></Link>
      : <Link to="/tasks/$taskId" params={{ taskId: id }} className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline">{children}<ArrowRight className="h-3.5 w-3.5" /></Link>)
    : null;

  if (done || !restore.available) {
    const by = restore.restoredBy?.name;
    return (
      <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-3 text-sm">
        <div className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">
              {done ? t("Restored. It's back where it was.")
                : by ? t("Restored by {name} · {when}", { name: by, when: shortTime(restore.restoredAt, L.locale) })
                : t("Restored · {when}", { when: shortTime(restore.restoredAt, L.locale) })}
            </p>
            {openLink(done?.entityId ?? entityId, t(isProject ? "Open project" : "Open task"))}
          </div>
        </div>
      </section>
    );
  }

  const failure = run.error instanceof ApiError
    ? t(RESTORE_FAILURE[String((run.error.payload as { code?: string } | null)?.code ?? "")] ?? "Couldn't restore it. Try again in a moment.")
    : run.isError ? t("Couldn't restore it. Try again in a moment.") : null;
  const explanation = restore.fromBackup
    ? (what
      ? t("It comes back as it was in the backup of {when}: {what}. Changes made after that backup are not in it.", { when, what })
      : t("It comes back as it was in the backup of {when}. Changes made after that backup are not in it.", { when }))
    : (what ? t("It comes back as it was when it was deleted: {what}.", { what }) : t("It comes back as it was when it was deleted."));

  return (
    <section className="rounded-xl border border-primary/25 bg-primary/[0.04] px-3 py-3">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("Bring it back")}</h3>
      <p className="mt-1.5 text-sm">{explanation}</p>
      {isProject && <p className="mt-1 text-xs text-muted-foreground">{t("Its folder comes back too if it was deleted.")}</p>}
      {failure && <p role="alert" className="mt-2 text-sm font-medium text-rose-600 dark:text-rose-300">{failure}</p>}
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} disabled={run.isPending}
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60">
          <RotateCcw className="h-4 w-4" aria-hidden /> {t(isProject ? "Restore project" : "Restore task")}
        </button>
      ) : (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-card px-3 py-2.5">
          <p className="text-sm font-semibold">{t("Restore “{name}”?", { name: entityName || entityLabel(entityType) })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => run.mutate()} disabled={run.isPending} autoFocus
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60">
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
              {run.isPending ? t("Restoring…") : t("Yes, restore")}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={run.isPending}
              className="inline-flex min-h-10 items-center rounded-lg border border-border px-3.5 text-sm font-semibold transition hover:bg-accent disabled:opacity-60">
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function AuditEntryDrawer({ id, row, onClose }: { id: string; row: NexusAuditLog | null; onClose: () => void }) {
  const L = useLang();
  const { lang, t } = L;
  const detail = useQuery({ queryKey: ["nexus", "audit-entry", id], queryFn: () => nexusApi.auditEntry(id), retry: false, staleTime: 60_000 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = detail.data;
  const entry = d?.entry;
  // Until (or unless) the detail arrives, draw from the row we already have.
  const action = entry?.action ?? row?.action ?? null;
  const createdAt = entry?.createdAt ?? row?.createdAt ?? null;
  const user = entry ? entry.user : row?.user ?? null;
  const title = d?.title || row?.summary || (row ? fallbackSummary(row, t) : t("Audit entry"));
  const tech = {
    userAgent: entry ? entry.userAgent : row?.userAgent ?? null,
    ipAddress: entry ? entry.ipAddress : row?.ipAddress ?? null,
    entityType: entry?.entityType ?? row?.entityType ?? null,
    entityId: entry ? entry.entityId : row?.entityId ?? null,
    metadata: entry ? entry.metadata : row?.metadata,
  };
  const metadataJson = (() => {
    if (tech.metadata == null) return null;
    try { return JSON.stringify(tech.metadata, null, 2); } catch { return String(tech.metadata); }
  })();
  const deletable = action === "delete" && (tech.entityType === "project" || tech.entityType === "task");

  return (
    <div lang={lang} className="fixed inset-0 z-50 flex justify-end bg-foreground/30 backdrop-blur-[2px]" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label={t("Audit entry")}
        className="flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <ActionBadge action={action} />
            <h2 className="mt-2 break-words font-display text-lg font-bold leading-snug tracking-tight">{title}</h2>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="min-w-0 max-w-full text-foreground"><Actor user={user} size={20} /></span>
              {entry?.user?.email && <span className="truncate">{entry.user.email}</span>}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              <time dateTime={createdAt ?? undefined}>{fullTime(createdAt, L.locale)}</time>
              {createdAt && <span> · {relativeTime(createdAt, L)}</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
          {detail.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading details…")}</div>}
          {detail.isError && (
            <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {detail.error instanceof ApiError && detail.error.status === 404
                ? t("The full breakdown isn't available for this entry. The raw record is under Technical.")
                : t("The full breakdown isn't available for this entry right now. The raw record is under Technical.")}
            </p>
          )}

          {d?.restore && entry && (
            <RestoreSection entryId={id} entityType={entry.entityType} entityId={entry.entityId} entityName={entry.entityName} restore={d.restore} />
          )}
          {d && !d.restore && deletable && (
            <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {t("This was deleted before NEXUS started keeping deleted projects and tasks, so it can't be restored.")}
            </p>
          )}

          {d && d.changes.length > 0 && (
            <section>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("What changed")}</h3>
              <ul className="space-y-2">
                {d.changes.map((c, i) => (
                  <li key={`${c.field}-${i}`} className="rounded-xl border border-border bg-background/60 px-3 py-2">
                    <div className="text-xs font-semibold text-muted-foreground">{c.label || c.field}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 break-words text-sm">
                      {c.from == null ? (
                        <span>{t("Set to")} <span className="font-semibold text-emerald-700 dark:text-emerald-300">{c.to ?? "—"}</span></span>
                      ) : (
                        <>
                          <span className="text-rose-600 line-through decoration-rose-400/80 dark:text-rose-300">{c.from}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={t("changed to")} />
                          {c.to == null
                            ? <span className="italic text-muted-foreground">{t("Cleared")}</span>
                            : <span className="font-semibold text-emerald-700 dark:text-emerald-300">{c.to}</span>}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {d && d.details.length > 0 && (
            <section>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("Details")}</h3>
              <dl className="divide-y divide-border rounded-xl border border-border">
                {d.details.map((x, i) => (
                  <div key={`${x.label}-${i}`} className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:gap-3">
                    <dt className="shrink-0 text-xs font-semibold text-muted-foreground sm:w-28 sm:pt-0.5">{x.label}</dt>
                    <dd className="min-w-0 flex-1 break-words">{x.link ? <DetailLink link={x.link}>{x.value}</DetailLink> : x.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {d && d.changes.length === 0 && d.details.length === 0 && !d.restore && (
            <p className="text-sm text-muted-foreground">{t("No field-level changes were recorded for this action.")}</p>
          )}

          <details className="group rounded-xl border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("Technical")} <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <dl className="space-y-2 border-t border-border px-3 py-3 text-xs">
              <TechRow label={t("Entity")}>{[entityLabel(tech.entityType), tech.entityId].filter(Boolean).join(" · ") || "—"}</TechRow>
              <TechRow label={t("Entry id")}>{id}</TechRow>
              <TechRow label={t("IP address")}>{tech.ipAddress || "—"}</TechRow>
              <TechRow label={t("User agent")}>{tech.userAgent || "—"}</TechRow>
              <div>
                <dt className="font-semibold text-muted-foreground">{t("Metadata")}</dt>
                <dd className="mt-1">
                  {metadataJson
                    ? <pre className="max-h-72 overflow-auto rounded-lg bg-muted/60 p-2 font-mono text-[11px] leading-relaxed">{metadataJson}</pre>
                    : <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
            </dl>
          </details>
        </div>
      </aside>
    </div>
  );
}

function TechRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-[11px]">{children}</dd>
    </div>
  );
}
