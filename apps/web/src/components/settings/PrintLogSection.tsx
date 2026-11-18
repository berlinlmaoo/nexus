import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FileText, Loader2, Printer, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/DateField";
import { SelectPicker } from "@/components/SelectPicker";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { AvatarFace } from "@/components/Avatar";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { PRINT_LOG_KEY, jobErrorText, printApi, statusLabel, usePrinting, type PrintJob, type PrintStatus } from "@/lib/print-api";

/**
 * Settings › Print log (owner, 18 Nov 2026: every print is recorded). Your own prints; BoD / One Above All see
 * everyone's and can pick one person. Filter by days (WIB). Newest first, 50 at a time.
 */

const STATUS_TONE: Record<PrintStatus, string> = {
  done: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/10 text-destructive",
  printing: "bg-primary/10 text-primary",
  queued: "bg-muted text-muted-foreground",
};

export function PrintLogSection() {
  const { t, tn, locale } = useLang();
  const printing = usePrinting();
  const [person, setPerson] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

  const q = useInfiniteQuery({
    queryKey: [...PRINT_LOG_KEY, { person, from, to }],
    queryFn: ({ pageParam }) => printApi.log({ userId: person || undefined, from: from ?? undefined, to: to ?? undefined, cursor: pageParam || undefined }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // A job still printing moves on its own.
    refetchInterval: (query) => (query.state.data?.pages.some((p) => p.jobs.some((j) => j.status === "printing" || j.status === "queued")) ? 5000 : false),
  });
  const first = q.data?.pages[0];
  const jobs = useMemo(() => q.data?.pages.flatMap((p) => p.jobs) ?? [], [q.data]);
  const seesAll = !!first?.canSeeAll;
  const filtered = !!(person || from || to);
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("Print log")}</h2>
        <p className="text-sm text-muted-foreground">
          {seesAll ? t("Every print to the office printer, by everyone. Only BoD and One Above All see other people's prints.") : t("Everything you printed to the office printer.")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {seesAll && (
          <SelectPicker variant="field" size="sm" className="w-auto min-w-40" ariaLabel={t("Person")} value={person} onChange={setPerson} searchable
            placeholder={t("Everyone")} clearable={t("Everyone")}
            options={(first?.people ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        )}
        <DateField value={from} onChange={setFrom} placeholder={t("From")} ariaLabel={t("From")} max={to ?? undefined}
          className="h-8 rounded-md border border-border px-2 text-sm" emptyClassName="text-muted-foreground" />
        <span className="text-muted-foreground" aria-hidden>–</span>
        <DateField value={to} onChange={setTo} placeholder={t("To")} ariaLabel={t("To")} min={from ?? undefined}
          className="h-8 rounded-md border border-border px-2 text-sm" emptyClassName="text-muted-foreground" />
        {filtered && <Button variant="ghost" size="sm" onClick={() => { setPerson(""); setFrom(null); setTo(null); }}>{t("Clear filters")}</Button>}
      </div>

      {q.isPending ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => void q.refetch()} what={t("the print log")} />
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-soft">
          {filtered ? (
            <EmptyState icon={Printer} compact title={t("No prints match these filters")} message={t("Pick other days or another person, or clear the filters.")} />
          ) : (
            <EmptyState icon={Printer} title={t("No prints yet")}
              message={printing.enabled
                ? t("Print a Legal document or a page from its menu. Every print shows up here: what, how many pages, and whether it printed.")
                : t("The printer isn't set up on this server yet. Once it is, prints show up here.")} />
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          {jobs.map((j) => <JobRow key={j.id} job={j} showPerson={seesAll} when={when(j.createdAt)} />)}
        </ul>
      )}

      {q.hasNextPage && (
        <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} className="gap-1.5">
          {q.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />} {t("Show more")}
        </Button>
      )}
      {jobs.length > 0 && <p className="text-xs text-muted-foreground">{tn(jobs.length, "{n} print shown", "{n} prints shown")}</p>}
    </div>
  );
}

function JobRow({ job, showPerson, when }: { job: PrintJob; showPerson: boolean; when: string }) {
  const { t, tn } = useLang();
  const Icon = job.kind === "legal" ? Scale : FileText;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label={job.kind === "legal" ? t("Legal document") : t("Page")} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{job.title}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[job.status])}>{statusLabel(job.status)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {showPerson && job.user && (
            <span className="inline-flex items-center gap-1"><AvatarFace name={job.user.name} avatar={job.user.avatar} size={16} decorative /> {job.user.name} ·</span>
          )}
          <span>{when}</span>
          <span>· {tn(job.pages, "{n} page", "{n} pages")} × {job.copies}</span>
          <span>· {job.colorMode === "color" ? t("Color") : t("Black & white")}</span>
        </div>
        {job.status === "failed" && <div className="text-xs text-destructive [overflow-wrap:anywhere]">{jobErrorText(job.error)}</div>}
      </div>
    </li>
  );
}
