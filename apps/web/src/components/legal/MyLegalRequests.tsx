import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarDays, Download, FileText, Loader2, Paperclip, Scale, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { docTypeLabel, fmtDay, formatBytes, statusLabel } from "@/components/legal/legal-labels";
import { fmtDate, fmtTime } from "@/lib/nexus-api";
import { legalRequestsApi, type MyLegalRequest, type RequestStage } from "@/lib/legal-requests-api";
import { t as tt, useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/** What the requester reads for each stage (server: src/lib/legal/request-rules.ts). */
export function stageLabel(stage: RequestStage): string {
  const labels: Record<RequestStage, string> = {
    RECEIVED: tt("Received"),
    IN_PROGRESS: tt("In progress"),
    REVISION: tt("Revision"),
    FINAL: tt("Final"),
    SIGNED: tt("Signed"),
    DONE: tt("Done"),
    REJECTED: tt("Rejected"),
  };
  return labels[stage] ?? stage;
}

export function stageClass(stage: RequestStage): string {
  switch (stage) {
    case "IN_PROGRESS": case "REVISION": return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "FINAL": return "bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "SIGNED": case "DONE": return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "REJECTED": return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
    default: return "bg-muted text-foreground";
  }
}

export function StageChip({ stage }: { stage: RequestStage }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", stageClass(stage))}>{stageLabel(stage)}</span>;
}

const overdue = (day: string | null, stage: RequestStage) =>
  !!day && !["SIGNED", "DONE", "REJECTED"].includes(stage) && day < new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

function Card({ r, onOpen }: { r: MyLegalRequest; onOpen: () => void }) {
  const { t, lang } = useLang();
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-3 shadow-sm">
      <button type="button" onClick={onOpen} className="text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-snug">{r.templateName || docTypeLabel(r.docType)}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{r.company.name}{r.isAddendum && r.parentNumberText ? ` · ${t("Amends {number}", { number: r.parentNumberText })}` : ""}</div>
          </div>
          <StageChip stage={r.stage} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{t("Sent {when}", { when: fmtDate(r.createdAt) })}</span>
          {r.deadline && (
            <span className={cn("inline-flex items-center gap-1", overdue(r.deadline, r.stage) && "font-semibold text-rose-600 dark:text-rose-400")}>
              <CalendarDays className="h-3 w-3" />{fmtDay(r.deadline, lang)}
            </span>
          )}
          {r.document && <span className="font-mono">{r.document.number}</span>}
        </div>
        {r.stage === "REJECTED" && r.rejectReason && <p className="mt-2 line-clamp-2 text-xs text-rose-700 dark:text-rose-300">{r.rejectReason}</p>}
      </button>
      {r.canDownload && (
        <a href={legalRequestsApi.mineFileUrl(r.id)} className="mt-2.5 inline-flex items-center gap-1.5 self-start rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-accent">
          <Download className="h-3.5 w-3.5" /> {r.stage === "SIGNED" ? t("Download signed copy") : t("Download final document")}
        </a>
      )}
    </div>
  );
}

/**
 * My Legal requests (owner, 14 Oct 2026), above the form submissions board: what I asked Legal for, where it
 * stands, and the final / signed file to download once it exists. Live: the server pings my room with
 * workspace-changed { kind: "submissions" } (lib/realtime.tsx refetches ["legal-requests-mine"]).
 */
export function MyLegalRequestsSection({ requests, onOpen }: { requests: MyLegalRequest[]; onOpen: (id: string) => void }) {
  const { t } = useLang();
  if (!requests.length) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Scale className="h-4 w-4 text-muted-foreground" />{t("Legal requests")}<span className="text-xs font-normal text-muted-foreground">{requests.length}</span></h2>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {requests.map((r) => <Card key={r.id} r={r} onOpen={() => onOpen(r.id)} />)}
      </div>
    </section>
  );
}

function fmtAnswer(v: unknown, yes: string): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? yes : "—";
  if (typeof v === "number") return v.toLocaleString("id-ID");
  return String(v);
}

/** One of my Legal requests: my answers, its stage, Legal's reason when declined, and the file once final. */
export function MyLegalRequestDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, lang } = useLang();
  const q = useQuery({ queryKey: ["legal-requests-mine", "one", id], queryFn: () => legalRequestsApi.mineOne(id), retry: 1 });
  const r = q.data?.request;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const label = "text-xs font-semibold text-muted-foreground";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm dark:bg-scrim" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={r?.templateName || t("Legal request")} lang={lang} className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold leading-tight">{r?.templateName || t("Legal request")}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{r ? `${docTypeLabel(r.docType)} · ${r.company.name}` : ""}</p>
          </div>
          <button onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {q.isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>}
          {q.isError && <p className="text-sm text-destructive">{(q.error as { status?: number } | null)?.status === 404 ? t("This request no longer exists, or the link is wrong.") : t("Couldn't load the details.")}</p>}
          {r && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <StageChip stage={r.stage} />
                <span className="text-xs text-muted-foreground">{t("Sent {when}", { when: `${fmtDate(r.createdAt)} ${fmtTime(r.createdAt)}` })}</span>
              </div>
              {r.stage === "REJECTED" && (
                <div className="flex gap-2 rounded-xl border border-rose-300/60 bg-rose-50/60 p-3 text-sm dark:border-rose-500/30 dark:bg-rose-500/10">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <div><div className="font-semibold">{t("Legal declined this request")}</div><p className="mt-0.5 whitespace-pre-wrap">{r.rejectReason || "—"}</p></div>
                </div>
              )}
              {r.document && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{r.document.title}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.document.number} · {statusLabel(r.document.status)}</div>
                  </div>
                  {r.canDownload ? (
                    <a href={legalRequestsApi.mineFileUrl(r.id)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                      <Download className="h-4 w-4" /> {t("Download")}
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("You can download it once it is final.")}</span>
                  )}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                <div><dt className={label}>{t("Needed by")}</dt><dd>{fmtDay(r.deadline, lang)}</dd></div>
                <div><dt className={label}>{t("Handled by")}</dt><dd className="truncate">{r.pic?.name ?? t("Not assigned yet")}</dd></div>
                <div><dt className={label}>{t("Related to")}</dt><dd className="truncate">{r.deal ? `${r.deal.code} · ${r.deal.name}` : r.project?.name ?? "—"}</dd></div>
                {r.isAddendum && <div className="col-span-2 sm:col-span-3"><dt className={label}>{t("Number of the document to amend")}</dt><dd className="font-mono">{r.parentNumberText || "—"}</dd></div>}
              </dl>
              {r.purpose && (
                <section><h3 className={cn(label, "mb-1")}>{t("Purpose and notes")}</h3><p className="whitespace-pre-wrap text-sm">{r.purpose}</p></section>
              )}
              <section>
                <h3 className={cn(label, "mb-2")}>{t("Your answers")}</h3>
                {(r.answers ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("You left the details to Legal.")}</p>
                ) : (
                  <dl className="divide-y divide-border rounded-xl border border-border">
                    {(r.answers ?? []).map((a) => (
                      <div key={a.name} className="grid gap-1 px-3 py-2 sm:grid-cols-[40%_1fr]">
                        <dt className="text-xs text-muted-foreground">{a.label}</dt>
                        <dd className="whitespace-pre-wrap break-words text-sm">
                          {Array.isArray(a.value)
                            ? (a.value as Record<string, unknown>[]).map((row, i) => (
                                <div key={i} className="mb-1 rounded-md bg-muted/50 px-2 py-1">
                                  {(a.columns ?? []).map((c) => <div key={c.name}><span className="text-muted-foreground">{c.label}: </span>{fmtAnswer(row[c.name], t("Yes"))}</div>)}
                                </div>
                              ))
                            : a.type === "date" ? fmtDay(String(a.value), lang) : fmtAnswer(a.value, t("Yes"))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
              {r.attachments.length > 0 && (
                <section>
                  <h3 className={cn(label, "mb-2")}>{t("Attachments")}</h3>
                  <ul className="space-y-1.5">
                    {r.attachments.map((a) => (
                      <li key={a.id}>
                        <a href={legalRequestsApi.mineAttachmentUrl(r.id, a.id)} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent/50">
                          <Paperclip className="h-4 w-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{a.fileName}</span><span className="text-xs text-muted-foreground">{formatBytes(a.size)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
          {q.isFetching && !q.isLoading && <Loader2 className="mx-auto mt-3 h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>
    </div>
  );
}
