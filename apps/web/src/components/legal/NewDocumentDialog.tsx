import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, FileText, Hash, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LegalFieldInput, type FieldValues } from "@/components/legal/LegalFieldInput";
import { LegalLinkPicker, type LegalLink } from "@/components/legal/LegalLinkPicker";
import { docTypeLabel } from "@/components/legal/legal-labels";
import { ADDENDUM_DOC_TYPE, fieldErrorsOf, legalDocsApi, legalTemplatesApi, templateProblems, type LegalTemplate } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";

const todayJakarta = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

/** Field names a number format reads ({KOTA} → KOTA), so the preview refreshes only when they change. */
const formatFields = (format: string) => [...format.matchAll(/\{([A-Z][A-Z0-9_]*)(?::\d)?\}/g)].map((m) => m[1]).filter((n) => !["SEQ", "ROMAWI", "MM", "BLN", "YYYY", "YY", "CO"].includes(n));

/**
 * New document (owner, 14 Oct 2026): pick a template (and the company, when the template is for any
 * company) → the form made from its {{PLACEHOLDERS}} → the number is taken only when it is generated.
 */
export function NewDocumentDialog({ open, onOpenChange, onCreated, parent, fromRequest }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
  /** Create addendum: the signed document it amends. Only addendum templates are offered; company, kop
   *  and number follow the parent, and the form starts filled from it. */
  parent?: { id: string; number: string; title: string } | null;
  /** "Create document" from a Legal request (owner, 14 Oct 2026): its template and company are picked, the
   *  form starts with what the requester filled, and the document is linked to the request. */
  fromRequest?: { requestId: string; templateId: string | null; companyId: string; values: Record<string, unknown>; link: LegalLink } | null;
}) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const [template, setTemplate] = useState<LegalTemplate | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [values, setValues] = useState<FieldValues>({});
  const [title, setTitle] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [link, setLink] = useState<LegalLink>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<string[]>([]);

  const templates = useQuery({ queryKey: ["legal", "templates", { archived: false }], queryFn: () => legalTemplatesApi.list({}), enabled: open });
  const companies = useQuery({ queryKey: ["legal", "companies"], queryFn: legalTemplatesApi.companies, enabled: open, staleTime: 60_000 });

  useEffect(() => {
    if (!open) { setTemplate(null); setCompanyId(null); setStep("pick"); setValues({}); setTitle(""); setCounterparty(""); setLink(null); setErrors({}); setProblems([]); }
  }, [open]);

  // From a request: its template and company, straight to the form (a template archived since stays on Pick).
  const [requestApplied, setRequestApplied] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !fromRequest || requestApplied === fromRequest.requestId || !templates.data) return;
    const tpl = templates.data.templates.find((x) => x.id === fromRequest.templateId);
    setRequestApplied(fromRequest.requestId);
    setLink(fromRequest.link);
    setCompanyId(tpl?.company?.id ?? fromRequest.companyId);
    if (tpl) { setTemplate(tpl); setStep("form"); }
  }, [open, fromRequest, requestApplied, templates.data]);
  useEffect(() => { if (!open) setRequestApplied(null); }, [open]);

  const effectiveCompany = template?.company?.id ?? companyId;
  const form = useQuery({
    queryKey: ["legal", "prepare", template?.id, effectiveCompany],
    queryFn: () => legalDocsApi.prepare({ templateId: template!.id, companyId: effectiveCompany, parentDocumentId: parent?.id ?? null }),
    enabled: step === "form" && !!template && (!!effectiveCompany || !!parent),
  });
  const fields = form.data?.fields ?? [];

  // Default the document date to today once the form is known (and an addendum's parties from its parent).
  useEffect(() => {
    // From a request, what the requester filled wins over the parent's parties; the date is Legal's call.
    if (form.data && values.TANGGAL_DOKUMEN === undefined) setValues((v) => ({ ...(form.data.prefill as FieldValues), ...((fromRequest?.values ?? {}) as FieldValues), ...v, TANGGAL_DOKUMEN: todayJakarta() }));
  }, [form.data, values.TANGGAL_DOKUMEN, fromRequest?.values]);

  const numberInputs = useMemo(() => {
    const names = ["TANGGAL_DOKUMEN", ...formatFields(form.data?.series?.format ?? "")];
    return Object.fromEntries(names.map((n) => [n, values[n]]));
  }, [form.data?.series?.format, values]);
  const [debounced, setDebounced] = useState(numberInputs);
  useEffect(() => { const h = setTimeout(() => setDebounced(numberInputs), 400); return () => clearTimeout(h); }, [numberInputs]);
  const preview = useQuery({
    queryKey: ["legal", "number-preview", template?.id, effectiveCompany, debounced],
    queryFn: () => legalDocsApi.prepare({ templateId: template!.id, companyId: effectiveCompany, values: debounced, parentDocumentId: parent?.id ?? null }),
    enabled: step === "form" && !!form.data,
    placeholderData: (prev) => prev,
  });

  const generate = useMutation({
    mutationFn: () => legalDocsApi.generate({ templateId: template!.id, companyId: effectiveCompany, values, title: title.trim() || undefined, counterparty: counterparty.trim() || undefined, projectId: link?.kind === "project" ? link.id : null, dealId: link?.kind === "deal" ? link.id : null, parentDocumentId: parent?.id ?? null, requestId: fromRequest?.requestId ?? null }),
    onSuccess: (res) => {
      toast.success(t("Document {number} made", { number: res.number }));
      if (res.pdfError) toast.warning(t("The PDF couldn't be made yet: {reason}", { reason: res.pdfError }));
      void qc.invalidateQueries({ queryKey: ["legal", "documents"] });
      if (fromRequest) void qc.invalidateQueries({ queryKey: ["legal", "requests"] });
      onOpenChange(false);
      onCreated(res.id);
    },
    onError: (e: Error) => {
      // Someone else (or another tab) made this request's document a moment ago (race audit 16 Oct 2026,
      // H5): nothing was numbered here. Show theirs instead of a bare error.
      if ((e as { payload?: { code?: string } }).payload?.code === "LEGAL_REQUEST_HAS_DOCUMENT") {
        toast.error(t("This request already has a document — someone made it a moment ago. Open it from the request."));
        void qc.invalidateQueries({ queryKey: ["legal", "requests"] });
        void qc.invalidateQueries({ queryKey: ["legal", "documents"] });
        onOpenChange(false);
        return;
      }
      const fe = fieldErrorsOf(e);
      const pr = templateProblems(e);
      setErrors(fe);
      setProblems(pr);
      if (!Object.keys(fe).length && !pr.length) toast.error(e.message);
      else toast.error(t("Some fields need attention"));
    },
  });

  // Addendum templates only from a signed document; the rest only from New document.
  const list = (templates.data?.templates ?? []).filter((tpl) => (tpl.docType === ADDENDUM_DOC_TYPE) === !!parent);
  useEffect(() => { if (parent && open && !template && list.length === 1) setTemplate(list[0]); }, [parent, open, template, list]);
  const activeCompanies = (companies.data?.companies ?? []).filter((c) => c.active);
  const canContinue = !!template && (!!parent || !!(template.company?.id ?? companyId));
  const extraErrors = Object.entries(errors).filter(([k]) => !fields.some((f) => k === f.name || k.startsWith(`${f.name}.`)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent lang={lang} className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{parent ? t("Create addendum") : t("New document")}</DialogTitle>
          <DialogDescription>
            {step === "pick"
              ? parent ? t("Addendum to {number}. Pick the addendum template.", { number: parent.number }) : t("Pick the template and the company that issues it.")
              : `${template?.name} · ${form.data?.company.name ?? ""}`}
          </DialogDescription>
        </DialogHeader>

        {step === "pick" ? (
          <div className="space-y-4">
            {templates.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">{parent ? t("No addendum template yet. Upload one with the type Addendum in the Templates tab first.") : t("No templates yet. Upload one in the Templates tab first.")}</p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {list.map((tpl) => (
                  <li key={tpl.id}>
                    <button type="button" onClick={() => { setTemplate(tpl); setCompanyId(tpl.company?.id ?? null); }}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left ${template?.id === tpl.id ? "bg-primary/10" : "hover:bg-accent/50"}`}>
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{tpl.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{docTypeLabel(tpl.docType)} · {tpl.company?.name ?? t("Any company")}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {template && !template.company && !parent && (
              <div className="space-y-1.5">
                <Label>{t("Issuing company")}</Label>
                <Select value={companyId ?? undefined} onValueChange={setCompanyId}>
                  <SelectTrigger><SelectValue placeholder={t("Pick a company")} /></SelectTrigger>
                  <SelectContent>{activeCompanies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
        ) : form.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
        ) : form.isError ? (
          <p className="py-4 text-sm text-destructive">{(form.error as Error).message}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <Hash className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-mono">{preview.data?.numberPreview ?? form.data?.numberPreview}</div>
                <div className="text-xs text-muted-foreground">
                  {form.data?.parent
                    ? t("Addendum {n} to {number}. The number is taken only when you generate.", { n: form.data.parent.addendumNo, number: form.data.parent.number })
                    : t("Next number in {series}. It is taken only when you generate.", { series: form.data?.series?.label ?? "" })}
                </div>
              </div>
            </div>
            {!form.data?.company.hasKop && (
              <p className="flex items-center gap-1.5 text-xs text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> {t("This company has no kop yet: the document will have no letterhead.")}</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="legal-new-title">{t("Title in the archive")}</Label>
                <Input id="legal-new-title" value={title} placeholder={template?.name} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="legal-new-cp">{t("Counterparty")}</Label>
                <Input id="legal-new-cp" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder={t("Who the document is with")} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Belongs to")}</Label>
                <LegalLinkPicker value={link} onChange={setLink} />
              </div>
            </div>
            <div className="space-y-3 border-t border-border pt-3">
              {fields.map((f) => (
                <LegalFieldInput key={f.name} field={f} value={values[f.name]} errors={errors} path={f.name}
                  onChange={(v) => { setValues((cur) => ({ ...cur, [f.name]: v })); if (errors[f.name]) setErrors(({ [f.name]: _drop, ...rest }) => rest); }} />
              ))}
            </div>
            {(problems.length > 0 || extraErrors.length > 0) && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <ul className="list-disc space-y-0.5 pl-5">
                  {problems.map((p) => <li key={p}>{p}</li>)}
                  {extraErrors.map(([k, v]) => <li key={k}>{k}: {t(v)}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "form" && (
            <Button variant="ghost" className="mr-auto gap-1.5" onClick={() => { setStep("pick"); setErrors({}); setProblems([]); }}>
              <ArrowLeft className="h-4 w-4" /> {t("Back")}
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          {step === "pick" ? (
            <Button disabled={!canContinue} onClick={() => setStep("form")}>{t("Continue")}</Button>
          ) : (
            <Button disabled={!form.data || generate.isPending} onClick={() => generate.mutate()} className="gap-1.5">
              {generate.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Generate")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
