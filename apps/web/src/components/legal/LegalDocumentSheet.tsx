import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileDown, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { docTypeLabel, fmtDay, formatBytes, statusClass, statusLabel, versionKindLabel } from "@/components/legal/legal-labels";
import { fmtDate } from "@/lib/nexus-api";
import { LEGAL_STATUSES, legalDocsApi, type LegalDocument, type LegalDocumentVersion, type LegalStatus } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/** One legal document: its archive fields, its files, and every version of it. */
export function LegalDocumentSheet({ documentId, onClose }: { documentId: string | null; onClose: () => void }) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["legal", "document", documentId], queryFn: () => legalDocsApi.get(documentId!), enabled: !!documentId });
  const doc = q.data?.document;
  const [draft, setDraft] = useState({ title: "", counterparty: "", notes: "" });
  useEffect(() => { if (doc) setDraft({ title: doc.title, counterparty: doc.counterparty, notes: doc.notes }); }, [doc]);

  const refresh = (d: LegalDocument) => {
    qc.setQueryData(["legal", "document", d.id], { document: d });
    void qc.invalidateQueries({ queryKey: ["legal", "documents"] });
  };
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof legalDocsApi.update>[1]) => legalDocsApi.update(doc!.id, patch),
    onSuccess: ({ document }) => { refresh(document); toast.success(t("Saved")); },
    onError: (e: Error) => toast.error(e.message),
  });
  const makePdf = useMutation({
    mutationFn: (version: number) => legalDocsApi.makePdf(doc!.id, version),
    onSuccess: () => { void q.refetch(); toast.success(t("PDF made")); },
    onError: (e: Error) => toast.error(e.message),
  });

  const dirty = !!doc && (draft.title !== doc.title || draft.counterparty !== doc.counterparty || draft.notes !== doc.notes);
  const shownVersion = doc ? doc.versions.find((v) => v.version === (doc.finalVersion ?? doc.currentVersion)) ?? doc.versions[0] : undefined;

  return (
    <Sheet open={!!documentId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent lang={lang} className="w-full overflow-y-auto sm:max-w-3xl">
        {!doc ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            {q.isError ? <span className="text-destructive">{(q.error as Error).message}</span> : <><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</>}
          </div>
        ) : (
          <div className="space-y-5">
            <SheetHeader>
              <div className="font-mono text-xs text-muted-foreground">{doc.number || t("No number")}</div>
              <SheetTitle className="pr-6">{doc.title}</SheetTitle>
              <SheetDescription>
                {docTypeLabel(doc.docType)} · {doc.company.name} · {fmtDay(doc.docDate, lang)}
                {doc.template ? ` · ${t("from {name} v{v}", { name: doc.template.name, v: doc.template.version })}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", statusClass(doc.status))}>{statusLabel(doc.status)}</span>
              <Select value={doc.status} onValueChange={(v) => update.mutate({ status: v as LegalStatus })}>
                <SelectTrigger className="h-8 w-40" aria-label={t("Status")}><SelectValue /></SelectTrigger>
                <SelectContent>{LEGAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}</SelectContent>
              </Select>
              {shownVersion && <FileButtons doc={doc} v={shownVersion} onMakePdf={() => makePdf.mutate(shownVersion.version)} making={makePdf.isPending} />}
            </div>

            {shownVersion?.hasPdf && (
              <iframe title={doc.title} src={legalDocsApi.fileUrl(doc.id, shownVersion.version, "pdf", true)} className="h-[60vh] w-full rounded-md border border-border bg-muted" />
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("Title")}</Label>
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Counterparty")}</Label>
                <Input value={draft.counterparty} onChange={(e) => setDraft({ ...draft, counterparty: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Notes")}</Label>
                <Textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
              </div>
            </div>
            <Button disabled={!dirty || !draft.title.trim() || update.isPending} onClick={() => update.mutate(draft)}>{t("Save")}</Button>

            <div className="space-y-2 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">{t("Versions")}</h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {doc.versions.map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-8 shrink-0 font-medium">v{v.version}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        {versionKindLabel(v.kind)}{v.note ? ` — ${v.note}` : ""}
                        {doc.finalVersion === v.version && <span className="ml-1.5 rounded bg-primary/10 px-1.5 text-[10px] font-medium text-primary">{t("Final")}</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{v.author?.name ?? "—"} · {fmtDate(v.createdAt)} · {formatBytes(v.size)}</div>
                    </div>
                    <FileButtons doc={doc} v={v} compact onMakePdf={() => makePdf.mutate(v.version)} making={makePdf.isPending} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FileButtons({ doc, v, compact, onMakePdf, making }: { doc: LegalDocument; v: LegalDocumentVersion; compact?: boolean; onMakePdf: () => void; making: boolean }) {
  const { t } = useLang();
  const size = compact ? "sm" : "default";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {v.hasDocx && (
        <Button asChild variant="outline" size={size} className="gap-1.5">
          <a href={legalDocsApi.fileUrl(doc.id, v.version, "docx")}><Download className="h-4 w-4" /> DOCX</a>
        </Button>
      )}
      {v.hasPdf ? (
        <Button asChild variant="outline" size={size} className="gap-1.5">
          <a href={legalDocsApi.fileUrl(doc.id, v.version, "pdf")}><FileDown className="h-4 w-4" /> PDF</a>
        </Button>
      ) : v.hasDocx ? (
        <Button variant="ghost" size={size} className="gap-1.5" disabled={making} onClick={onMakePdf}>
          {making ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {t("Make PDF")}
        </Button>
      ) : null}
      {v.hasFile && (
        <Button asChild variant="outline" size={size} className="gap-1.5">
          <a href={legalDocsApi.fileUrl(doc.id, v.version, "original")}><Download className="h-4 w-4" /> {t("File")}</a>
        </Button>
      )}
    </div>
  );
}
