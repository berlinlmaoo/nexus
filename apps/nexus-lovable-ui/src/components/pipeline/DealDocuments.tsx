import { useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Download, ExternalLink, File as FileIcon, FileSpreadsheet, FileText, Film, Image as ImageIcon, Link2, Loader2, Music, Paperclip,
  Plus, Presentation, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { isAbort } from "@/lib/nexus-api";
import { humanSize } from "@/lib/vault-media";
import { LINK_TYPES, summarize } from "@/lib/pipeline";
import {
  dealKey, pipelineApi, pipelineKey, type PipelineDeal, type PipelineDealPatch, type PipelineLink, type PipelineResponse,
} from "@/lib/pipeline-api";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useVocabLabels } from "./pipeline-ui";

/** The chunked route's ceiling (/api/attachments/chunk MAX_SIZE), the same as a task attachment's. */
const MAX_FILE_BYTES = 1024 * 1024 * 1024;

/** The icon of an attached file, by its type and then its name (the Vault's iconFor, plus Office files). */
function iconFor(doc: PipelineLink) {
  const m = (doc.mimeType || "").toLowerCase();
  const name = (doc.fileName || "").toLowerCase();
  if (m.startsWith("image/")) return ImageIcon;
  if (m.startsWith("video/")) return Film;
  if (m.startsWith("audio/")) return Music;
  if (m === "application/pdf" || m.startsWith("text/") || /\.(pdf|docx?|txt|rtf)$/.test(name)) return FileText;
  if (/sheet|excel|csv/.test(m) || /\.(xlsx?|csv)$/.test(name)) return FileSpreadsheet;
  if (/presentation|powerpoint/.test(m) || /\.(pptx?|key)$/.test(name)) return Presentation;
  return FileIcon;
}

type Upload = { key: string; name: string; size: number; pct: number; abort: AbortController };

/**
 * "Documents & links" of a deal (owner, 9 Oct 2026: "kenapa document sama links ini cuma paste document?
 * kenapa ga attach documentnya jg?"). Each entry keeps its type (SPK / Contract / MOU / Invoice / Other)
 * and optional name, and is either a pasted link or an attached file. Files go up through the chunked
 * upload with target=pipeline (the server adds the entry, so a file is never half-attached) — by "Attach
 * file" or by dropping them on the section — and open in a new tab: images and PDFs show inline, the
 * rest download (the server decides, as for every file). Removing asks first and goes through DELETE
 * …/documents/:id; the server keeps the bytes until the 90-day purge, like any deleted attachment.
 */
export function DealDocuments({
  deal, projectId, canEdit, onPatch,
}: {
  deal: PipelineDeal;
  projectId: string;
  canEdit: boolean;
  onPatch: (p: PipelineDealPatch) => void;
}) {
  const { t, lang } = useLang();
  const labels = useVocabLabels();
  const qc = useQueryClient();
  const [type, setType] = useState<string>("SPK");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState<PipelineLink | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  /** The server's answer replaces the board's copy of the deal (KPIs untouched, history refetched). */
  const apply = (saved: PipelineDeal) => {
    qc.setQueryData<PipelineResponse>(pipelineKey(projectId), (cur) => {
      if (!cur) return cur;
      const next = cur.deals.map((d) => (d.id === saved.id ? saved : d));
      return { ...cur, deals: next, summary: summarize(next, cur.today) };
    });
    qc.invalidateQueries({ queryKey: dealKey(projectId, saved.id) });
  };

  const addLink = () => {
    let u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    onPatch({ links: [...deal.links, { id: `lnk${Date.now().toString(36)}`, type, label: label.trim(), url: u }] });
    setUrl("");
    setLabel("");
  };

  const attach = (files: File[]) => {
    if (!files.length) return;
    // The name field names a single file; with several, each keeps its own file name.
    const name = files.length === 1 ? label.trim() : "";
    setLabel("");
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(t("{name} is over 1 GB.", { name: file.name }));
        continue;
      }
      if (file.size === 0) {
        toast.error(t("{name} is empty.", { name: file.name }));
        continue;
      }
      const up: Upload = { key: `${Date.now()}-${Math.random()}`, name: file.name, size: file.size, pct: 0, abort: new AbortController() };
      setUploads((cur) => [...cur, up]);
      pipelineApi
        .uploadDocument(projectId, deal.id, file, { type, label: name }, (pct) =>
          setUploads((cur) => cur.map((u) => (u.key === up.key ? { ...u, pct } : u))), { signal: up.abort.signal })
        .then((r) => { if (r.deal) apply(r.deal); })
        .catch((e: unknown) => {
          if (isAbort(e)) return;
          const msg = (e as { message?: unknown } | null)?.message;
          toast.error(t("{name} wasn't attached. Try again.", { name: file.name }), typeof msg === "string" && msg ? { description: msg } : undefined);
        })
        .finally(() => setUploads((cur) => cur.filter((u) => u.key !== up.key)));
    }
  };

  const remove = async (doc: PipelineLink) => {
    setRemoving(doc.id);
    try {
      apply((await pipelineApi.removeDocument(projectId, deal.id, doc.id)).deal);
    } catch {
      toast.error(t("That change wasn't saved. Try again."));
    } finally {
      setRemoving(null);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!canEdit || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragging(false);
    attach(Array.from(e.dataTransfer.files));
  };

  const nameOf = (l: PipelineLink) => (l.kind === "file" ? l.label || l.fileName || "" : l.label || l.url);

  return (
    <div
      className={cn("relative space-y-2 rounded-xl", dragging && "outline-2 outline-offset-4 outline-dashed outline-primary")}
      onDragOver={(e) => { if (canEdit && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={onDrop}
    >
      {dragging && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl bg-background/85 text-sm font-medium text-primary">
          <span className="inline-flex items-center gap-1.5"><Paperclip className="h-4 w-4" /> {t("Drop files to attach them to this deal")}</span>
        </div>
      )}

      {deal.links.length === 0 && uploads.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("No SPK, contract, MOU or invoice yet. Attach the file or paste a link.")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {deal.links.map((l) => {
            const isFile = l.kind === "file";
            const Icon = isFile ? iconFor(l) : Link2;
            return (
              <li key={l.id} className="flex items-center gap-2 px-3 py-2">
                <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-2xs font-semibold">{labels.link(l.type)}</span>
                <Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
                    <span className="truncate">{nameOf(l)}</span>
                    {!isFile && <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />}
                  </a>
                  {isFile && (
                    <p className="truncate text-xs tabular-nums text-muted-foreground">
                      {[l.label ? l.fileName : null, humanSize(l.size)].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                {isFile && (
                  <a
                    href={`${l.url}?download=1`}
                    download={l.fileName || true}
                    aria-label={t("Download")}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-[44px]"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                )}
                {canEdit && (
                  <button
                    type="button"
                    aria-label={isFile ? t("Remove document") : t("Remove link")}
                    disabled={removing === l.id}
                    onClick={() => setConfirm(l)}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 pointer-coarse:size-[44px]"
                  >
                    {removing === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </button>
                )}
              </li>
            );
          })}
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-2 px-3 py-2" aria-busy="true">
              <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.name}</p>
                <div
                  role="progressbar"
                  aria-label={t("Uploading {name}", { name: u.name })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={u.pct}
                  className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${u.pct}%` }} />
                </div>
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{u.pct}% · {humanSize(u.size)}</p>
              </div>
              <button
                type="button"
                aria-label={t("Cancel upload")}
                onClick={() => u.abort.abort()}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-[44px]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form onSubmit={(e) => { e.preventDefault(); addLink(); }} className="grid gap-2 sm:grid-cols-[8.5rem_1fr]">
          <select aria-label={t("Link type")} value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm pointer-coarse:min-h-[44px]">
            {LINK_TYPES.map((k) => <option key={k} value={k}>{labels.link(k)}</option>)}
          </select>
          <div className="relative">
            <Link2 aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input aria-label={t("Link")} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("Paste a link (https://…)")} className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2.5 text-sm pointer-coarse:min-h-[44px]" />
          </div>
          <input aria-label={t("Document name")} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("Document name (optional)")} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm sm:col-start-2 pointer-coarse:min-h-[44px]" />
          <div className="flex flex-wrap items-center gap-2 sm:col-start-2">
            <button type="submit" disabled={!url.trim()} className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40 pointer-coarse:min-h-[44px]">
              <Plus className="h-3.5 w-3.5" /> {t("Add link")}
            </button>
            <button
              type="button"
              onClick={() => picker.current?.click()}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]"
            >
              <Paperclip className="h-3.5 w-3.5" /> {t("Attach file")}
            </button>
            <span className="text-xs text-muted-foreground">{t("or drop files here")}</span>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={(e) => { attach(Array.from(e.target.files ?? [])); e.target.value = ""; }}
            />
          </div>
        </form>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent lang={lang}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remove {name}?", { name: confirm ? nameOf(confirm) : "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("It leaves this deal for everyone. The deal's history keeps a note of it.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const doc = confirm;
                setConfirm(null);
                if (doc) void remove(doc);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("Remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
