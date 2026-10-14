import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, FileText, Link2Off, Loader2, LogIn, Paperclip, Scale, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LegalFieldInput, type FieldValues } from "@/components/legal/LegalFieldInput";
import { LegalLinkPicker, type LegalLink } from "@/components/legal/LegalLinkPicker";
import { docTypeLabel, formatBytes } from "@/components/legal/legal-labels";
import { ApiError } from "@/lib/nexus-api";
import { fieldErrorsOf } from "@/lib/legal-api";
import { legalRequestsApi, type RequestFormInfo } from "@/lib/legal-requests-api";
import { useLang } from "@/lib/lang";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * The Legal request form (owner, 14 Oct 2026), behind a link only: /f/legal-<token>. Anyone with the link may
 * open it, but must sign in to NEXUS to send, so the request can be followed in My Submissions. The
 * requester picks the document type (and the company, unless the link fixes it) and fills what they know;
 * every field is optional, Legal completes the rest. An addendum request types the parent's number as text.
 * `fallback`: what to show when the server doesn't know this link as a Legal one (a form with that slug).
 */
export function LegalRequestPage({ linkId, fallback }: { linkId: string; fallback: ReactNode }) {
  const { t, lang } = useLang();
  const info = useQuery({ queryKey: ["legal-request-form", linkId], queryFn: () => legalRequestsApi.form(linkId), retry: false });
  const err = info.error as ApiError | undefined;
  const unknown = err?.status === 404 && (err.payload as { code?: string } | undefined)?.code === "LEGAL_LINK_UNKNOWN";
  const loginUrl = `/login?callbackUrl=${encodeURIComponent(`/f/${linkId}`)}`;
  const company = info.data?.link.company;

  if (unknown && fallback) return <>{fallback}</>;
  return (
    <div lang={lang} className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-5 pb-16 pt-10 sm:px-10 sm:pt-14">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden><Scale className="h-6 w-6" /></div>
        <h1 className="mt-4 font-display text-[28px] font-bold leading-tight tracking-tight sm:text-[34px]">{t("Legal request")}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          {company ? t("Ask Legal for a document of {company}. Fill in what you know; Legal completes the rest.", { company: company.name }) : t("Ask Legal for a document. Fill in what you know; Legal completes the rest.")}
        </p>

        {info.isLoading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {info.isError && (
          <Notice icon={unknown ? Link2Off : FileText} title={unknown ? t("This link doesn't work any more") : t("Couldn't open the form")}
            message={unknown ? t("Ask Legal for the current link.") : (err?.message ?? "")} />
        )}
        {info.data && !info.data.link.accepting && (
          <Notice icon={Clock} title={t("This link isn't accepting requests right now")} message={t("Ask Legal when it opens again, or for another link.")} />
        )}
        {info.data && info.data.link.accepting && !info.data.signedIn && (
          <div className="mt-8 rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">{t("Sign in to NEXUS before you send this request, so you can follow it in My Submissions.")}</p>
            <a href={loginUrl} className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.99]">
              <LogIn className="h-4 w-4" /> {t("Sign in to send")}
            </a>
          </div>
        )}
        {info.data && info.data.link.accepting && info.data.signedIn && <RequestForm linkId={linkId} info={info.data} />}
      </div>
    </div>
  );
}

function Notice({ icon: Icon, title, message }: { icon: typeof Clock; title: string; message: string }) {
  return (
    <div className="mt-8 flex flex-col items-center rounded-xl border border-border px-6 py-10 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden><Icon className="h-5 w-5" /></div>
      <div className="font-semibold">{title}</div>
      {message && <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}

function RequestForm({ linkId, info }: { linkId: string; info: RequestFormInfo }) {
  const { t } = useLang();
  const locked = info.link.company;
  const companies = info.companies ?? [];
  const [companyId, setCompanyId] = useState<string | null>(locked?.id ?? (companies.length === 1 ? companies[0].id : null));
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [parentNumber, setParentNumber] = useState("");
  const [purpose, setPurpose] = useState("");
  const [deadline, setDeadline] = useState("");
  const [link, setLink] = useState<LegalLink>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const key = useRef(newKey());
  const fileInput = useRef<HTMLInputElement>(null);

  const templates = useMemo(
    () => (info.templates ?? []).filter((tpl) => !tpl.companyId || !companyId || tpl.companyId === companyId),
    [info.templates, companyId],
  );
  const template = templates.find((tpl) => tpl.id === templateId) ?? null;

  const send = useMutation({
    mutationFn: () =>
      legalRequestsApi.send(linkId, {
        templateId, companyId, values, purpose: purpose.trim(), deadline: deadline || null,
        projectId: link?.kind === "project" ? link.id : null, dealId: link?.kind === "deal" ? link.id : null,
        ...(template?.isAddendum ? { parentNumber: parentNumber.trim() } : {}),
      }, files, key.current),
    onSuccess: (res) => setSentId(res.id),
    onError: (e: Error) => {
      const fe = fieldErrorsOf(e);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? t("Some fields need attention") : e.message);
    },
  });

  const addFiles = (list: FileList | null) => {
    setFileError(null);
    const picked = Array.from(list ?? []);
    const tooBig = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) { setFileError(t("{name} is larger than 50 MB", { name: tooBig.name })); return; }
    const next = [...files, ...picked].slice(0, MAX_FILES);
    if (files.length + picked.length > MAX_FILES) setFileError(t("At most {n} files", { n: MAX_FILES }));
    setFiles(next);
  };

  const reset = () => {
    key.current = newKey();
    setTemplateId(null); setValues({}); setParentNumber(""); setPurpose(""); setDeadline(""); setLink(null); setFiles([]);
    setErrors({}); setFormError(null); setSentId(null);
    if (!locked) setCompanyId(companies.length === 1 ? companies[0].id : null);
  };

  if (sentId) {
    return (
      <div className="mt-8 flex flex-col items-center rounded-xl border border-border px-6 py-10 text-center">
        <CheckCircle2 className="mb-3 h-10 w-10 text-emerald-600" aria-hidden />
        <div className="text-lg font-semibold">{t("Request sent")}</div>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("Legal has it now. Follow it in My Submissions: you'll get a notification when it moves, and you can download the final document there.")}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link to="/submissions" search={{ legal: sentId }} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">{t("Open My Submissions")}</Link>
          <Button variant="outline" size="sm" onClick={reset}>{t("Send another request")}</Button>
        </div>
      </div>
    );
  }

  const canSend = !!templateId && !!companyId && (!template?.isAddendum || !!parentNumber.trim()) && !send.isPending;
  return (
    <form className="mt-8 space-y-6" onSubmit={(e) => { e.preventDefault(); if (canSend) send.mutate(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("Company")}</Label>
          {locked ? (
            <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm">{locked.name}</div>
          ) : (
            <Select value={companyId ?? undefined} onValueChange={(v) => { setCompanyId(v); setTemplateId(null); setValues({}); }}>
              <SelectTrigger aria-invalid={!!errors.companyId}><SelectValue placeholder={t("Pick a company")} /></SelectTrigger>
              <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>{t("Document type")}</Label>
          <Select value={templateId ?? undefined} onValueChange={(v) => { setTemplateId(v); setValues({}); setErrors({}); }} disabled={!companyId}>
            <SelectTrigger aria-invalid={!!errors.templateId}><SelectValue placeholder={companyId ? t("Pick a document type") : t("Pick the company first")} /></SelectTrigger>
            <SelectContent>
              {templates.map((tpl) => (
                <SelectItem key={tpl.id} value={tpl.id}>{tpl.name} <span className="text-muted-foreground">· {docTypeLabel(tpl.docType)}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
          {companyId && templates.length === 0 && <p className="text-xs text-muted-foreground">{t("Legal has no document types for this company yet.")}</p>}
        </div>
      </div>

      {template && (
        <>
          {template.description && <p className="text-sm text-muted-foreground">{template.description}</p>}
          {template.isAddendum && (
            <div className="space-y-1.5">
              <Label htmlFor="lr-parent">{t("Number of the document to amend")} <span className="text-destructive">*</span></Label>
              <Input id="lr-parent" value={parentNumber} onChange={(e) => setParentNumber(e.target.value)} maxLength={200} aria-invalid={!!errors.parentNumber}
                placeholder={t("As printed on the signed document")} />
              <p className="text-xs text-muted-foreground">{t("Type it as printed on the signed document. Legal checks it and finds the document.")}</p>
            </div>
          )}
          {template.fields.length > 0 && (
            <section className="space-y-3 rounded-xl border border-border p-4">
              <div>
                <div className="text-sm font-semibold">{t("Details for the document")}</div>
                <p className="text-xs text-muted-foreground">{t("All optional. Fill in what you know; Legal completes the rest.")}</p>
              </div>
              {template.fields.map((f) => (
                <LegalFieldInput key={f.name} field={f} value={values[f.name]} errors={errors} path={f.name} hideName
                  onChange={(v) => { setValues((cur) => ({ ...cur, [f.name]: v })); if (errors[f.name]) setErrors(({ [f.name]: _drop, ...rest }) => rest); }} />
              ))}
            </section>
          )}
        </>
      )}

      <section className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="lr-purpose">{t("Purpose and notes")}</Label>
          <Textarea id="lr-purpose" rows={4} value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={5000}
            placeholder={t("What the document is for, who it is with, anything Legal should know")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="lr-deadline">{t("Needed by")}</Label>
            <Input id="lr-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-invalid={!!errors.deadline} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("Related project or deal")}</Label>
            <LegalLinkPicker value={link} onChange={setLink} size="default" search={legalRequestsApi.links} placeholder={t("None")} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>{t("Attachments")}</Label>
          <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          {files.length > 0 && (
            <ul className="space-y-1.5">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                  <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive" aria-label={t("Remove {name}", { name: f.name })}
                    onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          {files.length < MAX_FILES && (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileInput.current?.click()}>
              <Paperclip className="h-4 w-4" /> {t("Attach files")}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t("PDF, Word or photos (JPG, PNG). Up to {n} files, 50 MB each.", { n: MAX_FILES })}</p>
          {fileError && <p className="text-xs text-destructive">{fileError}</p>}
        </div>
      </section>

      {formError && <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{formError}</p>}
      <Button type="submit" disabled={!canSend} className="w-full gap-1.5 sm:w-auto">
        {send.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Send request")}
      </Button>
    </form>
  );
}
