import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, Minus, Plus, ScrollText, Search, SlidersHorizontal, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { celebrate } from "@/components/Celebration";
import { ApiError, fmtDate, fmtTime, nexusApi } from "@/lib/nexus-api";
import { xpReasonInfo } from "@/lib/xp-reason";

type Sign = "all" | "pos" | "neg";
type Scope = "period" | "all";

const reasonInfo = xpReasonInfo; // shared with the public per-user XP log

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg px-3 py-1 text-xs font-semibold transition-colors",
            value === o.value ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function XpAuditLog() {
  const [open, setOpen] = useState(false);
  const [sign, setSign] = useState<Sign>("all");
  const [scope, setScope] = useState<Scope>("period");
  const [adjustOpen, setAdjustOpen] = useState(false);

  const log = useInfiniteQuery({
    queryKey: ["xp-audit", sign, scope],
    queryFn: ({ pageParam = 0 }) => nexusApi.xpAuditLog({ sign, scope, offset: pageParam, limit: 40 }),
    getNextPageParam: (last) => (last.hasMore ? last.nextOffset : undefined),
    initialPageParam: 0,
    enabled: open,
    retry: 1,
  });

  const rows = log.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <ScrollText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-black">
            Audit Log XP
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Admin</span>
          </div>
          <div className="text-xs text-muted-foreground">Semua perubahan XP (nambah & berkurang) seluruh crew</div>
        </div>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t border-border">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <Segmented<Sign>
              value={sign}
              onChange={setSign}
              options={[
                { value: "all", label: "Semua" },
                { value: "pos", label: "Nambah (+)" },
                { value: "neg", label: "Berkurang (−)" },
              ]}
            />
            <Segmented<Scope>
              value={scope}
              onChange={setScope}
              options={[
                { value: "period", label: "Periode ini" },
                { value: "all", label: "Semua waktu" },
              ]}
            />
            <button
              onClick={() => setAdjustOpen(true)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold shadow-soft transition-colors hover:bg-accent"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> Atur XP
            </button>
          </div>
          {adjustOpen && <XpAdjustModal onClose={() => setAdjustOpen(false)} />}

          {log.isLoading && (
            <div className="space-y-2 px-4 pb-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
            </div>
          )}

          {log.isError && (
            <div className="px-4 pb-5 pt-1 text-center text-sm text-muted-foreground">
              Gagal memuat log — butuh akses BoD ke atas.
            </div>
          )}

          {!log.isLoading && !log.isError && rows.length === 0 && (
            <div className="px-4 pb-6 pt-1 text-center text-sm text-muted-foreground">
              Belum ada perubahan XP {scope === "period" ? "di periode ini" : ""}.
            </div>
          )}

          {!log.isLoading && rows.length > 0 && (
            <div className="divide-y divide-border">
              {rows.map((r) => {
                const info = reasonInfo(r.reason, r.amount, r.lateMinutes);
                const pos = r.amount >= 0;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar userId={r.userId} name={r.userName} avatar={r.userAvatar} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{r.userName ?? "—"}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {info.label}
                        {info.sub ? ` · ${info.sub}` : ""} · {fmtDate(r.createdAt)} {fmtTime(r.createdAt)}
                      </div>
                    </div>
                    <div className={cn("shrink-0 text-sm font-black tabular-nums", pos ? "text-emerald-600" : "text-rose-600")}>
                      {pos ? `+${r.amount}` : r.amount} XP
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {log.hasNextPage && (
            <div className="px-4 py-3">
              <button
                onClick={() => log.fetchNextPage()}
                disabled={log.isFetchingNextPage}
                className="w-full rounded-xl border border-border bg-muted/40 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
              >
                {log.isFetchingNextPage ? "Memuat…" : "Muat lebih banyak"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** BoD-only modal: add or reduce a crew member's XP, logged as an admin adjustment. */
function XpAdjustModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const lb = useQuery({ queryKey: ["leaderboard"], queryFn: nexusApi.leaderboard, staleTime: 60_000, retry: 1 });
  const users = useMemo(() => (lb.data?.rows ?? []).slice().sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")), [lb.data]);

  const [sign, setSign] = useState<1 | -1>(-1); // default: reduce
  const [magnitude, setMagnitude] = useState("");
  const [note, setNote] = useState("");
  const [userId, setUserId] = useState("");
  const [search, setSearch] = useState("");

  const selected = users.find((u) => u.userId === userId) ?? null;
  const filtered = search.trim() ? users.filter((u) => (u.name ?? "").toLowerCase().includes(search.trim().toLowerCase())) : users;
  const mag = Math.abs(parseInt(magnitude, 10) || 0);
  const amount = sign * mag;
  const canSubmit = !!userId && mag > 0 && mag <= 1000;

  const adjust = useMutation({
    mutationFn: () => nexusApi.adjustUserXp({ userId, amount, note: note.trim() || undefined }),
    onSuccess: () => {
      // Refresh every XP surface: audit log, leaderboard (both key shapes), dashboard gamification, penalty popup.
      qc.invalidateQueries({ predicate: (q) => {
        const k = q.queryKey.map(String);
        return k.includes("xp-audit") || k.includes("leaderboard") || k.includes("gamification") || k.includes("my-penalties");
      } });
      celebrate(sign > 0 ? "XP ditambahin ✨" : "XP dikurangin ⚖️");
      onClose();
    },
  });

  const fieldCls = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20";

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border bg-muted/30 px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">Atur XP crew</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Tambah atau kurangi XP manual. Tercatat di audit log.</p>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 p-5">
          {/* user picker */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">Crew</label>
            {selected ? (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2">
                <Avatar userId={selected.userId} name={selected.name} avatar={selected.avatar} size={28} />
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{selected.name ?? "—"}</div><div className="text-[11px] text-muted-foreground tabular-nums">{selected.totalXp} XP · Lv.{selected.level}</div></div>
                <button onClick={() => { setUserId(""); setSearch(""); }} className="text-xs font-semibold text-primary hover:underline">Ganti</button>
              </div>
            ) : (
              <div className="rounded-xl border border-border">
                <div className="relative border-b border-border">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama crew…" className="w-full bg-transparent py-2 pl-8 pr-3 text-sm outline-none" autoFocus />
                </div>
                <div className="max-h-44 overflow-y-auto">
                  {lb.isLoading && <div className="px-3 py-3 text-center text-xs text-muted-foreground">Memuat…</div>}
                  {!lb.isLoading && filtered.length === 0 && <div className="px-3 py-3 text-center text-xs text-muted-foreground">Ga ketemu.</div>}
                  {filtered.slice(0, 50).map((u) => (
                    <button key={u.userId} onClick={() => setUserId(u.userId)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40">
                      <Avatar userId={u.userId} name={u.name} avatar={u.avatar} size={24} />
                      <span className="min-w-0 flex-1 truncate text-sm">{u.name ?? "—"}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{u.totalXp} XP</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* add / reduce */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">Aksi & jumlah</label>
            <div className="flex gap-2">
              <div className="inline-flex shrink-0 rounded-xl border border-border p-0.5">
                <button onClick={() => setSign(-1)} className={cn("inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors", sign === -1 ? "bg-rose-500 text-white" : "text-muted-foreground hover:text-foreground")}><Minus className="h-3.5 w-3.5" /> Kurangi</button>
                <button onClick={() => setSign(1)} className={cn("inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors", sign === 1 ? "bg-emerald-500 text-white" : "text-muted-foreground hover:text-foreground")}><Plus className="h-3.5 w-3.5" /> Tambah</button>
              </div>
              <input value={magnitude} onChange={(e) => setMagnitude(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="Jumlah XP" className={fieldCls} />
            </div>
            {mag > 1000 && <p className="mt-1 text-xs text-destructive">Maksimal ±1000 XP per penyesuaian.</p>}
          </div>

          {/* note */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">Alasan <span className="font-normal normal-case text-muted-foreground/70">(opsional, kelihatan di popup user)</span></label>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Mis. telat meeting / bonus inisiatif" className={fieldCls} />
          </div>

          {amount !== 0 && selected && (
            <div className={cn("rounded-xl px-3 py-2 text-sm font-semibold", sign > 0 ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-700")}>
              {selected.name}: {sign > 0 ? "+" : ""}{amount} XP → jadi {selected.totalXp + amount} XP
            </div>
          )}
          {adjust.isError && <p className="text-sm text-destructive">{adjust.error instanceof ApiError ? adjust.error.message : "Gagal — cek izin / koneksi."}</p>}

          <button disabled={!canSubmit || adjust.isPending} onClick={() => adjust.mutate()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.99] disabled:cursor-default disabled:opacity-50">
            {adjust.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {sign > 0 ? "Tambah" : "Kurangi"} XP
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
