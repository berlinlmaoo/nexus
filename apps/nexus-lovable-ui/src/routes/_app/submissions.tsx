import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileText, Inbox, Lock, X, Trash2, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtDate, fmtTime, nexusApi, type NexusMySubmission } from "@/lib/nexus-api";

export const Route = createFileRoute("/_app/submissions")({ component: MySubmissions });

const NEW_COL = "Baru masuk";

function colTone(name: string) {
  const n = name.toLowerCase();
  if (n.includes("done") || n.includes("selesai")) return "border-emerald-300/70 bg-emerald-50";
  if (n.includes("progress") || n.includes("proses")) return "border-blue-300/70 bg-blue-50";
  if (n.includes("tolak") || n.includes("reject") || n.includes("batal")) return "border-rose-300/70 bg-rose-50";
  if (n.includes("approve") || n.includes("setuju") || n.includes("paid")) return "border-emerald-300/70 bg-emerald-50";
  return "border-border bg-muted/40";
}

function Card({ s, onOpen }: { s: NexusMySubmission; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full rounded-xl border border-border bg-card p-3 text-left shadow-soft transition hover:border-primary/40 hover:shadow-pop active:scale-[0.99]">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FileText className="h-3.5 w-3.5" /></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{s.taskTitle || s.formName || "Pengajuan"}</div>
          <div className="truncate text-[11px] text-muted-foreground">{s.formName}{s.projectName ? ` · ${s.projectName}` : ""}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">diajukan {fmtDate(s.createdAt)} {fmtTime(s.createdAt)}</div>
        </div>
      </div>
    </button>
  );
}

/** Format a submitted answer value (string / number / array / file-object / place-object) for display. */
function fmtVal(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? fmtVal(x) : String(x))).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.name === "string") return o.name; // uploaded file
    if (typeof o.label === "string") return o.label; // place
    return JSON.stringify(v);
  }
  if (typeof v === "boolean") return v ? "Ya" : "Tidak";
  return String(v);
}

function statusLabel(s?: string | null) {
  if (!s) return "";
  return s.split(/[_\s]+/).map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

function SubmissionDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ["submission-detail", id], queryFn: () => nexusApi.submissionDetail(id), retry: 1 });
  const del = useMutation({
    mutationFn: () => nexusApi.deleteSubmission(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-submissions"] }); onClose(); },
    onError: (e) => alert(e instanceof Error ? e.message : "Gagal menghapus pengajuan."),
  });
  const sub = d.data;
  const answers = sub?.answers ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col overflow-hidden bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold leading-tight">{sub?.taskTitle || sub?.formName || "Pengajuan"}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub?.formName}{sub?.projectName ? ` · ${sub.projectName}` : ""}</p>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {d.isLoading && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>}
          {d.isError && <p className="text-sm text-destructive">Gagal memuat detail.</p>}
          {sub && (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                {sub.stage && <span className={cn("rounded-full border px-2 py-0.5", colTone(sub.stage))}>{sub.stage}</span>}
                {sub.procStatus && <span className={cn("rounded-full border px-2 py-0.5", colTone(sub.procStatus))}>{sub.procStatus}</span>}
                {sub.status && <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">{statusLabel(sub.status)}</span>}
                <span className="text-muted-foreground">· diajukan {fmtDate(sub.createdAt)} {fmtTime(sub.createdAt)}</span>
              </div>

              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Detail pengajuan</p>
              {answers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Gaada isian yang kerekam.</p>
              ) : (
                <div className="space-y-2.5">
                  {answers.map((a) => (
                    <div key={a.id} className="rounded-xl border border-border bg-muted/30 p-3">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{a.label}</div>
                      <div className="mt-0.5 whitespace-pre-wrap break-words text-sm">{fmtVal(a.value)}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-border p-4">
          <button
            onClick={() => { if (window.confirm("Hapus pengajuan ini?\n\nTask-nya di project juga ikut KEHAPUS permanen, dan gabisa di-undo.")) del.mutate(); }}
            disabled={del.isPending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Hapus pengajuan + task-nya
          </button>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Ngapus pengajuan ini bakal ngapus juga task-nya di project.</p>
        </div>
      </div>
    </div>
  );
}

function MySubmissions() {
  const q = useQuery({ queryKey: ["my-submissions"], queryFn: () => nexusApi.mySubmissions(), retry: 1 });
  const subs = q.data?.submissions ?? [];
  const statusCols = q.data?.statusColumns ?? [];
  const columns = [NEW_COL, ...statusCols];
  const colOf = (s: NexusMySubmission) => (s.procStatus && s.procStatus.trim() ? s.procStatus : NEW_COL);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title="Pengajuan Saya" subtitle="Board status pengajuanmu — digerakin tim Finance, kamu cuma pantau (read-only). Klik buat lihat detail." />
      <div className="p-4 md:p-8">
        {q.isLoading && <div className="flex gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 w-72 rounded-2xl" />)}</div>}
        {q.isError && <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">Gagal memuat. Login diperlukan.</div>}

        {!q.isLoading && !q.isError && subs.length === 0 && (
          <div className="rounded-2xl border border-dashed bg-card p-10 text-center shadow-sm">
            <Inbox className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <div className="text-base font-black">Belum ada pengajuan</div>
            <p className="mt-1.5 text-sm text-muted-foreground">Form yang kamu ajukan bakal muncul di board ini lengkap sama statusnya.</p>
          </div>
        )}

        {!q.isLoading && !q.isError && subs.length > 0 && (
          <>
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
              <Lock className="h-3 w-3" /> Read-only — status diatur tim Finance
            </div>
            <div className="flex gap-3 overflow-x-auto pb-4">
              {columns.map((col) => {
                const items = subs.filter((s) => colOf(s) === col);
                return (
                  <div key={col} className={cn("flex w-72 shrink-0 flex-col rounded-2xl border", colTone(col))}>
                    <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                      <span className="text-sm font-black">{col}</span>
                      <span className="rounded-full bg-card px-2 py-0.5 text-xs font-bold text-muted-foreground">{items.length}</span>
                    </div>
                    <div className="flex-1 space-y-2 px-2 pb-2">
                      {items.map((s) => <Card key={s.id} s={s} onOpen={() => setOpenId(s.id)} />)}
                      {items.length === 0 && <div className="rounded-xl border border-dashed border-border/60 py-6 text-center text-[11px] text-muted-foreground">kosong</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {openId && <SubmissionDetailDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
