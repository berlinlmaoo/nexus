import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Archive, ArchiveRestore, ChevronDown, Download, FileText, Loader2, Upload } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtDate } from "@/lib/nexus-api";
import {
  LEGAL_DOC_TYPES, legalTemplatesApi, templateProblems,
  type LegalCompany, type LegalTemplate, type TemplateField,
} from "@/lib/legal-api";
import { docTypeLabel, fieldTypeLabel, formatBytes, SCALAR_FIELD_TYPES } from "@/components/legal/legal-labels";
import { useLang } from "@/lib/lang";

const NONE = "__none";

/**
 * Templates (owner, 14 Oct 2026): a .docx with {{PLACEHOLDERS}} uploaded here; the server finds the fields,
 * and each upload of the same template is a new version. Documents keep the version they were made from.
 */
export function LegalTemplates() {
  const { t } = useLang();
  const [showArchived, setShowArchived] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const templates = useQuery({ queryKey: ["legal", "templates", { archived: showArchived }], queryFn: () => legalTemplatesApi.list({ archived: showArchived }) });
  const companies = useQuery({ queryKey: ["legal", "companies"], queryFn: legalTemplatesApi.companies, staleTime: 60_000 });
  const rows = templates.data?.templates ?? [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t("Templates")}</h2>
          <p className="text-sm text-muted-foreground">{t("Word files with {{PLACEHOLDERS}}. The form for a new document is made from them.")}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} /> {t("Show archived")}
          </label>
          <Button onClick={() => setUploadOpen(true)} className="gap-1.5"><Upload className="h-4 w-4" /> {t("Upload template")}</Button>
        </div>
      </div>

      {templates.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
      ) : templates.isError ? (
        <p className="py-6 text-sm text-destructive">{(templates.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title={t("No templates yet")} message={t("Upload a Word file with {{PLACEHOLDERS}} to start making documents.")} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((tpl) => (
            <li key={tpl.id}>
              <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/50" onClick={() => setOpenId(tpl.id)}>
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{tpl.name}</span>
                    {tpl.archived && <Badge variant="outline">{t("Archived")}</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {docTypeLabel(tpl.docType)} · {tpl.company?.name ?? t("Any company")} · v{tpl.currentVersion} · {t("{n} fields", { n: tpl.fields.length })}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground max-sm:hidden">{fmtDate(tpl.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <PlaceholderHelp />
      <UploadTemplateDialog open={uploadOpen} onOpenChange={setUploadOpen} companies={companies.data?.companies ?? []} onCreated={(id) => setOpenId(id)} />
      <TemplateSheet templateId={openId} onClose={() => setOpenId(null)} companies={companies.data?.companies ?? []} />
    </section>
  );
}

function ProblemList({ problems }: { problems: string[] }) {
  const { t } = useLang();
  if (!problems.length) return null;
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-destructive"><AlertTriangle className="h-4 w-4" /> {t("Fix these in the Word file and upload again:")}</div>
      <ul className="list-disc space-y-0.5 pl-5 text-destructive/90">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
    </div>
  );
}

function CompanySeriesPickers({ companies, docType, companyId, seriesId, onCompany, onSeries }: {
  companies: LegalCompany[];
  docType: string;
  companyId: string | null;
  seriesId: string | null;
  onCompany: (id: string | null) => void;
  onSeries: (id: string | null) => void;
}) {
  const { t } = useLang();
  const company = companies.find((c) => c.id === companyId);
  const series = (company?.series ?? []).filter((s) => s.active && (!docType || s.docType === docType));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>{t("Company")}</Label>
        <Select value={companyId ?? NONE} onValueChange={(v) => { onCompany(v === NONE ? null : v); onSeries(null); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("Any company")}</SelectItem>
            {companies.filter((c) => c.active).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>{t("Numbering")}</Label>
        <Select value={seriesId ?? NONE} onValueChange={(v) => onSeries(v === NONE ? null : v)} disabled={!company}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("The company's series for this type")}</SelectItem>
            {series.map((s) => <SelectItem key={s.id} value={s.id}>{s.label} — {s.format}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function UploadTemplateDialog({ open, onOpenChange, companies, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companies: LegalCompany[];
  onCreated: (id: string) => void;
}) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [docType, setDocType] = useState<string>("");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    if (!open) { setFile(null); setName(""); setDocType(""); setCompanyId(null); setSeriesId(null); setDescription(""); setProblems([]); }
  }, [open]);

  const create = useMutation({
    mutationFn: () => legalTemplatesApi.create({ file: file!, name: name.trim(), docType, companyId, seriesId, description: description.trim() }),
    onSuccess: ({ template }) => {
      toast.success(t("Template uploaded: {n} fields found", { n: template.fields.length }));
      void qc.invalidateQueries({ queryKey: ["legal", "templates"] });
      onOpenChange(false);
      onCreated(template.id);
    },
    onError: (e: Error) => {
      const list = templateProblems(e);
      setProblems(list);
      if (!list.length) toast.error(e.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent lang={lang} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Upload template")}</DialogTitle>
          <DialogDescription>{t("A .docx with {{PLACEHOLDERS}} where the values go. The fields are found automatically.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="legal-tpl-file">{t("Word file")}</Label>
            <Input id="legal-tpl-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setProblems([]);
                if (f && !name) setName(f.name.replace(/\.docx$/i, "").replace(/[_]+/g, " "));
              }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="legal-tpl-name">{t("Name")}</Label>
            <Input id="legal-tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("Document type")}</Label>
            <Select value={docType || undefined} onValueChange={(v) => { setDocType(v); setSeriesId(null); }}>
              <SelectTrigger><SelectValue placeholder={t("Pick a type")} /></SelectTrigger>
              <SelectContent>{LEGAL_DOC_TYPES.map((d) => <SelectItem key={d} value={d}>{docTypeLabel(d)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <CompanySeriesPickers companies={companies} docType={docType} companyId={companyId} seriesId={seriesId} onCompany={setCompanyId} onSeries={setSeriesId} />
          <div className="space-y-1.5">
            <Label htmlFor="legal-tpl-desc">{t("Description (optional)")}</Label>
            <Textarea id="legal-tpl-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <ProblemList problems={problems} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button disabled={!file || !name.trim() || !docType || create.isPending} onClick={() => create.mutate()} className="gap-1.5">
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateSheet({ templateId, onClose, companies }: { templateId: string | null; onClose: () => void; companies: LegalCompany[] }) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["legal", "template", templateId], queryFn: () => legalTemplatesApi.get(templateId!), enabled: !!templateId });
  const tpl = q.data?.template;
  const [draft, setDraft] = useState<{ name: string; description: string; docType: string; companyId: string | null; seriesId: string | null; fields: TemplateField[] } | null>(null);
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionNote, setVersionNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    if (tpl) setDraft({ name: tpl.name, description: tpl.description, docType: tpl.docType, companyId: tpl.company?.id ?? null, seriesId: tpl.series?.id ?? null, fields: tpl.fields });
    setProblems([]);
  }, [tpl]);

  const refresh = (template: LegalTemplate) => {
    qc.setQueryData(["legal", "template", template.id], { template });
    void qc.invalidateQueries({ queryKey: ["legal", "templates"] });
  };
  const save = useMutation({
    mutationFn: () => legalTemplatesApi.update(tpl!.id, { name: draft!.name.trim(), description: draft!.description, docType: draft!.docType, companyId: draft!.companyId, seriesId: draft!.seriesId, fields: draft!.fields }),
    onSuccess: ({ template }) => { refresh(template); toast.success(t("Saved")); },
    onError: (e: Error) => toast.error(e.message),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => legalTemplatesApi.update(tpl!.id, { archived }),
    onSuccess: ({ template }) => { refresh(template); toast.success(template.archived ? t("Template archived") : t("Template restored")); },
    onError: (e: Error) => toast.error(e.message),
  });
  const addVersion = useMutation({
    mutationFn: () => legalTemplatesApi.addVersion(tpl!.id, versionFile!, versionNote.trim()),
    onSuccess: ({ template }) => {
      refresh(template);
      setVersionFile(null);
      setVersionNote("");
      setProblems([]);
      toast.success(t("Version {n} uploaded", { n: template.currentVersion }));
    },
    onError: (e: Error) => { const list = templateProblems(e); setProblems(list); if (!list.length) toast.error(e.message); },
  });

  const dirty = useMemo(() => {
    if (!tpl || !draft) return false;
    return draft.name !== tpl.name || draft.description !== tpl.description || draft.docType !== tpl.docType || draft.companyId !== (tpl.company?.id ?? null) || draft.seriesId !== (tpl.series?.id ?? null) || JSON.stringify(draft.fields) !== JSON.stringify(tpl.fields);
  }, [tpl, draft]);

  const setField = (path: number[], patch: Partial<TemplateField>) => {
    setDraft((d) => {
      if (!d) return d;
      const update = (list: TemplateField[], [i, ...rest]: number[]): TemplateField[] =>
        list.map((f, j) => (j !== i ? f : rest.length ? { ...f, columns: update(f.columns ?? [], rest) } : { ...f, ...patch }));
      return { ...d, fields: update(d.fields, path) };
    });
  };

  return (
    <Sheet open={!!templateId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent lang={lang} className="w-full overflow-y-auto sm:max-w-2xl">
        {!tpl || !draft ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
        ) : (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle>{tpl.name}</SheetTitle>
              <SheetDescription>{docTypeLabel(tpl.docType)} · v{tpl.currentVersion}{tpl.archived ? ` · ${t("Archived")}` : ""}</SheetDescription>
            </SheetHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t("Name")}</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Document type")}</Label>
                <Select value={draft.docType} onValueChange={(v) => setDraft({ ...draft, docType: v, seriesId: null })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LEGAL_DOC_TYPES.map((d) => <SelectItem key={d} value={d}>{docTypeLabel(d)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <CompanySeriesPickers companies={companies} docType={draft.docType} companyId={draft.companyId} seriesId={draft.seriesId}
                onCompany={(id) => setDraft((d) => (d ? { ...d, companyId: id, seriesId: null } : d))}
                onSeries={(id) => setDraft((d) => (d ? { ...d, seriesId: id } : d))} />
              <div className="space-y-1.5">
                <Label>{t("Description (optional)")}</Label>
                <Textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t("Form fields")}</h3>
              <p className="text-xs text-muted-foreground">{t("Found in the file. Change how each is asked; adding or removing a field means uploading a new version.")}</p>
              <FieldEditor fields={draft.fields} path={[]} onChange={setField} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button disabled={!dirty || !draft.name.trim() || save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} {t("Save")}
              </Button>
              <Button variant="outline" className="gap-1.5" disabled={archive.isPending} onClick={() => archive.mutate(!tpl.archived)}>
                {tpl.archived ? <><ArchiveRestore className="h-4 w-4" /> {t("Restore")}</> : <><Archive className="h-4 w-4" /> {t("Archive")}</>}
              </Button>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">{t("Versions")}</h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {tpl.versions.map((v) => (
                  <li key={v.version} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-8 shrink-0 font-medium">v{v.version}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{v.fileName} <span className="text-xs text-muted-foreground">· {formatBytes(v.size)} · {t("{n} fields", { n: v.fieldCount })}</span></div>
                      <div className="truncate text-xs text-muted-foreground">{v.createdBy?.name ?? "—"} · {fmtDate(v.createdAt)}{v.note ? ` · ${v.note}` : ""}</div>
                    </div>
                    <a href={legalTemplatesApi.fileUrl(tpl.id, v.version)} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent" aria-label={t("Download")} title={t("Download")}>
                      <Download className="h-4 w-4" />
                    </a>
                  </li>
                ))}
              </ul>
              <div className="space-y-2 rounded-md border border-dashed border-border p-3">
                <Label>{t("Upload a new version")}</Label>
                <Input type="file" accept=".docx" onChange={(e) => { setVersionFile(e.target.files?.[0] ?? null); setProblems([]); }} />
                <Input placeholder={t("What changed (optional)")} value={versionNote} onChange={(e) => setVersionNote(e.target.value)} />
                <ProblemList problems={problems} />
                <Button size="sm" variant="outline" disabled={!versionFile || addVersion.isPending} onClick={() => addVersion.mutate()} className="gap-1.5">
                  {addVersion.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {t("Upload")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FieldEditor({ fields, path, onChange }: { fields: TemplateField[]; path: number[]; onChange: (path: number[], patch: Partial<TemplateField>) => void }) {
  const { t } = useLang();
  return (
    <ul className="space-y-2">
      {fields.map((f, i) => {
        const locked = f.name === "TANGGAL_DOKUMEN";
        const scalar = f.type !== "list" && f.type !== "boolean";
        return (
          <li key={f.name} className="rounded-md border border-border p-2.5">
            <div className="mb-1.5 font-mono text-[11px] text-muted-foreground">{`{{${f.name}}}`}</div>
            <div className="grid gap-2 sm:grid-cols-[1fr_11rem_auto] sm:items-center">
              <Input value={f.label} onChange={(e) => onChange([...path, i], { label: e.target.value })} aria-label={t("Label")} />
              {scalar && !locked ? (
                <Select value={f.type} onValueChange={(v) => onChange([...path, i], { type: v as TemplateField["type"] })}>
                  <SelectTrigger aria-label={t("Type")}><SelectValue /></SelectTrigger>
                  <SelectContent>{SCALAR_FIELD_TYPES.map((ft) => <SelectItem key={ft} value={ft}>{fieldTypeLabel(ft)}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <span className="px-1 text-sm text-muted-foreground">{fieldTypeLabel(f.type)}</span>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={f.required} disabled={locked} onCheckedChange={(v) => onChange([...path, i], { required: v })} /> {t("Required")}
              </label>
            </div>
            {f.type === "select" && (
              <Input className="mt-2" placeholder={t("Choices, separated by commas")} value={(f.options ?? []).join(", ")}
                onChange={(e) => onChange([...path, i], { options: e.target.value.split(",").map((o) => o.trimStart()) })} />
            )}
            {f.columns && (
              <div className="mt-2 border-l-2 border-border pl-3">
                <div className="mb-1 text-xs text-muted-foreground">{t("Columns of each row")}</div>
                <FieldEditor fields={f.columns} path={[...path, i]} onChange={onChange} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PlaceholderHelp() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const rows: [string, string][] = [
    ["{{NAMA_PIHAK_KEDUA}}", t("A value from the form")],
    ["{{TANGGAL_TTD | hari}}", "Rabu"],
    ["{{TANGGAL_TTD | tanggal}}", "30 September 2026"],
    ["{{TANGGAL_TTD | tgl}} {{TANGGAL_TTD | bulan}}", "30 September"],
    ["{{TANGGAL_TTD | tahun_terbilang}}", "Dua Ribu Dua Puluh Enam"],
    ["{{HONOR | rupiah}}", "Rp. 25.000.000,00"],
    ["{{HONOR | terbilang_rupiah | upper}}", "DUA PULUH LIMA JUTA RUPIAH"],
    ["{{#BARANG}} … {{NAMA_BARANG}} … {{/BARANG}}", t("Repeats for each row (e.g. a table row)")],
    ["{{#PAKAI_MATERAI}} … {{/PAKAI_MATERAI}}", t("Shown only when ticked")],
    ["{{NOMOR}}", t("The document number, filled automatically")],
    ["{{TANGGAL_DOKUMEN}}", t("The document date (asked in every form)")],
    ["{{PT_PERUSAHAAN}} {{ALAMAT_PERUSAHAAN}}", t("The issuing company's legal name and address")],
  ];
  return (
    <div className="rounded-lg border border-border">
      <button className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium" onClick={() => setOpen((v) => !v)}>
        {t("How to write placeholders")}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <table className="w-full border-t border-border text-sm">
          <tbody>
            {rows.map(([code, out]) => (
              <tr key={code} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5 font-mono text-xs">{code}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{out}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
