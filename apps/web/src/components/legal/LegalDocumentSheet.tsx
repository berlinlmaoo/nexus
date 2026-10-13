import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Download, FileDown, Loader2, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Segmented } from "@/components/PageLayout";
import { LegalDocumentEditor } from "@/components/legal/LegalDocumentEditor";
import { LegalDiffView } from "@/components/legal/LegalDiffView";
import { docTypeLabel, fmtDay, formatBytes, statusClass, statusLabel, versionKindLabel } from "@/components/legal/legal-labels";
import { fmtDate } from "@/lib/nexus-api";
import { LEGAL_STATUSES, legalDocsApi, legalVersionsApi, type LegalDocument, type LegalDocumentVersion, type LegalStatus } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/** One legal document: its archive fields, its files, and every version of it. */
export function LegalDocumentSheet({ documentId, onClose }: { documentId: string | null; onClose: () => void }) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["legal", "document", documentId], queryFn: () => legalDocsApi.get(documentId!), enabled: !!documentId });
  const doc = q.data?.document;
  const [draft, setDraft] = useState({ title: "", counterparty: "", notes: "" });
  const [view, setView] = useState<"overview" | "edit" | "compare">("overview");
  useEffect(() => { setView("overview"); }, [documentId]);
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

  const restore = useMutation({
    mutationFn: (version: number) => legalVersionsApi.restore(doc!.id, version, doc!.currentVersion),
    onSuccess: (res) => { void q.refetch(); void qc.invalidateQueries({ queryKey: ["legal", "documents"] }); toast.success(t("Restored as version {n}", { n: res.version })); },
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

            <Segmented
              label={t("Document view")}
              value={view}
              onChange={setView}
              options={[
                { key: "overview" as const, label: t("Overview") },
                ...(doc.versions.some((v) => v.hasDocx) ? [{ key: "edit" as const, label: t("Review & edit") }] : []),
                ...(doc.versions.filter((v) => v.hasDocx).length > 1 ? [{ key: "compare" as const, label: t("Compare") }] : []),
              ]}
            />

            {view === "edit" && (doc.versions.find((v) => v.version === doc.currentVersion)?.hasDocx
              ? <LegalDocumentEditor doc={doc} />
              : <p className="text-sm text-muted-foreground">{t("The current version is not a Word file, so it can't be edited here. Restore a Word version to edit it.")}</p>)}
            {view === "compare" && <CompareVersions doc={doc} />}

            {view === "overview" && <>
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
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t("Versions")}</h3>
                <UploadVersionButton doc={doc} onDone={() => { void q.refetch(); void qc.invalidateQueries({ queryKey: ["legal", "documents"] }); }} />
              </div>
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
                    {doc.finalVersion !== v.version && (
                      <Button variant="ghost" size="sm" className="gap-1.5" title={t("Final DOCX/PDF come from this version")}
                        onClick={() => update.mutate({ finalVersion: v.version, ...(doc.status === "DRAFT" ? { status: "FINAL" as LegalStatus } : {}) })}>
                        <CheckCircle2 className="h-4 w-4" /> <span className="max-sm:hidden">{t("Mark final")}</span>
                      </Button>
                    )}
                    {v.version !== doc.currentVersion && (
                      <Button variant="ghost" size="sm" className="gap-1.5" disabled={restore.isPending} onClick={() => restore.mutate(v.version)}>
                        <RotateCcw className="h-4 w-4" /> <span className="max-sm:hidden">{t("Restore")}</span>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            </>}
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

function CompareVersions({ doc }: { doc: LegalDocument }) {
  const { t } = useLang();
  const word = doc.versions.filter((v) => v.hasDocx).map((v) => v.version).sort((a, b) => a - b);
  const [a, setA] = useState(word[word.length - 2] ?? word[0]);
  const [b, setB] = useState(word[word.length - 1]);
  const q = useQuery({ queryKey: ["legal", "compare", doc.id, a, b], queryFn: () => legalVersionsApi.compare(doc.id, a, b), enabled: a !== b });
  const pick = (value: number, set: (v: number) => void) => (
    <Select value={String(value)} onValueChange={(v) => set(Number(v))}>
      <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
      <SelectContent>{word.map((v) => <SelectItem key={v} value={String(v)}>v{v}</SelectItem>)}</SelectContent>
    </Select>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">{pick(a, setA)} <span className="text-muted-foreground">→</span> {pick(b, setB)}</div>
      {a === b ? <p className="text-sm text-muted-foreground">{t("Pick two different versions.")}</p>
        : q.isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
          : q.isError ? <p className="text-sm text-destructive">{(q.error as Error).message}</p>
            : q.data ? <LegalDiffView diff={q.data.diff} /> : null}
    </div>
  );
}

function UploadVersionButton({ doc, onDone }: { doc: LegalDocument; onDone: () => void }) {
  const { t } = useLang();
  const upload = useMutation({
    mutationFn: (file: File) => legalVersionsApi.uploadVersion(doc.id, doc.currentVersion, file, "", /\.pdf$|\.jpe?g$|\.png$/i.test(file.name) ? "SIGNED" : undefined),
    onSuccess: (res) => { toast.success(t("Uploaded as version {n}", { n: res.version })); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent" title={t("A signed scan, or the file edited in Word")}>
      {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {t("Upload new version")}
      <input type="file" accept=".pdf,.docx,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
    </label>
  );
}
