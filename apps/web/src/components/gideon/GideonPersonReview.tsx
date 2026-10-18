import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Eye, Loader2, MessageCircle, Search, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { DateField } from "@/components/DateField";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/lib/lang";
import { formatCount } from "@/lib/number-format";
import { ORG_ROLE_LABEL, ORG_ROLE_TONE } from "@/lib/nexus-api";
import { chatTitleText } from "@/lib/gideon-chat-title";
import { CREDIT_TIER_NAME, fetchCreditAdmin } from "@/lib/gideon-credits";
import {
  fetchGideonPersonOverview, fetchGideonReviewChats, fetchGideonReviewTranscript,
  type GideonReviewMessage,
} from "@/lib/gideon-ai";
import { cn } from "@/lib/utils";
import { GideonMark } from "./GideonMark";
import { AssistantTurn, UserTurn, fromHistory } from "./GideonPanel";
import { PersonCreditsForm } from "./GideonCreditsAdmin";

/**
 * Control Room › GIDEON › People › person (owner, 18 Oct 2026).
 *
 *   Overview  questions, tool calls, chats, credits this period, most-used tier          BoD + One Above All
 *   Chats     every GIDEON chat of the person (deleted ones marked), read-only transcript  One Above All ONLY
 *   Credits   this period's credits by tier + their limits and bonus (GideonCreditsAdmin)   BoD + One Above All
 *
 * The Chats tab is only drawn for the One Above All, and the server refuses everyone else (403 OAA_ONLY) —
 * the UI is not the guard. Owner's decisions: no notification to the person, no audit entry, no reason prompt;
 * the person was told once in the GIDEON panel that chats can be reviewed.
 */

type Tab = "overview" | "chats" | "credits";
const tierName = (id: string | null | undefined) => (id ? `GIDEON ${CREDIT_TIER_NAME[id] ?? id}` : null);

export function GideonPersonReview({ userId, onClose }: { userId: string; onClose: () => void }) {
  const L = useLang();
  const { t } = L;
  const [tab, setTab] = useState<Tab>("overview");
  const q = useQuery({ queryKey: ["gideon-person", userId], queryFn: () => fetchGideonPersonOverview(userId), retry: false });
  const d = q.data;
  const canChats = d?.viewer.canReadChats === true;
  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: t("Overview") },
    ...(canChats ? [{ key: "chats" as const, label: t("Chats") }] : []),
    { key: "credits", label: t("Credits") },
  ];
  const tabBtn = (on: boolean) => cn(
    "relative -mb-px h-9 border-b-2 px-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    on ? "border-sidebar-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
  );

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        lang={L.lang}
        // Centred like every NEXUS detail (owner, 16 Oct); a full-screen sheet on a phone.
        className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[86vh] sm:max-h-[86vh] sm:w-[calc(100vw-3rem)] sm:max-w-5xl sm:rounded-2xl [&>button.absolute]:hidden"
      >
        <header className="flex items-start gap-3 border-b border-border px-4 pb-0 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-3">
              {d ? <Avatar userId={d.person.id} name={d.person.name} avatar={d.person.avatar} size={36} /> : <span className="h-9 w-9 shrink-0 rounded-full bg-muted" />}
              <div className="min-w-0">
                <DialogTitle className="truncate font-display text-lg font-bold tracking-tight">{d?.person.name ?? t("Loading…")}</DialogTitle>
                <DialogDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  {d?.person.role && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", ORG_ROLE_TONE[d.person.role])}>{t(ORG_ROLE_LABEL[d.person.role] ?? d.person.role)}</span>}
                  {d?.person.offboarded && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{t("Offboarded")}</span>}
                  {d?.person.email && <span className="truncate">{d.person.email}</span>}
                </DialogDescription>
              </div>
            </div>
            <nav role="tablist" aria-label={t("GIDEON for this person")} className="mt-3 flex gap-5">
              {tabs.map((x) => (
                <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} className={tabBtn(tab === x.key)} onClick={() => setTab(x.key)}>{x.label}</button>
              ))}
            </nav>
          </div>
          <button type="button" onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {q.isLoading ? (
            <div className="grid flex-1 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : q.isError || !d ? (
            <div className="p-6"><LoadError compact error={q.error} what={t("this person's GIDEON use")} onRetry={() => void q.refetch()} /></div>
          ) : tab === "overview" ? (
            <Overview d={d} onChats={canChats ? () => setTab("chats") : undefined} />
          ) : tab === "chats" && canChats ? (
            <Chats userId={userId} />
          ) : (
            <Credits userId={userId} d={d} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────────────────────────────

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-soft">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-xl font-bold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Overview({ d, onChats }: { d: NonNullable<Awaited<ReturnType<typeof fetchGideonPersonOverview>>>; onChats?: () => void }) {
  const L = useLang();
  const { t, locale } = L;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }) : "—");
  const day = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const s = d.stats;
  if (s.questions === 0 && d.credits.answers === 0) {
    return <div className="flex flex-1 items-center justify-center p-6"><EmptyState icon={GideonMark} tone="muted" title={t("No GIDEON use yet")} message={t("Questions, chats and credits show up here once they ask GIDEON something.")} /></div>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("Questions")} value={formatCount(s.questions)} hint={t("{n} answers", { n: formatCount(s.answers) })} />
        <Stat label={t("Tool calls")} value={formatCount(s.toolCalls)} />
        <Stat label={t("Credits this period")} value={formatCount(d.credits.used)} hint={`${day(d.credits.period.startKey)} – ${day(d.credits.period.endKey)}`} />
        <Stat label={t("Most-used tier")} value={d.topTier ? (CREDIT_TIER_NAME[d.topTier.tier] ?? d.topTier.tier) : "—"} hint={d.topTier ? t("{n} answers", { n: formatCount(d.topTier.answers) }) : null} />
      </div>
      <dl className="mt-5 divide-y divide-border rounded-xl border border-border bg-card text-sm">
        {[
          [t("Chats"), s.deletedChats != null && s.deletedChats > 0 ? t("{n} · {d} deleted by them", { n: formatCount(s.chats), d: formatCount(s.deletedChats) }) : formatCount(s.chats)],
          [t("First used"), when(s.firstUsed)],
          [t("Last used"), when(s.lastUsed)],
          [t("Credits today"), formatCount(d.credits.todayUsed)],
        ].map(([k, v]) => (
          <div key={k} className="grid grid-cols-[10rem_1fr] gap-3 px-4 py-2.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {onChats && s.chats > 0 && (
        <button type="button" onClick={onChats} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <MessageCircle className="h-4 w-4" />{t("Read their chats")}
        </button>
      )}
    </div>
  );
}

// ── Credits ───────────────────────────────────────────────────────────────────────────────────────────

function Credits({ userId, d }: { userId: string; d: NonNullable<Awaited<ReturnType<typeof fetchGideonPersonOverview>>> }) {
  const L = useLang();
  const { t } = L;
  const qc = useQueryClient();
  const admin = useQuery({ queryKey: ["gideon-credits-admin", null], queryFn: () => fetchCreditAdmin(null), retry: false });
  const person = admin.data?.people.find((p) => p.id === userId) ?? null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="space-y-3">
          <h3 className="font-display text-base font-semibold">{t("This period")}</h3>
          <div className="grid grid-cols-2 gap-3">
            <Stat label={t("Credits used")} value={formatCount(d.credits.used)} hint={t("{n} answers", { n: formatCount(d.credits.answers) })} />
            <Stat label={t("Today")} value={formatCount(d.credits.todayUsed)} hint={person && !person.limits.unlimited ? t("of {n}", { n: formatCount(person.limits.daily) }) : person?.limits.unlimited ? t("Unlimited") : null} />
          </div>
          {d.credits.tiers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t("No credits used this period.")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
              {d.credits.tiers.map((x) => (
                <li key={x.tier} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span>{tierName(x.tier)}</span>
                  <span className="tabular-nums text-muted-foreground">{t("{n} answers", { n: formatCount(x.answers) })} · <span className="font-semibold text-foreground">{formatCount(x.credits)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-3">
          <h3 className="font-display text-base font-semibold">{t("Limits")}</h3>
          {admin.isLoading ? (
            <div className="grid h-24 place-items-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : person && admin.data ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <PersonCreditsForm person={person} policy={admin.data.policy} onSaved={() => { void qc.invalidateQueries({ queryKey: ["gideon-credits-admin"] }); void qc.invalidateQueries({ queryKey: ["gideon-person", userId] }); }} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("Limits apply to members of the company workspace only.")}</p>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Chats ─────────────────────────────────────────────────────────────────────────────────────────────

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const h = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(h); }, [value, ms]);
  return v;
}

function Chats({ userId }: { userId: string }) {
  const L = useLang();
  const { t, locale } = L;
  const [q, setQ] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<"all" | "only" | "none">("all");
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounced(q, 250);
  const filters = { q: dq, from: from ?? undefined, to: to ?? undefined, deleted };
  const list = useInfiniteQuery({
    queryKey: ["gideon-review-chats", userId, filters],
    queryFn: ({ pageParam }) => fetchGideonReviewChats(userId, { ...filters, cursor: pageParam, limit: 30 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.chats) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = Boolean(dq.trim() || from || to || deleted !== "all");
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
  const chip = (on: boolean) => cn("h-7 rounded-full px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-accent text-accent-foreground ring-1 ring-sidebar-primary/30" : "text-muted-foreground hover:bg-muted");

  return (
    <div className="flex min-h-0 flex-1">
      {/* The list: the whole width on a phone until a chat is opened; a 22rem column beside the transcript otherwise. */}
      <div className={cn("min-h-0 w-full flex-col border-border md:flex md:w-[22rem] md:shrink-0 md:border-r", open ? "hidden" : "flex")}>
        <div className="space-y-2 border-b border-border p-3">
          <label className="flex h-8 items-center gap-2 rounded-md bg-muted/60 px-2.5 focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search their chats")} aria-label={t("Search their chats")} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <DateField value={from} onChange={setFrom} max={to ?? undefined} placeholder={t("From")} ariaLabel={t("From date")} className="h-8 text-xs" />
            <DateField value={to} onChange={setTo} min={from ?? undefined} placeholder={t("To")} ariaLabel={t("To date")} className="h-8 text-xs" align="end" />
          </div>
          <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={t("Show")}>
            {([["all", t("All")], ["none", t("Kept")], ["only", t("Deleted by user")]] as const).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={deleted === k} onClick={() => setDeleted(k)} className={chip(deleted === k)}>{label}</button>
            ))}
            {filtered && <button type="button" onClick={() => { setQ(""); setFrom(null); setTo(null); setDeleted("all"); }} className="ml-auto h-7 rounded-md px-2 text-xs font-medium text-sidebar-primary hover:bg-accent">{t("Clear filters")}</button>}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2" onScroll={(e) => {
          const el = e.currentTarget;
          if (list.hasNextPage && !list.isFetchingNextPage && el.scrollTop + el.clientHeight > el.scrollHeight - 240) void list.fetchNextPage();
        }}>
          {list.isLoading ? (
            <div className="grid h-24 place-items-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : list.isError ? (
            <LoadError compact error={list.error} what={t("their chats")} onRetry={() => void list.refetch()} forbiddenTitle={t("Only the One Above All can read GIDEON chats")} />
          ) : rows.length === 0 ? (
            <EmptyState compact icon={MessageCircle} tone="muted" title={filtered ? t("No chat matches these filters") : t("No GIDEON chats")} message={filtered ? t("Try other words or dates.") : t("They haven't chatted with GIDEON yet.")} />
          ) : (
            <>
              <div className="px-2 pb-1.5 pt-1 text-xs text-muted-foreground">{L.tn(total, "1 chat", "{n} chats")}</div>
              <ul className="space-y-0.5">
                {rows.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setOpen(r.id)} aria-current={open === r.id ? "true" : undefined} className={cn("w-full rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", open === r.id ? "bg-accent text-accent-foreground" : "hover:bg-muted")}>
                      <span className="flex items-start gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", r.deleted && "text-muted-foreground")}>{chatTitleText(r.title) || t("Untitled chat")}</span>
                        <span className="shrink-0 pt-px text-[11px] tabular-nums text-muted-foreground">{when(r.updatedAt)}</span>
                      </span>
                      {r.match && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{r.match}</span>}
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        {r.deleted && <DeletedChip />}
                        {r.tier && <span className="rounded bg-muted px-1.5 py-px">{CREDIT_TIER_NAME[r.tier] ?? r.tier}</span>}
                        <span className="tabular-nums">{L.tn(r.messages, "1 message", "{n} messages")}</span>
                        <span className="tabular-nums">{t("{n} credits", { n: formatCount(r.credits) })}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {list.isFetchingNextPage && <div className="grid h-12 place-items-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
              {list.hasNextPage && !list.isFetchingNextPage && (
                <button type="button" onClick={() => void list.fetchNextPage()} className="mt-1 w-full rounded-md py-2 text-xs font-medium text-sidebar-primary hover:bg-accent">{t("Load more")}</button>
              )}
            </>
          )}
        </div>
      </div>

      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", open ? "flex" : "hidden md:flex")}>
        {open ? (
          <Transcript key={open} userId={userId} chatId={open} onBack={() => setOpen(null)} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState icon={Eye} tone="muted" title={t("Pick a chat to read it")} message={t("Read-only. They aren't notified.")} />
          </div>
        )}
      </div>
    </div>
  );
}

function DeletedChip() {
  const { t } = useLang();
  return <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-px font-medium text-destructive"><Trash2 className="h-3 w-3" />{t("Deleted by user")}</span>;
}

function Transcript({ userId, chatId, onBack }: { userId: string; chatId: string; onBack: () => void }) {
  const L = useLang();
  const { t, locale } = L;
  const first = useQuery({ queryKey: ["gideon-review-transcript", userId, chatId], queryFn: () => fetchGideonReviewTranscript(userId, chatId), retry: false });
  const [older, setOlder] = useState<{ messages: GideonReviewMessage[]; before: string | null; loading: boolean }>({ messages: [], before: null, loading: false });
  const before = older.messages.length ? older.before : first.data?.olderBefore ?? null;
  const loadOlder = () => {
    if (!before || older.loading) return;
    setOlder((o) => ({ ...o, loading: true }));
    fetchGideonReviewTranscript(userId, chatId, before)
      .then((r) => setOlder((o) => ({ messages: [...r.messages, ...o.messages], before: r.olderBefore, loading: false })))
      .catch(() => setOlder((o) => ({ ...o, loading: false })));
  };
  const chat = first.data?.chat;
  const turns = useMemo(() => [...older.messages, ...(first.data?.messages ?? [])], [older.messages, first.data]);
  const stamp = (iso: string) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The band (owner, 18 Oct 2026): always says how this is being read. */}
      <div role="note" className="flex items-center gap-2 border-b border-sidebar-primary/20 bg-accent/60 px-4 py-1.5 text-xs font-medium text-accent-foreground">
        <Eye className="h-3.5 w-3.5 shrink-0 text-sidebar-primary" aria-hidden />
        <span>{t("Viewed as One Above All · read-only")}</span>
      </div>
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <button type="button" onClick={onBack} aria-label={t("Back to chats")} className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-base font-semibold">{chat ? chatTitleText(chat.title) || t("Untitled chat") : t("Loading…")}</h3>
          {chat && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
              {chat.deleted && <DeletedChip />}
              <span>{t("Started {d}", { d: stamp(chat.createdAt) })}</span>
              {chat.tier && <span>{tierName(chat.tier)}</span>}
              <span className="tabular-nums">{L.tn(chat.messages, "1 message", "{n} messages")}</span>
              <span className="tabular-nums">{t("{n} credits", { n: formatCount(chat.credits) })}</span>
              {chat.deleted && chat.deletedAt && <span>{t("Deleted {d}", { d: stamp(chat.deletedAt) })}</span>}
            </div>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {first.isLoading ? (
          <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : first.isError ? (
          <LoadError compact error={first.error} what={t("this conversation")} onRetry={() => void first.refetch()} forbiddenTitle={t("Only the One Above All can read GIDEON chats")} />
        ) : turns.length === 0 ? (
          <EmptyState compact icon={AlertTriangle} tone="muted" title={t("This chat has no messages")} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {before && (
              <button type="button" onClick={loadOlder} disabled={older.loading} className="mx-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                {older.loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("Show earlier messages")}
              </button>
            )}
            {turns.map((m, i) => {
              const turn = fromHistory(m);
              const prev = turns[i - 1];
              const gap = !prev || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 30 * 60_000;
              return (
                <div key={m.id} className="flex flex-col gap-2">
                  {gap && <div className="text-center text-[11px] text-muted-foreground">{stamp(m.createdAt)}</div>}
                  {m.role === "user" ? (
                    <UserTurn turn={turn} readOnly />
                  ) : (
                    <>
                      <AssistantTurn turn={turn} onDecided={() => undefined} question="" projectId={null} editorTarget={null} readOnly isLast={false} />
                      {(m.tier || m.credits != null) && (
                        <div className="-mt-1 text-[11px] text-muted-foreground">
                          {[tierName(m.tier), m.credits != null ? t("{n} credits", { n: formatCount(m.credits) }) : null].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
