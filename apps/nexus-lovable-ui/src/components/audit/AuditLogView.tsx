import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Loader2, ScrollText, Search, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { ApiError, nexusApi, type NexusAuditLink, type NexusAuditLog } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

/**
 * The admin audit log: who did what, when, and — on click — exactly what changed.
 *
 * Rows come from GET /api/audit (limit/offset paging, `search` over entity name/action/type,
 * `action` as an exact match). The server may add a readable `summary` per row; older rows or an
 * older server fall back to "Action · entity". The drawer reads GET /api/audit/{id}, which turns the
 * raw metadata into a title, a list of field changes and linked details; the raw bits stay under
 * "Technical" for whoever needs them.
 */

const PAGE_SIZE = 50;
const JAKARTA = "Asia/Jakarta";

// Filter chips: the five verbs most of the log is written in. The server matches `action` exactly.
const ACTION_CHIPS = [
  { value: "", label: "All" },
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
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
  if (/delete|remove|revoke|reject|withdraw|cancel/.test(a)) return "delete";
  if (/create|add|grant|filed|approve|verif|present/.test(a)) return "create";
  if (/update|edit|status|set_|correction|override|reset|refund|clear/.test(a)) return "update";
  if (/login|logout|sign/.test(a)) return "login";
  if (/view|export|read/.test(a)) return "view";
  return "other";
}

function actionLabel(action?: string | null) {
  const a = (action || "").trim();
  if (!a) return "Event";
  const words = a.replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function entityLabel(type?: string | null) {
  return (type || "").replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** What the row says when the server sent no summary — the old "Action · entity" text. */
function fallbackSummary(l: Pick<NexusAuditLog, "action" | "entityType" | "entityName">) {
  const what = l.entityName || entityLabel(l.entityType) || "record";
  const kind = l.entityName && l.entityType ? ` · ${entityLabel(l.entityType)}` : "";
  return `${actionLabel(l.action)} ${what}${kind}`;
}

function relativeTime(iso?: string | null, now = Date.now()) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString("en-GB", { timeZone: JAKARTA, day: "numeric", month: "short", year: d > 300 ? "numeric" : undefined });
}

function fullTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { timeZone: JAKARTA, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " WIB";
}

/** "2026-09-24" on the Jakarta calendar — the key the day headers group by. */
function jakartaDayKey(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: JAKARTA });
}

function dayHeader(key: string) {
  if (!key) return "Unknown date";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: JAKARTA });
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: JAKARTA });
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const d = new Date(`${key}T12:00:00+07:00`);
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString("en-GB", { timeZone: JAKARTA, weekday: "long", day: "numeric", month: "long", year: sameYear ? undefined : "numeric" });
}

function ActionBadge({ action, className }: { action?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset", TONE_CLASS[actionTone(action)], className)}>
      {actionLabel(action)}
    </span>
  );
}

function Actor({ user, size = 20 }: { user?: { id?: string | null; name?: string | null; avatar?: string | null } | null; size?: number }) {
  if (!user?.id) {
    return <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground"><span className="grid shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold" style={{ width: size, height: size }}>⚙</span><span className="truncate">System</span></span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar userId={user.id} name={user.name} avatar={user.avatar} size={size} />
      <span className="truncate">{user.name || "Unknown user"}</span>
    </span>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(t); }, [value, ms]);
  return v;
}

export function AuditLogView() {
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
    <div className="space-y-4">
      {logs.isError && forbidden && (
        <EmptyState icon={ScrollText} title="Audit access required" tone="muted"
          message="The audit log is visible to BoD, managers and owners. Ask one of them if you need to know who changed something." />
      )}
      {logs.isError && !forbidden && (
        <EmptyState icon={ScrollText} title="Couldn't load the audit log" tone="muted"
          message={logs.error instanceof Error ? logs.error.message : "The server didn't answer."}
          action={<EmptyAction onClick={() => void logs.refetch()}>Try again</EmptyAction>} />
      )}
      {!logs.isError && (
        <>
          <div className="space-y-2">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search entity, action or type…" aria-label="Search the audit log"
                className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-9 text-sm outline-none focus:border-primary" />
              {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
            </div>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {ACTION_CHIPS.map((c) => {
                const on = action === c.value;
                return (
                  <button key={c.value || "all"} type="button" onClick={() => setAction(c.value)} aria-pressed={on}
                    className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-all active:scale-[0.97]",
                      on ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border hover:text-foreground")}>
                    {c.label}
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
                  title={filtered ? "No matching entries" : "No audit entries yet"}
                  message={filtered
                    ? "Search looks at the entity name, the action and the entity type. Try a shorter word or another action."
                    : "Creating, changing and deleting things in NEXUS is recorded here, with who did it and when."}
                  action={filtered ? <EmptyAction onClick={() => { setQ(""); setAction(""); }}>Clear filters</EmptyAction> : undefined} />
              </div>
            )}
            {groups.map((g) => (
              <div key={g.key || "unknown"}>
                <div className="sticky top-0 z-[1] border-b border-border bg-muted/60 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground backdrop-blur">
                  {dayHeader(g.key)}
                </div>
                <ul className="divide-y divide-border">
                  {g.rows.map((l) => (
                    <li key={l.id}>
                      <button type="button" onClick={() => setOpenId(l.id)}
                        className="flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none">
                        <ActionBadge action={l.action} className="mt-0.5 w-[4.75rem] justify-center truncate" />
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 break-words font-medium">{l.summary || fallbackSummary(l)}</div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                            <Actor user={l.user} size={18} />
                          </div>
                        </div>
                        <time dateTime={l.createdAt ?? undefined} title={fullTime(l.createdAt)} className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                          {relativeTime(l.createdAt)}
                        </time>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <span>{rows.length} of {total} entries</span>
                {logs.hasNextPage && (
                  <button type="button" onClick={() => void logs.fetchNextPage()} disabled={logs.isFetchingNextPage}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent disabled:opacity-50">
                    {logs.isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />} Load more
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

function AuditEntryDrawer({ id, row, onClose }: { id: string; row: NexusAuditLog | null; onClose: () => void }) {
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
  const title = d?.title || row?.summary || (row ? fallbackSummary(row) : "Audit entry");
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/30 backdrop-blur-[2px]" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Audit entry"
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
              <time dateTime={createdAt ?? undefined}>{fullTime(createdAt)}</time>
              {createdAt && <span> · {relativeTime(createdAt)}</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
          {detail.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading details…</div>}
          {detail.isError && (
            <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              The full breakdown isn't available for this entry{detail.error instanceof ApiError && detail.error.status === 404 ? "" : " right now"}. The raw record is under Technical.
            </p>
          )}

          {d && d.changes.length > 0 && (
            <section>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">What changed</h3>
              <ul className="space-y-2">
                {d.changes.map((c, i) => (
                  <li key={`${c.field}-${i}`} className="rounded-xl border border-border bg-background/60 px-3 py-2">
                    <div className="text-xs font-semibold text-muted-foreground">{c.label || c.field}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 break-words text-sm">
                      {c.from == null ? (
                        <span>Set to <span className="font-semibold text-emerald-700 dark:text-emerald-300">{c.to ?? "—"}</span></span>
                      ) : (
                        <>
                          <span className="text-rose-600 line-through decoration-rose-400/80 dark:text-rose-300">{c.from}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="changed to" />
                          {c.to == null
                            ? <span className="italic text-muted-foreground">Cleared</span>
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
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Details</h3>
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

          {d && d.changes.length === 0 && d.details.length === 0 && (
            <p className="text-sm text-muted-foreground">No field-level changes were recorded for this action.</p>
          )}

          <details className="group rounded-xl border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Technical <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <dl className="space-y-2 border-t border-border px-3 py-3 text-xs">
              <TechRow label="Entity">{[entityLabel(tech.entityType), tech.entityId].filter(Boolean).join(" · ") || "—"}</TechRow>
              <TechRow label="Entry id">{id}</TechRow>
              <TechRow label="IP address">{tech.ipAddress || "—"}</TechRow>
              <TechRow label="User agent">{tech.userAgent || "—"}</TechRow>
              <div>
                <dt className="font-semibold text-muted-foreground">Metadata</dt>
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
