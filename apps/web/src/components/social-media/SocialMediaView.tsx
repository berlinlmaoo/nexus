import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Megaphone, PencilLine, Settings2, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { useRealtime, useRealtimeRoom } from "@/lib/realtime";
import { EmptyAction, EmptyState } from "@/components/EmptyState";
import { Meter, MonthSwitcher, dayLong, monthLabel, wibToday } from "@/components/outlet-sales/outlet-ui";
import { socialApi, socialKey, socialMonthKey, type SocialMonthResponse, type SocialPlatformOverview } from "@/lib/social-media-api";
import { SocialCalendar } from "./SocialCalendar";
import { SocialDaySheet } from "./SocialDaySheet";
import { EngagementInfo, num, viewsLabel } from "./social-ui";
import { SocialSettings } from "./SocialSettings";

export type SocialView = "overview" | "calendar";

/**
 * A Social Media Report project (owner, 14 Oct 2026): per day and platform the team records Views, Likes,
 * Comments, Shares and Posts published, plus two notes a day. Overview = the month to date per platform
 * against the targets to date; Calendar = every day at a glance, a day opens its sheet. Both tabs share one
 * month; a colleague's change arrives live (`social-media-changed`).
 */
export function SocialMediaView({
  projectId, view, initialDate,
}: {
  projectId: string;
  view: SocialView;
  /** From a link (?date=): the month to show and the day sheet to open. */
  initialDate?: string;
}) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => (initialDate ?? wibToday()).slice(0, 7));
  const [openDate, setOpenDate] = useState<string | null>(initialDate ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const q = useQuery({
    queryKey: socialMonthKey(projectId, month),
    queryFn: () => socialApi.month(projectId, month),
    retry: false,
    placeholderData: keepPreviousData,
  });

  useRealtimeRoom(`project:${projectId}`);
  const { socket } = useRealtime();
  useEffect(() => {
    if (!socket) return;
    const onChanged = (payload?: { projectId?: unknown }) => {
      if (payload?.projectId === projectId) qc.invalidateQueries({ queryKey: socialKey(projectId) });
    };
    socket.on("social-media-changed", onChanged);
    return () => { socket.off("social-media-changed", onChanged); };
  }, [socket, projectId, qc]);

  const data = q.data;

  if (q.isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-8" aria-busy="true" aria-label={t("Loading the report")}>
        <div className="h-10 w-64 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-3 md:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-muted" />)}</div>
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (q.isError || !data) {
    const code = (q.error as { status?: number } | null)?.status;
    return (
      <div className="p-4 md:p-8">
        <EmptyState
          icon={Megaphone}
          tone="muted"
          title={code === 403 ? t("This report is for its project members") : t("The report didn't load")}
          message={code === 403 ? t("Ask the Project Owner or a board member to add you to the project.") : t("Check your connection, then try again.")}
          action={code === 403 ? undefined : <EmptyAction onClick={() => q.refetch()}>{t("Try again")}</EmptyAction>}
        />
      </div>
    );
  }

  const today = data.today;
  const recordDay = today.slice(0, 7) === data.month ? today : null;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-8" aria-busy={q.isFetching || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonthSwitcher month={month} today={today} onChange={setMonth} />
        {/* Labelled on a phone too (UI tour run 13, W-M13: a bare icon). */}
        <div className="flex flex-wrap items-center gap-2">
          {data.canManage && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:h-11"
            >
              <Settings2 aria-hidden className="h-4 w-4" />
              {t("Platforms & targets")}
            </button>
          )}
          {data.canRecord && (
            <button
              type="button"
              onClick={() => setOpenDate(recordDay ?? today)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
            >
              <PencilLine aria-hidden className="h-4 w-4" /> {t("Record today")}
            </button>
          )}
        </div>
      </div>

      {view === "overview" && <Overview data={data} onRecord={() => setOpenDate(recordDay ?? today)} onSetup={() => setSettingsOpen(true)} />}
      {view === "calendar" && <SocialCalendar data={data} onOpen={setOpenDate} />}

      <SocialDaySheet
        projectId={projectId}
        data={data}
        date={openDate}
        onClose={() => setOpenDate(null)}
        onMonth={(m) => { if (m !== month) setMonth(m); }}
      />
      <SocialSettings projectId={projectId} data={data} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────────────────────────────

function Overview({ data, onRecord, onSetup }: { data: SocialMonthResponse; onRecord: () => void; onSetup: () => void }) {
  const { t, tn, lang, locale } = useLang();
  const o = data.overview;
  const monthName = monthLabel(data.month, locale);
  const hasTargets = data.targets.some((x) => x.engagementTarget !== null || x.postsTarget !== null);

  if (o.cutoff === null) {
    return (
      <EmptyState
        icon={CalendarClock}
        tone="muted"
        title={t("{month} hasn't started yet", { month: monthName })}
        message={data.canManage ? t("You can set its targets now. The overview fills in from its first day.") : t("The overview fills in from its first day.")}
        action={data.canManage ? <EmptyAction onClick={onSetup}>{t("Set targets")}</EmptyAction> : undefined}
      />
    );
  }
  if (o.recordedDays === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title={t("Nothing recorded for {month} yet", { month: monthName })}
        message={data.canRecord
          ? t("Record each day's views, likes, comments, shares and posts per platform. The totals and targets show up here.")
          : t("The team records each day's figures per platform. They show up here once someone has.")}
        action={data.canRecord ? <EmptyAction onClick={onRecord}>{t("Record today")}</EmptyAction> : undefined}
      />
    );
  }

  const firstDay = `${data.month}-01`;
  const span = o.cutoff === firstDay
    ? dayLong(firstDay, locale, data.today.slice(0, 4))
    : `${new Date(`${firstDay}T00:00:00`).toLocaleDateString(locale, { day: "numeric" })}–${new Date(`${o.cutoff}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" })}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>{t("Month to date · {span}", { span })}</span>
        <EngagementInfo />
        {!hasTargets && (
          <span className="text-xs">
            {data.canManage ? (
              <button type="button" onClick={onSetup} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-primary transition-colors hover:bg-primary/5 pointer-coarse:min-h-[36px]">
                <Target aria-hidden className="h-3.5 w-3.5" /> {t("Set this month's targets")}
              </button>
            ) : t("No targets for this month. The Project Owner or a board member sets them.")}
          </span>
        )}
      </div>

      <section aria-label={t("Engagement by platform")} className={cn("grid gap-3", o.platforms.length > 1 && "md:grid-cols-2", o.platforms.length > 2 && "xl:grid-cols-3")}>
        {o.platforms.map((p) => (
          <EngagementCard
            key={p.platformId}
            p={p}
            baseTarget={data.targets.find((x) => x.platformId === p.platformId)?.engagementTarget ?? null}
            onSetTarget={data.canManage ? onSetup : undefined}
          />
        ))}
      </section>

      <section aria-labelledby="sm-posts" className="rounded-xl border border-border bg-card p-4 md:p-5">
        <h3 id="sm-posts" className="text-sm font-semibold">{t("Posts published")}</h3>
        <ul className="mt-3 flex flex-col gap-3">
          {o.platforms.map((p) => (
            // Fixed name and value columns, so every platform's track has the same length (UI tour run 17, R17-WD-4:
            // with an `auto` value column the YouTube track ran ~80px further than Instagram's and TikTok's).
            <li key={p.platformId} className="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr_11rem]">
              <span className="truncate text-sm font-medium">{p.name}{p.archived && <span className="text-muted-foreground"> · {t("archived")}</span>}</span>
              <span className="whitespace-nowrap tabular-nums text-sm sm:order-3 sm:text-right">
                {p.postsTargetToDate === null
                  ? tn(p.posts, "1 post", "{n} posts", { n: num(p.posts, lang) })
                  : tn(p.postsTargetToDate, "{n} / {target} post", "{n} / {target} posts", { n: num(p.posts, lang), target: num(p.postsTargetToDate, lang) })}
                {p.postsPct !== null && <span className="ml-1.5 text-muted-foreground">({p.postsPct}%)</span>}
              </span>
              <div className="col-span-2 sm:col-span-1"><Meter pct={p.postsPct} label={t("{name} posts against target", { name: p.name })} /></div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{t("Target to date = each day's target up to today. A day without its own target takes the month's target split evenly.")}</p>
      </section>
    </>
  );
}

function EngagementCard({ p, baseTarget, onSetTarget }: {
  p: SocialPlatformOverview;
  /** The month's own target in Platforms & targets; the card's month target also counts the day targets. */
  baseTarget: number | null;
  /** Opens Platforms & targets (people who manage the report). */
  onSetTarget?: () => void;
}) {
  const { t, lang } = useLang();
  // Day targets change the month's sum: say so, or 35.000 here reads as a mismatch with the 31.000 typed in
  // Platforms & targets (UI tour run 13, W-B3).
  const withDays = p.engagementTargetMonth !== null && p.engagementTargetMonth !== baseTarget;
  return (
    <article className="flex flex-col rounded-xl border border-border bg-card p-4 md:p-5">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{p.name}{p.archived && <span className="font-normal text-muted-foreground"> · {t("archived")}</span>}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">{t("Engagement")}</span>
      </header>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums">
        <span className="text-2xl font-semibold tracking-tight md:text-3xl">{num(p.engagement, lang)}</span>
        <span className="text-base text-muted-foreground">/ {p.engagementTargetToDate === null ? "—" : num(p.engagementTargetToDate, lang)}</span>
        {p.engagementPct !== null && (
          <span className={cn("rounded-full px-2 py-0.5 text-sm font-semibold", p.engagementPct >= 100 ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-primary/10 text-primary")}>
            {p.engagementPct}%
          </span>
        )}
      </p>
      <div className="mt-3"><Meter pct={p.engagementPct} label={t("{name} engagement against target", { name: p.name })} /></div>
      <p className="mt-2 text-xs text-muted-foreground">
        {p.engagementTargetToDate === null ? (
          <>
            {t("No engagement target")}
            {/* A next step, not a dead end (UI tour run 13, W-B15). */}
            {onSetTarget && (
              <>
                {" · "}
                <button type="button" onClick={onSetTarget} className="rounded font-medium text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[36px]">
                  {t("Set a target")}
                </button>
              </>
            )}
          </>
        ) : withDays
          ? t("Target to date · month target {target} (incl. day targets)", { target: num(p.engagementTargetMonth, lang) })
          : t("Target to date · month target {target}", { target: num(p.engagementTargetMonth, lang) })}
      </p>
      <Sparkline values={p.trend} label={t("{name} engagement per day", { name: p.name })} />
      <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-border/70 pt-3 text-xs">
        {([[viewsLabel(lang), p.views], [t("Likes"), p.likes], [t("Comments"), p.comments], [t("Shares"), p.shares]] as const).map(([label, v]) => (
          <div key={label} className="min-w-0"><dt className="truncate text-muted-foreground">{label}</dt><dd className="mt-0.5 truncate font-semibold tabular-nums text-foreground">{num(v, lang)}</dd></div>
        ))}
      </dl>
    </article>
  );
}

/**
 * The month's engagement per day, quiet: one 2px line in the accent over a faint area, the last day marked.
 * Values sit in the table of the calendar; hovering a day shows its number (the hit area is the whole column).
 */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const { lang } = useLang();
  const [hover, setHover] = useState<number | null>(null);
  const W = 240;
  const H = 40;
  const max = Math.max(1, ...values);
  const pts = useMemo(() => values.map((v, i) => [values.length === 1 ? W / 2 : (i * W) / (values.length - 1), H - 3 - (v / max) * (H - 8)] as const), [values, max]);
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = pts[pts.length - 1];
  const step = W / (values.length - 1);
  return (
    <div className="relative mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-10 w-full overflow-visible text-primary" role="img" aria-label={label}>
        <path d={area} className="fill-current opacity-[0.08]" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={pts[hover][0]} x2={pts[hover][0]} y1={0} y2={H} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        {pts.map(([x], i) => (
          <rect key={i} x={x - step / 2} y={0} width={step} height={H} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
        ))}
      </svg>
      <span aria-hidden className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card" style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%` }} />
      {hover !== null && (
        <span className="pointer-events-none absolute -top-6 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-1.5 py-0.5 text-[11px] tabular-nums text-foreground shadow-sm" style={{ left: `${(pts[hover][0] / W) * 100}%` }}>
          {hover + 1} · {num(values[hover], lang)}
        </span>
      )}
    </div>
  );
}
