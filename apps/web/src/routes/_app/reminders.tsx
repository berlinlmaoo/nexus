import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, BellRing, Loader2, Plus, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageBody } from "@/components/PageLayout";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { Skeleton } from "@/components/ui/skeleton";
import { DateField } from "@/components/DateField";
import { useLang } from "@/lib/lang";
import { useRealtime } from "@/lib/realtime";
import { toastFailure } from "@/lib/failure";
import { celebrate } from "@/components/Celebration";

export const Route = createFileRoute("/_app/reminders")({ component: RemindersPage });

/**
 * Personal reminders (18 Oct 2026): what GIDEON set for you ("remind me tomorrow 9 to follow up the vendor") and
 * what you set here. Each goes off as a notification + push at its time (WIB); waiting ones can be cancelled.
 * Live: the socket `reminders-changed` refetches (made, cancelled or gone off — here, in GIDEON or on a phone).
 */
type Reminder = { id: string; text: string; remindAt: string; firedAt: string | null; createdAt: string };
const KEY = ["reminders"] as const;

async function rjson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { Accept: "application/json", "Content-Type": "application/json", "X-Nexus-Client": "web/1", ...(init?.headers || {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`), { status: res.status, body });
  return body as T;
}

function RemindersPage() {
  const { t, locale } = useLang();
  const qc = useQueryClient();
  const { socket } = useRealtime();
  const list = useQuery({ queryKey: KEY, queryFn: () => rjson<{ upcoming: Reminder[]; done: Reminder[] }>("/api/reminders?done=1"), refetchOnWindowFocus: true });
  useEffect(() => {
    if (!socket) return;
    const on = () => void qc.invalidateQueries({ queryKey: KEY });
    socket.on("reminders-changed", on);
    return () => { socket.off("reminders-changed", on); };
  }, [socket, qc]);

  const [text, setText] = useState("");
  const [at, setAt] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => rjson<{ reminder: Reminder }>("/api/reminders", { method: "POST", body: JSON.stringify({ text, remindAt: at }) }),
    onSuccess: () => { setText(""); setAt(null); celebrate(t("Reminder set")); void qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e: unknown) => toastFailure(t("Couldn't set the reminder."), e),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => rjson(`/api/reminders/${id}`, { method: "DELETE" }),
    onSuccess: () => { celebrate(t("Reminder cancelled")); void qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e: unknown) => toastFailure(t("Couldn't cancel it."), e),
  });

  const when = (iso: string) => new Date(iso).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).replace(/,/g, "");
  const upcoming = list.data?.upcoming ?? [];
  const done = list.data?.done ?? [];

  return (
    <div>
      <PageHeader title={t("Reminders")} subtitle={t("Each one goes off as a notification and a push at its time (WIB). Ask GIDEON to set one, or add it here.")} />
      <PageBody>
        <form
          className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center"
          onSubmit={(e) => { e.preventDefault(); if (text.trim() && at && !create.isPending) create.mutate(); }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={280}
            placeholder={t("Remind me to…")}
            aria-label={t("Reminder")}
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center gap-2">
            <DateField value={at} onChange={setAt} withTime placeholder={t("Pick a time")} ariaLabel={t("When")} className="h-9 min-w-[11rem] rounded-md border border-border px-3 text-sm" />
            <button type="submit" disabled={!text.trim() || !at || create.isPending} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-sidebar-primary px-3 text-sm font-medium text-sidebar-primary-foreground transition-colors hover:bg-sidebar-primary/90 disabled:opacity-50">
              {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {t("Add")}
            </button>
          </div>
        </form>

        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t("Coming up")}</h2>
        <div className="divide-y divide-border overflow-clip rounded-xl border border-border bg-card">
          {list.isLoading && Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-4"><Skeleton className="h-9 w-9 rounded-full" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-1/2" /><Skeleton className="h-3 w-24" /></div></div>
          ))}
          {list.isError && <LoadError compact error={list.error} what={t("your reminders")} onRetry={() => void list.refetch()} />}
          {!list.isLoading && !list.isError && upcoming.length === 0 && (
            <EmptyState icon={AlarmClock} tone="muted" compact title={t("No reminders waiting")}
              message={t("Tell GIDEON “remind me tomorrow at 9 to follow up the vendor”, or add one above. It shows up here until it goes off.")} />
          )}
          {upcoming.map((r) => (
            <div key={r.id} className="flex items-center gap-3 p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400"><AlarmClock className="h-4 w-4" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{r.text}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{when(r.remindAt)} WIB</p>
              </div>
              <button type="button" onClick={() => cancel.mutate(r.id)} disabled={cancel.isPending} aria-label={t("Cancel reminder")} title={t("Cancel reminder")}
                className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 pointer-coarse:min-h-9 pointer-coarse:min-w-9">
                {cancel.isPending && cancel.variables === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>

        {done.length > 0 && (
          <>
            <h2 className="mb-2 mt-6 text-sm font-semibold text-muted-foreground">{t("Gone off")}</h2>
            <div className="divide-y divide-border overflow-clip rounded-xl border border-border bg-card opacity-80">
              {done.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><BellRing className="h-4 w-4" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{r.text}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{when(r.remindAt)} WIB</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </PageBody>
    </div>
  );
}
