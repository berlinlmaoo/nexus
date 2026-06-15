import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ScrollText, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtDate, fmtTime, nexusApi } from "@/lib/nexus-api";
import { xpReasonInfo } from "@/lib/xp-reason";
import { MorphPanel } from "@/components/motion/MorphPanel";

type Scope = "period" | "all";
type XpUser = { id: string; name?: string | null; avatar?: string | null };

/** Public per-user XP log. The whole leaderboard row (one box, `layoutId`) expands into this modal —
 *  contents scale together (no per-element flying); the header mirrors the row (avatar + name, same
 *  bg) so the box morph is seamless, then the log body fades in. Render inside a parent <AnimatePresence>. */
export function UserXpLogModal({ user, layoutId, onClose }: { user: XpUser; layoutId?: string; onClose: () => void }) {
  const [scope, setScope] = useState<Scope>("period");
  const log = useInfiniteQuery({
    queryKey: ["user-xp-log", user.id, scope],
    queryFn: ({ pageParam = 0 }) => nexusApi.userXpLog(user.id, { scope, offset: pageParam, limit: 40 }),
    getNextPageParam: (last) => (last.hasMore ? last.nextOffset : undefined),
    initialPageParam: 0,
    retry: 1,
  });
  const rows = log.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <MorphPanel layoutId={layoutId} onClose={onClose}>
      {/* Header mirrors the leaderboard row (avatar + name, same card bg) → seamless box morph. */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <Avatar userId={user.id} name={user.name ?? undefined} avatar={user.avatar ?? undefined} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{user.name ?? "—"}</div>
          <div className="text-[11px] text-muted-foreground">Log XP — semua nambah & berkurang</div>
        </div>
        <button onClick={onClose} aria-label="Tutup" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-border">
        <div className="flex items-center gap-2 px-5 py-3">
          <div className="inline-flex rounded-xl border border-border bg-muted/40 p-0.5">
            {([["period", "Periode ini"], ["all", "Semua waktu"]] as [Scope, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setScope(v)} className={cn("rounded-lg px-3 py-1 text-xs font-semibold transition-colors", scope === v ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}>{label}</button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {log.isLoading && <div className="space-y-2 px-5 pb-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>}
          {log.isError && <p className="px-5 py-10 text-center text-sm text-muted-foreground">Gagal memuat log XP.</p>}
          {!log.isLoading && !log.isError && rows.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted-foreground">Belum ada perubahan XP {scope === "period" ? "di periode ini" : ""}.</p>}
          {!log.isLoading && rows.length > 0 && (
            <div className="divide-y divide-border">
              {rows.map((r) => {
                const info = xpReasonInfo(r.reason, r.amount, r.lateMinutes);
                const pos = r.amount >= 0;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", pos ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600")}><ScrollText className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{info.label}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{info.sub ? `${info.sub} · ` : ""}{fmtDate(r.createdAt)} {fmtTime(r.createdAt)}</div>
                    </div>
                    <div className={cn("shrink-0 text-sm font-black tabular-nums", pos ? "text-emerald-600" : "text-rose-600")}>{pos ? `+${r.amount}` : r.amount} XP</div>
                  </div>
                );
              })}
              {log.hasNextPage && <div className="px-5 py-3"><button onClick={() => log.fetchNextPage()} disabled={log.isFetchingNextPage} className="w-full rounded-xl border border-border bg-muted/40 py-2 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60">{log.isFetchingNextPage ? "Memuat…" : "Muat lebih banyak"}</button></div>}
            </div>
          )}
        </div>
      </div>
    </MorphPanel>
  );
}
