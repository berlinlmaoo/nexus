import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LifeBuoy, Plus, X, Loader2, Send, EyeOff, Lock, CheckCircle2, MessageSquare, Inbox as InboxIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { nexusApi, type Complaint } from "@/lib/nexus-api";

export const Route = createFileRoute("/_app/complaints")({ component: ComplaintsPage });

const CATEGORIES: { key: string; label: string; emoji: string }[] = [
  { key: "ATTENDANCE", label: "Absensi", emoji: "🕐" },
  { key: "EXP", label: "EXP / Gamifikasi", emoji: "⭐" },
  { key: "PAYROLL", label: "Payroll / Gaji", emoji: "💰" },
  { key: "DAY_OFF", label: "Cuti / Day-Off", emoji: "🌴" },
  { key: "OPERATIONAL", label: "Operasional", emoji: "⚙️" },
  { key: "HR", label: "HR", emoji: "🧑‍💼" },
  { key: "LEADERSHIP", label: "Kepemimpinan", emoji: "🧭" },
  { key: "OTHER", label: "Lainnya", emoji: "💬" },
];
const catOf = (k: string) => CATEGORIES.find((c) => c.key === k);
const STATUS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: "Baru", cls: "bg-amber-100 text-amber-700 ring-amber-200" },
  IN_REVIEW: { label: "Ditangani", cls: "bg-sky-100 text-sky-700 ring-sky-200" },
  RESOLVED: { label: "Selesai", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200" },
  CLOSED: { label: "Ditutup", cls: "bg-slate-100 text-slate-500 ring-slate-200" },
};
const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Tab = "open" | "review" | "all";

function ComplaintsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("open");
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const roleQ = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const viewerIsBod = ["ONE_ABOVE_ALL", "BOD"].includes(roleQ.data?.role ?? "");

  // BoD filter by status; staff just see their own thread list.
  const status = !viewerIsBod ? "ALL" : tab === "open" ? "OPEN" : tab === "review" ? "IN_REVIEW" : "ALL";
  const listQ = useQuery({ queryKey: ["complaints", viewerIsBod ? status : "MINE"], queryFn: () => nexusApi.complaints(status) });
  const complaints = listQ.data?.complaints ?? [];
  const counts = listQ.data?.counts ?? {};

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["complaints"] }); };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Keluhan & Eskalasi"
        subtitle="Saluran rahasia ke BoD untuk masalah operasional/HR. Bisa anonim."
        icon={<LifeBuoy className="h-6 w-6 text-primary" />}
        actions={<button onClick={() => setComposing(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground shadow-sm transition active:scale-[0.97]"><Plus className="h-4 w-4" /> Ajukan keluhan</button>}
      />

      {viewerIsBod && (
        <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
          {([["open", "Masuk"], ["review", "Diproses"], ["all", "Semua"]] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} className="relative shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold transition">
              {tab === t && <motion.span layoutId="complaint-tab" className="absolute inset-0 rounded-lg bg-primary" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
              <span className={cn("relative flex items-center gap-1.5", tab === t ? "text-primary-foreground" : "text-muted-foreground")}>
                {label}
                {t === "open" && (counts.OPEN ?? 0) > 0 && <span className={cn("rounded-full px-1.5 text-[10px] font-black tabular-nums", tab === t ? "bg-primary-foreground/20" : "bg-amber-100 text-amber-700")}>{counts.OPEN}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2.5">
        {listQ.isLoading && Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-card" />)}
        {!listQ.isLoading && complaints.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><InboxIcon className="h-7 w-7" /></div>
            <div className="text-base font-black">{viewerIsBod ? "Belum ada keluhan di sini" : "Belum ada keluhan"}</div>
            <p className="mt-1 text-sm text-muted-foreground">{viewerIsBod ? "Keluhan dari staff bakal muncul di sini." : "Ada masalah operasional / HR? Ajukan — bisa anonim."}</p>
          </div>
        )}
        {complaints.map((c) => <ComplaintCard key={c.id} c={c} viewerIsBod={viewerIsBod} onOpen={() => setOpenId(c.id)} />)}
      </div>

      <AnimatePresence>
        {composing && <Composer onClose={() => setComposing(false)} onDone={() => { setComposing(false); invalidate(); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {openId && <ComplaintThread id={openId} viewerIsBod={viewerIsBod} onClose={() => setOpenId(null)} onChanged={invalidate} />}
      </AnimatePresence>
    </div>
  );
}

function ComplaintCard({ c, viewerIsBod, onOpen }: { c: Complaint; viewerIsBod: boolean; onOpen: () => void }) {
  const st = STATUS[c.status];
  const cat = catOf(c.category);
  const who = viewerIsBod ? (c.reporterHidden ? "Anonim" : c.reporter?.name ?? "—") : "Kamu";
  return (
    <button onClick={onOpen} className="block w-full rounded-2xl border border-border bg-card p-3.5 text-left shadow-soft transition hover:border-primary/40 hover:shadow-pop active:scale-[0.99]">
      <div className="flex items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold ring-1", st.cls)}>{st.label}</span>
        <span className="text-xs font-semibold text-muted-foreground">{cat?.emoji} {cat?.label}</span>
        {c.confidential && <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700"><Lock className="h-2.5 w-2.5" /> rahasia</span>}
        {c.anonymous && <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600"><EyeOff className="h-2.5 w-2.5" /> anonim</span>}
        <span className="ml-auto text-[11px] text-muted-foreground">{fmtWhen(c.lastMessageAt)}</span>
      </div>
      <div className="mt-1.5 line-clamp-1 text-sm font-bold">{c.subject}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MessageSquare className="h-3 w-3" /> {c.messageCount} pesan · {viewerIsBod ? `dari ${who}` : "keluhan kamu"}
      </div>
    </button>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.18, ease: "easeOut" }}
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Composer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [confidential, setConfidential] = useState(false);
  const canSubmit = category && subject.trim().length >= 4 && body.trim().length >= 10;
  const create = useMutation({ mutationFn: () => nexusApi.createComplaint({ category, subject: subject.trim(), body: body.trim(), anonymous, confidential }), onSuccess: onDone });

  return (
    <Backdrop onClose={onClose}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-lg font-black">Ajukan keluhan</h2>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-4 overflow-y-auto p-5">
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Kategori</label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c.key} onClick={() => setCategory(c.key)} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition", category === c.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Judul singkat</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} placeholder="Mis. Salah potong jatah cuti bulan ini" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Ceritakan keluhannya</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} placeholder="Jelaskan masalahnya sedetail mungkin — apa yang terjadi, kapan, dan apa yang kamu harapkan." className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <p className="text-right text-[11px] text-muted-foreground">{body.trim().length}/4000</p>
        </div>

        <div className="space-y-2">
          <button onClick={() => setAnonymous((v) => !v)} className={cn("flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition", anonymous ? "border-slate-400 bg-slate-50" : "border-border hover:bg-accent")}>
            <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", anonymous ? "bg-slate-600 text-white" : "bg-muted text-muted-foreground")}><EyeOff className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">Kirim anonim</span>
              <span className="block text-[11px] text-muted-foreground">Nama kamu disembunyikan — bahkan dari BoD.</span>
            </span>
            <span className={cn("h-5 w-9 shrink-0 rounded-full p-0.5 transition", anonymous ? "bg-slate-600" : "bg-muted")}><span className={cn("block h-4 w-4 rounded-full bg-white transition", anonymous && "translate-x-4")} /></span>
          </button>
          <button onClick={() => setConfidential((v) => !v)} className={cn("flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition", confidential ? "border-rose-300 bg-rose-50" : "border-border hover:bg-accent")}>
            <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", confidential ? "bg-rose-600 text-white" : "bg-muted text-muted-foreground")}><Lock className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">Tandai rahasia</span>
              <span className="block text-[11px] text-muted-foreground">Sensitif — minta BoD ekstra hati-hati menanganinya.</span>
            </span>
            <span className={cn("h-5 w-9 shrink-0 rounded-full p-0.5 transition", confidential ? "bg-rose-600" : "bg-muted")}><span className={cn("block h-4 w-4 rounded-full bg-white transition", confidential && "translate-x-4")} /></span>
          </button>
        </div>

        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800">
          🔒 Keluhan ini cuma dibaca <b>BoD</b> — gak masuk feed atau dilihat staff lain. BoD bakal balas di sini.
        </div>
        {create.isError && <p className="text-sm font-semibold text-rose-600">Gagal mengirim. Cek koneksi.</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
        <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent">Batal</button>
        <button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-40">
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LifeBuoy className="h-4 w-4" />} Kirim keluhan
        </button>
      </div>
    </Backdrop>
  );
}

function ComplaintThread({ id, viewerIsBod, onClose, onChanged }: { id: string; viewerIsBod: boolean; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const detailQ = useQuery({ queryKey: ["complaint", id], queryFn: () => nexusApi.complaint(id) });
  const c = detailQ.data;

  const refresh = () => { qc.invalidateQueries({ queryKey: ["complaint", id] }); onChanged(); };
  const send = useMutation({ mutationFn: () => nexusApi.replyComplaint(id, reply.trim()), onSuccess: () => { setReply(""); refresh(); } });
  const setStatus = useMutation({ mutationFn: (status: string) => nexusApi.setComplaintStatus(id, status), onSuccess: refresh });
  const busy = send.isPending || setStatus.isPending;

  // Keep the thread pinned to the latest message.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [c?.messages?.length]);

  const cat = c ? catOf(c.category) : null;
  const st = c ? STATUS[c.status] : null;

  return (
    <Backdrop onClose={onClose}>
      <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {st && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold ring-1", st.cls)}>{st.label}</span>}
            <span className="truncate text-xs font-semibold text-muted-foreground">{cat?.emoji} {cat?.label}</span>
          </div>
          <div className="mt-0.5 line-clamp-1 text-sm font-black">{c?.subject ?? "…"}</div>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>

      {/* Reporter identity strip (BoD view) */}
      {c && viewerIsBod && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-2 text-xs">
          {c.reporterHidden ? (
            <><span className="grid h-6 w-6 place-items-center rounded-full bg-slate-200 text-slate-500"><EyeOff className="h-3.5 w-3.5" /></span><span className="font-semibold text-muted-foreground">Pelapor anonim</span></>
          ) : (
            <><Avatar userId={c.reporter?.id ?? ""} name={c.reporter?.name} avatar={c.reporter?.avatar ?? null} size={24} /><span className="font-semibold">{c.reporter?.name}</span></>
          )}
          {c.confidential && <span className="ml-auto inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700"><Lock className="h-2.5 w-2.5" /> rahasia</span>}
        </div>
      )}

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-muted/10 p-4">
        {detailQ.isLoading && <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-2xl bg-muted" />)}</div>}
        {c?.messages.map((m) => (
          <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm", m.mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-card ring-1 ring-border")}>
              {!m.mine && <div className="mb-0.5 text-[11px] font-bold opacity-70">{m.fromReviewer ? "BoD" : (m.authorHidden ? "Anonim" : m.author?.name ?? "—")}</div>}
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <div className={cn("mt-0.5 text-right text-[10px]", m.mine ? "text-primary-foreground/70" : "text-muted-foreground")}>{fmtWhen(m.createdAt)}</div>
            </div>
          </div>
        ))}
        {c && c.status !== "OPEN" && c.resolvedAt && (c.status === "RESOLVED" || c.status === "CLOSED") && (
          <div className="py-1 text-center text-[11px] font-semibold text-muted-foreground">— {c.status === "RESOLVED" ? "Ditandai selesai" : "Ditutup"} {c.resolvedBy ? `oleh ${c.resolvedBy.name}` : ""} —</div>
        )}
      </div>

      {/* BoD status controls */}
      {c?.canManage && (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-2">
          {c.status !== "IN_REVIEW" && c.status !== "CLOSED" && c.status !== "RESOLVED" && <button onClick={() => setStatus.mutate("IN_REVIEW")} disabled={busy} className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 transition hover:bg-sky-100 disabled:opacity-50">Tangani</button>}
          {c.status !== "RESOLVED" && c.status !== "CLOSED" && <button onClick={() => setStatus.mutate("RESOLVED")} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" /> Tandai selesai</button>}
          {c.status !== "CLOSED" && <button onClick={() => setStatus.mutate("CLOSED")} disabled={busy} className="rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground transition hover:bg-accent disabled:opacity-50">Tutup</button>}
          {c.status === "CLOSED" && <button onClick={() => setStatus.mutate("IN_REVIEW")} disabled={busy} className="rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground transition hover:bg-accent disabled:opacity-50">Buka lagi</button>}
        </div>
      )}

      {/* Reply box */}
      {c?.canReply ? (
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (reply.trim().length >= 10) send.mutate(); } }}
              rows={1}
              maxLength={4000}
              placeholder={viewerIsBod ? "Balas keluhan ini…" : "Tulis balasan…"}
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button onClick={() => send.mutate()} disabled={busy || reply.trim().length < 10} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-40">
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          {reply.trim().length > 0 && reply.trim().length < 10 && (
            <p className="mt-1 pl-1 text-[11px] text-muted-foreground">Minimal 10 karakter ({reply.trim().length}/10)</p>
          )}
        </div>
      ) : (
        c && <div className="border-t border-border px-4 py-3 text-center text-xs font-semibold text-muted-foreground">Keluhan ini sudah ditutup.</div>
      )}
    </Backdrop>
  );
}
