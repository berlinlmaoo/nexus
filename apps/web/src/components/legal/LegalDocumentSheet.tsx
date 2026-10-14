import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, CornerDownRight, Download, FileDown, FilePlus2, FileSignature, GitBranch, Loader2, Lock, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NewDocumentDialog } from "@/components/legal/NewDocumentDialog";
import { Segmented } from "@/components/PageLayout";
import { LegalDocumentEditor } from "@/components/legal/LegalDocumentEditor";
import { LegalGideonPanel } from "@/components/legal/LegalGideonPanel";
import { LegalDiffView } from "@/components/legal/LegalDiffView";
import { LegalLinkPicker } from "@/components/legal/LegalLinkPicker";
import { docTypeLabel, fmtDay, formatBytes, statusClass, statusLabel, versionKindLabel } from "@/components/legal/legal-labels";
import { fmtDate } from "@/lib/nexus-api";
import { LEGAL_STATUSES, legalDocsApi, legalVersionsApi, type LegalDocument, type LegalDocumentVersion, type LegalStatus } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/** The statuses a person may pick for a document now (owner, 14 Oct 2026): VOID is one-way, SIGNED is locked
 *  and only voided, and a generated document becomes SIGNED only by uploading its signed copy. */
export function statusChoices(doc: Pick<LegalDocument, "status" | "source">): LegalStatus[] {
  if (doc.status === "VOID") return ["VOID"];
  if (doc.status === "SIGNED") return ["SIGNED", "VOID"];
  return LEGAL_STATUSES.filter((s) => s !== "SIGNED" || doc.source === "UPLOADED");
}

/** One legal document: its archive fields, its files, and every version of it. */
export function LegalDocumentSheet({ documentId, onClose, onOpen, onShowChain }: {
  documentId: string | null;
  onClose: () => void;
  /** Open another document (its parent, an addendum, the one that reused its number). */
  onOpen?: (id: string) => void;
  /** Show this chain (a document and its addenda) in the archive. */
  onShowChain?: (parentId: string) => void;
}) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["legal", "document", documentId],
    queryFn: () => legalDocsApi.get(documentId!),
    enabled: !!documentId,
    // The server makes a new Word version's PDF after it answers; look again until it is there (3 min at most).
    refetchInterval: (query) => {
      const versions = query.state.data?.document.versions ?? [];
      const waiting = versions.some((v) => v.hasDocx && !v.hasPdf && Date.now() - Date.parse(v.createdAt) < 180_000);
      return waiting ? 4000 : false;
    },
  });
  const doc = q.data?.document;
  const [draft, setDraft] = useState({ title: "", counterparty: "", notes: "" });
  const [view, setView] = useState<"overview" | "edit" | "compare">("overview");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [addendumOpen, setAddendumOpen] = useState(false);
  useEffect(() => { setView("overview"); setSelected(new Set()); }, [documentId]);
  useEffect(() => { setSelected(new Set()); }, [doc?.currentVersion]);
  const toggle = (i: number) => setSelected((cur) => { const n = new Set(cur); if (n.has(i)) n.delete(i); else n.add(i); return n; });
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
  // Once signed, the signed copy is the primary file; the generated FINAL stays in the list below.
  const shownVersion = doc ? doc.versions.find((v) => v.version === (doc.signedVersion ?? doc.finalVersion ?? doc.currentVersion)) ?? doc.versions[0] : undefined;
  const locked = doc?.status === "SIGNED";
  useEffect(() => { if ((locked || doc?.status === "VOID") && view === "edit") setView("overview"); }, [locked, doc?.status, view]);
  const changeStatus = (s: LegalStatus) => {
    if (!doc || s === doc.status) return;
    if (s === "VOID") setConfirmVoid(true);
    else update.mutate({ status: s });
  };
  // Voiding gives the number back only when the document holds one and was never signed.
  const releasesNumber = !!doc && doc.hasNumber && !doc.signedAt;

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
              <div className={cn("font-mono text-xs text-muted-foreground", doc.numberReleased && "line-through")}>{doc.number || t("No number")}</div>
              <SheetTitle className="pr-6">{doc.title}</SheetTitle>
              <SheetDescription>
                {docTypeLabel(doc.docType)} · {doc.company.name} · {fmtDay(doc.docDate, lang)}
                {doc.template ? ` · ${t("from {name} v{v}", { name: doc.template.name, v: doc.template.version })}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap items-center gap-2">
              {/* One control (UI tour run 10, WD-2): the status chip is itself the dropdown. A chip next to a
                  dropdown said the same word twice. Void is final, so it stays a plain chip. */}
              {doc.status === "VOID" ? (
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", statusClass(doc.status))}>{statusLabel(doc.status)}</span>
              ) : (
                <Select value={doc.status} onValueChange={(v) => changeStatus(v as LegalStatus)}>
                  <SelectTrigger aria-label={t("Status")}
                    className={cn("h-7 w-auto gap-1 rounded-full border-0 px-2.5 py-1 text-xs font-medium shadow-none hover:brightness-95 dark:hover:brightness-125", statusClass(doc.status))}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>{statusChoices(doc).map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {shownVersion && <FileButtons doc={doc} v={shownVersion} onMakePdf={() => makePdf.mutate(shownVersion.version)} making={makePdf.isPending} />}
              {(doc.status === "FINAL" || doc.status === "SENT") && <SignedCopyButton doc={doc} onDone={() => { void q.refetch(); void qc.invalidateQueries({ queryKey: ["legal", "documents"] }); }} />}
              {doc.status === "SIGNED" && (
                <Button variant="outline" size="default" className="gap-1.5" onClick={() => setAddendumOpen(true)}><FilePlus2 className="h-4 w-4" /> {t("Create addendum")}</Button>
              )}
            </div>
            <DocumentFacts doc={doc} onOpen={onOpen} onShowChain={onShowChain} />

            <Segmented
              label={t("Document view")}
              value={view}
              onChange={setView}
              options={[
                { key: "overview" as const, label: t("Overview") },
                ...(doc.versions.some((v) => v.hasDocx) && !locked && doc.status !== "VOID" ? [{ key: "edit" as const, label: t("Review & edit") }] : []),
                ...(doc.versions.filter((v) => v.hasDocx).length > 1 ? [{ key: "compare" as const, label: t("Compare") }] : []),
              ]}
            />

            {view === "edit" && (doc.versions.find((v) => v.version === doc.currentVersion)?.hasDocx
              ? (
                <div className="space-y-4">
                  <LegalGideonPanel doc={doc} selected={selected} onClearSelection={() => setSelected(new Set())} />
                  <LegalDocumentEditor doc={doc} selected={selected} onSelect={toggle} />
                </div>
              )
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

            <div className="space-y-1.5">
              <Label>{t("Belongs to")}</Label>
              <LegalLinkPicker
                value={doc.deal ? { kind: "deal", id: doc.deal.id, label: `${doc.deal.code} · ${doc.deal.name}` } : doc.project ? { kind: "project", id: doc.project.id, label: doc.project.name } : null}
                onChange={(v) => update.mutate(v?.kind === "deal" ? { dealId: v.id, projectId: null } : v?.kind === "project" ? { projectId: v.id, dealId: null } : { projectId: null, dealId: null })}
                placeholder={doc.linkHidden ? t("Linked to a project you can't open") : undefined}
              />
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t("Versions")}</h3>
                {locked ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" /> {t("Signed: locked")}</span>
                ) : doc.status !== "VOID" && (
                  <UploadVersionButton doc={doc} onDone={() => { void q.refetch(); void qc.invalidateQueries({ queryKey: ["legal", "documents"] }); }} />
                )}
              </div>
              <ul className="divide-y divide-border rounded-md border border-border">
                {doc.versions.map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-8 shrink-0 font-medium">v{v.version}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        {versionKindLabel(v.kind)}{v.note ? ` — ${v.note}` : ""}
                        <span className="ml-1.5 rounded bg-muted px-1.5 font-mono text-[10px] text-muted-foreground" title={v.downloadName}>{v.label}</span>
                        {doc.signedVersion === v.version && <span className="ml-1.5 rounded bg-emerald-500/10 px-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">{t("Signed copy")}</span>}
                        {doc.finalVersion === v.version && <span className="ml-1.5 rounded bg-primary/10 px-1.5 text-[10px] font-medium text-primary">{t("Final")}</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{v.author?.name ?? "—"} · {fmtDate(v.createdAt)} · {formatBytes(v.size)}</div>
                    </div>
                    <FileButtons doc={doc} v={v} compact onMakePdf={() => makePdf.mutate(v.version)} making={makePdf.isPending} />
                    {!locked && doc.status !== "VOID" && doc.finalVersion !== v.version && (
                      <Button variant="ghost" size="sm" className="gap-1.5" title={t("Final DOCX/PDF come from this version")}
                        onClick={() => update.mutate({ finalVersion: v.version, ...(doc.status === "DRAFT" ? { status: "FINAL" as LegalStatus } : {}) })}>
                        <CheckCircle2 className="h-4 w-4" /> <span className="max-sm:hidden">{t("Mark final")}</span>
                      </Button>
                    )}
                    {!locked && doc.status !== "VOID" && v.version !== doc.currentVersion && (
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
        {doc && (
          <AlertDialog open={confirmVoid} onOpenChange={setConfirmVoid}>
            <AlertDialogContent lang={lang}>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("Void {number}?", { number: doc.number || doc.title })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {releasesNumber
                    ? t("Void can't be undone. The number {number} will be reused by the next document of this series.", { number: doc.number })
                    : doc.signedAt
                      ? t("Void can't be undone. This document was signed, so its number stays retired and is never reused.")
                      : t("Void can't be undone.")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => update.mutate({ status: "VOID" })}>{t("Void document")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {doc && (
          <NewDocumentDialog open={addendumOpen} onOpenChange={setAddendumOpen} parent={{ id: doc.id, number: doc.number, title: doc.title }}
            onCreated={(id) => { void q.refetch(); onOpen?.(id); }} />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Signed by whom and when, the void and its number, the parent and the addenda. */
function DocumentFacts({ doc, onOpen, onShowChain }: { doc: LegalDocument; onOpen?: (id: string) => void; onShowChain?: (parentId: string) => void }) {
  const { t, lang } = useLang();
  const link = (d: { id: string; number: string; title: string }) => (
    <button type="button" className="font-mono text-primary hover:underline" onClick={() => onOpen?.(d.id)}>{d.number || d.title}</button>
  );
  const rows: ReactNode[] = [];
  if (doc.signedAt) {
    rows.push(<span key="signed" className="inline-flex items-center gap-1.5"><FileSignature className="h-3.5 w-3.5 text-emerald-600" /> {t("Signed copy uploaded {date} by {name}", { date: fmtDate(doc.signedAt), name: doc.signedBy?.name ?? "—" })}</span>);
  }
  if (doc.status === "VOID") {
    rows.push(
      <span key="void">
        {doc.numberReusedBy ? <>{t("Void — number reused by")} {link(doc.numberReusedBy)}</>
          : doc.numberReleased ? t("Void — the number is free for the next document of this series")
            : doc.signedAt ? t("Void — signed, so the number is never reused") : t("Void")}
      </span>,
    );
  }
  for (const from of doc.numberReusedFrom) rows.push(<span key={`from-${from.id}`}>{t("Number reused from void document")} {link(from)}</span>);
  if (doc.parent) {
    rows.push(
      <span key="parent" className="inline-flex flex-wrap items-center gap-1.5">
        <CornerDownRight className="h-3.5 w-3.5" /> {t("Addendum {n} to", { n: doc.addendumNo ?? "—" })} {link(doc.parent)}
        {onShowChain && <button type="button" className="text-primary hover:underline" onClick={() => onShowChain(doc.parent!.id)}>· {t("Show the chain")}</button>}
      </span>,
    );
  }
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      {rows.length > 0 && <div className="flex flex-col gap-1">{rows}</div>}
      {doc.addenda.length > 0 && (
        <div className="space-y-1 rounded-md border border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground"><GitBranch className="h-3.5 w-3.5" /> {t("Addenda")}</span>
            {onShowChain && <button type="button" className="text-primary hover:underline" onClick={() => onShowChain(doc.id)}>{t("Show the chain")}</button>}
          </div>
          <ul className="space-y-1">
            {doc.addenda.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <button type="button" className={cn("font-mono text-primary hover:underline", a.numberReleased && "line-through")} onClick={() => onOpen?.(a.id)}>{a.number}</button>
                <span className="min-w-0 flex-1 truncate">{a.title} · {fmtDay(a.docDate, lang)}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusClass(a.status))}>{statusLabel(a.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** "Upload signed copy" on a FINAL / SENT document: a PDF or photo; it becomes SIGNED and is locked. */
function SignedCopyButton({ doc, onDone }: { doc: LegalDocument; onDone: () => void }) {
  const { t } = useLang();
  const upload = useMutation({
    mutationFn: (file: File) => legalVersionsApi.uploadVersion(doc.id, doc.currentVersion, file, "", "SIGNED"),
    onSuccess: () => { toast.success(t("Signed copy uploaded. The document is now signed and locked.")); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-accent" title={t("A PDF or a photo of the signed document")}>
      {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />} {t("Upload signed copy")}
      <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
    </label>
  );
}

function FileButtons({ doc, v, compact, onMakePdf, making }: { doc: LegalDocument; v: LegalDocumentVersion; compact?: boolean; onMakePdf: () => void; making: boolean }) {
  const { t } = useLang();
  const size = compact ? "sm" : "default";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {v.hasDocx && (
        <Button asChild variant="outline" size={size} className="gap-1.5">
          <a href={legalDocsApi.fileUrl(doc.id, v.version, "docx")} download={`${v.downloadName}.docx`}><Download className="h-4 w-4" /> DOCX</a>
        </Button>
      )}
      {v.hasPdf ? (
        <Button asChild variant="outline" size={size} className="gap-1.5">
          <a href={legalDocsApi.fileUrl(doc.id, v.version, "pdf")} download={`${v.downloadName}.pdf`}><FileDown className="h-4 w-4" /> PDF</a>
        </Button>
      ) : v.hasDocx ? (
        <Button variant="ghost" size={size} className="gap-1.5" disabled={making} onClick={onMakePdf}>
          {making ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {t("Make PDF")}
        </Button>
      ) : null}
      {v.hasFile && (
        <Button asChild variant="outline" size={size} className="gap-1.5">
          <a href={legalDocsApi.fileUrl(doc.id, v.version, "original")} download={v.downloadName}><Download className="h-4 w-4" /> {t("File")}</a>
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
    mutationFn: (file: File) => legalVersionsApi.uploadVersion(doc.id, doc.currentVersion, file, ""),
    onSuccess: (res) => { toast.success(t("Uploaded as version {n}", { n: res.version })); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent" title={t("The file edited in Word, or a scan")}>
      {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {t("Upload new version")}
      <input type="file" accept=".pdf,.docx,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
    </label>
  );
}
