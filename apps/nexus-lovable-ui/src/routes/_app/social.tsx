import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Clock, CalendarClock, Trash2, Megaphone, RefreshCw, Check, ImageOff } from "lucide-react";
import { nexusApi, type BufferDraft } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/social")({ component: SocialApprovals });

const SERVICE_TONE: Record<string, string> = {
  instagram: "bg-pink-100 text-pink-700", facebook: "bg-blue-100 text-blue-700",
  twitter: "bg-sky-100 text-sky-700", x: "bg-slate-200 text-slate-800",
  linkedin: "bg-indigo-100 text-indigo-700", tiktok: "bg-slate-200 text-slate-900",
  youtube: "bg-red-100 text-red-700", pinterest: "bg-rose-100 text-rose-700",
};

function SocialApprovals() {
  const qc = useQueryClient();
  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false });
  const allowed = wsm.data?.role === "ONE_ABOVE_ALL";

  // Buffer is hard-capped at 250 calls/24h; poll gently (15min), never in a hidden/background tab, and
  // skip the on-mount refetch if data is <90s old (matches the server cache). Use Refresh for on-demand.
  const drafts = useQuery({
    queryKey: ["nexus", "buffer-drafts"],
    queryFn: () => nexusApi.bufferDrafts(),
    enabled: allowed,
    retry: false,
    refetchInterval: 900_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 90_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["nexus", "buffer-drafts"] });

  if (wsm.isLoading) return <div className="flex h-64 items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!allowed) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <Megaphone className="h-10 w-10 text-muted-foreground/40" />
        <div className="text-lg font-bold">Social Approvals is for One Above All only</div>
        <p className="max-w-sm text-sm text-muted-foreground">This page is just for the top role.</p>
      </div>
    );
  }

  const data = drafts.data;
  const items = data?.drafts ?? [];

  return (
    <div>
      <PageHeader title="Social Approvals" subtitle="Review & approve auto-generated posts before they go live via Buffer." icon={<Megaphone className="h-6 w-6 text-primary" />} />
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold transition hover:bg-accent">
            <RefreshCw className={cn("h-3.5 w-3.5", drafts.isFetching && "animate-spin")} /> Refresh
          </button>
          <span className="text-xs text-muted-foreground">{items.length} draft{items.length === 1 ? "" : "s"} waiting for approval</span>
        </div>

        {data && !data.configured && (
          <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-6 text-center">
            <div className="font-bold text-amber-800">Buffer isn't connected yet</div>
            <p className="mt-1 text-sm text-amber-700">The Buffer token (`BUFFER_API_TOKEN`) isn't set on the server yet. Give your Buffer API key to an admin to turn this on.</p>
          </div>
        )}
        {data?.error && (
          <div className={cn("rounded-xl border px-4 py-2 text-sm", data.rateLimited ? "border-amber-200 bg-amber-50 text-amber-800" : "border-rose-200 bg-rose-50 text-rose-700")}>
            {data.error}
            {data.stale && <span className="ml-1 opacity-70">(last known data, {items.length} draft{items.length === 1 ? "" : "s"})</span>}
          </div>
        )}
        {drafts.isError && !data && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">Couldn't pull drafts from the server. Try Refresh.</div>
        )}

        {drafts.isLoading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}

        {data?.configured && !drafts.isLoading && items.length === 0 && !data.error && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground shadow-sm">
            <Check className="mx-auto mb-2 h-8 w-8 text-emerald-400" /> All clear — no drafts waiting for approval. 🎉
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map((d) => <DraftCard key={d.id} draft={d} onDone={refresh} />)}
        </div>
      </div>
    </div>
  );
}

// Media thumb with graceful fallback — the automation's image host (ephemeral tunnel) can be dead,
// so show a clean placeholder instead of a broken-image icon.
function MediaThumb({ src }: { src: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div className="grid h-24 w-24 shrink-0 place-items-center gap-0.5 rounded-lg border border-dashed border-border bg-muted/40 text-center text-[9px] leading-tight text-muted-foreground">
        <ImageOff className="h-4 w-4" /> image<br />didn't load
      </div>
    );
  }
  return <img src={src} alt="" loading="lazy" onError={() => setErr(true)} className="h-24 w-24 shrink-0 rounded-lg border border-border object-cover" />;
}

function DraftCard({ draft, onDone }: { draft: BufferDraft; onDone: () => void }) {
  const [scheduling, setScheduling] = useState(false);
  const [dueAt, setDueAt] = useState("");

  const approve = useMutation({
    mutationFn: (args: { mode: "queue" | "schedule" | "now"; dueAt?: string }) => nexusApi.bufferApprove(draft.id, args.mode, args.dueAt),
    onSuccess: (_d, args) => { toast.success(args.mode === "now" ? "Posted now ✅" : args.mode === "schedule" ? "Scheduled ✅" : "Added to Buffer queue ✅"); onDone(); },
    onError: (e: any) => toast.error("Couldn't approve", { description: e?.message }),
  });
  const reject = useMutation({
    mutationFn: () => nexusApi.bufferReject(draft.id),
    onSuccess: () => { toast.success("Draft rejected & deleted"); onDone(); },
    onError: (e: any) => toast.error("Couldn't reject", { description: e?.message }),
  });
  const busy = approve.isPending || reject.isPending;
  const pendMode = approve.isPending ? approve.variables?.mode : undefined;
  const tone = SERVICE_TONE[(draft.channel?.service || "").toLowerCase()] ?? "bg-muted text-muted-foreground";

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="mb-2 flex items-center gap-2">
        {draft.channel?.avatar ? <img src={draft.channel.avatar} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-muted text-[10px] font-bold">{(draft.channel?.service || "?").slice(0, 2).toUpperCase()}</span>}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{draft.channel?.name ?? "—"}</div>
          <span className={cn("inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase", tone)}>{draft.channel?.service ?? "draft"}</span>
        </div>
      </div>

      {draft.media.length > 0 && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto">
          {draft.media.map((m, i) => <MediaThumb key={i} src={m} />)}
        </div>
      )}

      <p className="flex-1 whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-sm leading-relaxed">{draft.text || <span className="text-muted-foreground italic">(no caption)</span>}</p>

      {scheduling ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary" />
          <button disabled={!dueAt || busy} onClick={() => approve.mutate({ mode: "schedule", dueAt: new Date(dueAt).toISOString() })} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-40">
            {approve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />} Schedule
          </button>
          <button onClick={() => setScheduling(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent">Cancel</button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button disabled={busy} onClick={() => approve.mutate({ mode: "queue" })} title="Add to Buffer queue (auto-schedule)" className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-40">
            {pendMode === "queue" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />} Queue
          </button>
          <button disabled={busy} onClick={() => setScheduling(true)} title="Pick a date & time to go live" className="inline-flex items-center justify-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs font-bold text-sky-700 transition hover:bg-sky-100 disabled:opacity-40">
            <CalendarClock className="h-3.5 w-3.5" /> Schedule
          </button>
          <button disabled={busy} onClick={() => approve.mutate({ mode: "now" })} title="Post right now" className="inline-flex items-center justify-center gap-1 rounded-lg border border-primary bg-primary/10 px-2 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20 disabled:opacity-40">
            {pendMode === "now" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Now
          </button>
          <button disabled={busy} onClick={() => { if (confirm("Reject & delete this draft from Buffer?")) reject.mutate(); }} title="Reject & delete" className="inline-flex items-center justify-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-bold text-muted-foreground transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">
            {reject.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Reject
          </button>
        </div>
      )}
    </div>
  );
}
