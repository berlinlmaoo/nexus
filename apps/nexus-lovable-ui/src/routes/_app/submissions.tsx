import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Inbox, Lock } from "lucide-react";
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

function Card({ s }: { s: NexusMySubmission }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-soft">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FileText className="h-3.5 w-3.5" /></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{s.taskTitle || s.formName || "Pengajuan"}</div>
          <div className="truncate text-[11px] text-muted-foreground">{s.formName}{s.projectName ? ` · ${s.projectName}` : ""}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">diajukan {fmtDate(s.createdAt)} {fmtTime(s.createdAt)}</div>
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

  return (
    <div>
      <PageHeader title="Pengajuan Saya" subtitle="Board status pengajuanmu — digerakin tim Finance, kamu cuma pantau (read-only)." />
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
                      {items.map((s) => <Card key={s.id} s={s} />)}
                      {items.length === 0 && <div className="rounded-xl border border-dashed border-border/60 py-6 text-center text-[11px] text-muted-foreground">kosong</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
