import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Eye, Loader2, Lock, Paperclip, RotateCcw } from "lucide-react";
import type { NexusFormBranding } from "@/lib/nexus-api";
import { DateField } from "@/components/DateField";
import { RupiahInput } from "@/components/RupiahInput";
import { thumbUrl } from "@/lib/thumb";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { answerProblem, coverCss, evalCond, fieldTitle, isFilled, optionsOf, type RichField } from "./form-model";

/**
 * The form as a respondent sees it: the public page /f/:id and the builder's Preview render this same
 * component, so the preview is the page. Notion-like: an optional cover band and emoji, a big title,
 * then the questions as plain blocks (no card per question) and a send button.
 *
 * Sizes follow the CONTAINER (`@container`, `@lg:` = wider than a phone), so the builder's phone
 * preview frame lays out like a phone even on a desktop screen.
 */

export type RendererForm = {
  name: string;
  description?: string | null;
  fields: RichField[];
  branding?: NexusFormBranding | null;
  settings?: { confirmationTitle?: string; confirmationMessage?: string; submitLabel?: string } | null;
};
type Me = { name?: string | null; email?: string | null; avatar?: string | null } | null | undefined;

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[15px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/40 disabled:cursor-default disabled:opacity-100";

/** One question's input. `disabled` = the builder canvas (looks real, takes no input). */
export function QuestionControl({ field, value, onChange, disabled, attachment, onAttachment }: {
  field: RichField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  attachment?: unknown;
  onAttachment?: (f: File | "") => void;
}) {
  const { t, tn } = useLang();
  const label = fieldTitle(field) || t("Question");
  const opts = optionsOf(field).filter((o) => o.trim());
  let control: React.ReactNode;
  if (field.type === "textarea") {
    control = <textarea disabled={disabled} required={field.required} rows={4} placeholder={field.placeholder || t("Your answer")} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "resize-y")} />;
  } else if ((field.type === "dropdown" || field.type === "select") && field.display === "list") {
    control = (
      <div role="radiogroup" aria-label={label} className="space-y-0.5">
        {(opts.length ? opts : [t("Option")]).map((o, i) => (
          <label key={`${i}:${o}`} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[15px]", !disabled && "cursor-pointer hover:bg-muted/60")}>
            <input type="radio" disabled={disabled} name={field.id} checked={value === o} onChange={() => onChange(o)} className="h-4 w-4 shrink-0 accent-ring" />
            <span className="min-w-0 break-words">{o}</span>
          </label>
        ))}
      </div>
    );
  } else if (field.type === "dropdown" || field.type === "select") {
    control = (
      <select disabled={disabled} required={field.required} aria-label={label} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "appearance-auto")}>
        <option value="">{t("Choose…")}</option>
        {opts.map((o, i) => <option key={`${i}:${o}`} value={o}>{o}</option>)}
      </select>
    );
  } else if (field.type === "multi_select") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    control = (
      <div role="group" aria-label={label} className="space-y-0.5">
        {(opts.length ? opts : [t("Option")]).map((o, i) => (
          <label key={`${i}:${o}`} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[15px]", !disabled && "cursor-pointer hover:bg-muted/60")}>
            <input type="checkbox" disabled={disabled} checked={arr.includes(o)} onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} className="h-4 w-4 shrink-0 rounded accent-ring" />
            <span className="min-w-0 break-words">{o}</span>
          </label>
        ))}
      </div>
    );
  } else if (field.type === "checkbox") {
    control = null; // drawn by QuestionBlock next to the title
  } else if (field.type === "file") {
    control = (
      <label className={cn("flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground", !disabled && "cursor-pointer transition-colors hover:border-foreground/40")}>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-medium text-foreground"><Paperclip className="h-3.5 w-3.5" /> {t("Upload")}</span>
        {/* The hint wraps (a phone cut it to "One or more files, up t…", UI tour run 7); a file name stays on one line. */}
        <span className={cn("min-w-0", (Array.isArray(value) && value.length) || value instanceof File ? "truncate" : "leading-snug")}>{Array.isArray(value) && value.length ? tn(value.length, "{n} file selected", "{n} files selected") : value instanceof File ? value.name : t("One or more files, up to 50 MB each")}</span>
        <input type="file" multiple disabled={disabled} required={field.required} className="hidden" onChange={(e) => onChange(Array.from(e.target.files ?? []))} />
      </label>
    );
  } else if (field.type === "number" && field.numberFormat === "currency-idr") {
    control = disabled
      // The builder's canvas: the same "Rp" box as the live form, empty (UI tour run 14, R14-WB-1).
      ? <div className="relative"><span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm font-semibold text-muted-foreground">Rp</span><input disabled value="" className={cn(inputCls, "pl-8")} aria-label={label} /></div>
      : <RupiahInput required={field.required} value={String(value ?? "")} onChange={(digits) => onChange(digits)} className={inputCls} ariaLabel={label} />;
  } else if (field.autofill) {
    control = (
      <div className="relative">
        <input readOnly disabled={disabled} value={String(value ?? "")} placeholder={field.autofill === "email" ? t("Your account's email") : t("Your account's name")} aria-label={label} className={cn(inputCls, "cursor-not-allowed bg-muted/50 pr-9 text-muted-foreground")} />
        <Lock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
      </div>
    );
  } else if (field.type === "date") {
    control = disabled
      ? <input disabled placeholder={t("Pick a date")} className={inputCls} aria-label={label} />
      : <DateField value={value ? String(value) : null} onChange={(v) => onChange(v ?? "")} ariaLabel={label} placeholder={field.placeholder || t("Pick a date")} className={cn(inputCls, "h-auto hover:bg-background")} />;
  } else {
    const type = field.type === "email" ? "email" : field.type === "number" ? "number" : field.type === "phone" ? "tel" : field.type === "url" ? "url" : "text";
    const ph = field.placeholder || (field.type === "email" ? "name@company.com" : field.type === "phone" ? "08xx xxxx xxxx" : field.type === "url" ? "https://" : field.type === "number" ? "0" : t("Your answer"));
    control = <input disabled={disabled} required={field.required} type={type} inputMode={field.type === "phone" ? "tel" : undefined} placeholder={ph} aria-label={label} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
  }
  return (
    <>
      {control}
      {field.autofill && <p className="mt-1.5 text-xs text-muted-foreground">{t("Filled in from your account")}</p>}
      {field.attachmentEnabled && field.type !== "file" && (
        <label className={cn("mt-2 inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground", !disabled && "cursor-pointer transition-colors hover:text-foreground")}>
          <Paperclip className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{attachment instanceof File ? attachment.name : t("Attach a file (optional)")}</span>
          <input type="file" disabled={disabled} className="hidden" onChange={(e) => onAttachment?.(e.target.files?.[0] ?? "")} />
        </label>
      )}
    </>
  );
}

/** Title + description + control, the way the page shows one question. */
export function QuestionBlock({ field, value, onChange, disabled, attachment, onAttachment }: Parameters<typeof QuestionControl>[0]) {
  const { t } = useLang();
  const title = fieldTitle(field) || t("Question");
  if (field.type === "checkbox") {
    return (
      <div>
        <label className={cn("flex items-start gap-2.5 text-[15px] font-semibold", !disabled && "cursor-pointer")}>
          <input type="checkbox" disabled={disabled} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-ring" />
          <span className="min-w-0 break-words">{title}{field.required && <span className="text-destructive"> *</span>}</span>
        </label>
        {field.description && <p className="mt-1 whitespace-pre-line pl-[26px] text-sm text-muted-foreground">{field.description}</p>}
      </div>
    );
  }
  return (
    <div>
      <div className="text-[15px] font-semibold break-words">{title}{field.required && <span className="text-destructive"> *</span>}</div>
      {field.description && <p className="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">{field.description}</p>}
      <div className="mt-2.5"><QuestionControl field={field} value={value} onChange={onChange} disabled={disabled} attachment={attachment} onAttachment={onAttachment} /></div>
    </div>
  );
}

/** Cover band + emoji + title + description: the head of the page (and of the builder canvas). */
export function FormHead({ branding, children }: { branding?: NexusFormBranding | null; children: React.ReactNode }) {
  const cover = coverCss(branding?.cover);
  return (
    <>
      {cover && <div aria-hidden className="h-32 w-full @lg:h-44" style={{ background: cover }} />}
      <div className="mx-auto w-full max-w-2xl px-5 @lg:px-10">
        {branding?.icon
          ? <div className={cn("select-none text-[52px] leading-none @lg:text-[64px]", cover ? "-mt-8 @lg:-mt-10" : "pt-10 @lg:pt-14")}>{branding.icon}</div>
          : <div className={cover ? "pt-6" : "pt-10 @lg:pt-14"} />}
        {children}
      </div>
    </>
  );
}

export function FormRenderer({ form, formKey, me, mode = "live" }: {
  form: RendererForm;
  /** Id or slug used to send (live mode). */
  formKey?: string;
  me?: Me;
  mode?: "live" | "preview";
}) {
  const { t } = useLang();
  const fields = form.fields;
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [done, setDone] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const set = (id: string, v: unknown) => setValues((cur) => ({ ...cur, [id]: v }));

  // Autofill fields prefill from the signed-in account (the server re-applies them on send, anti-spoof).
  // Also called by "Send another response", which starts from empty answers.
  const fillFromAccount = useCallback(() => {
    if (!me) return;
    setValues((cur) => {
      let changed = false;
      const next = { ...cur };
      for (const fld of fields) {
        if (!fld.autofill) continue;
        const want = fld.autofill === "email" ? (me.email ?? "") : (me.name ?? "");
        if (cur[fld.id] !== want) { next[fld.id] = want; changed = true; }
      }
      return changed ? next : cur;
    });
  }, [me, fields]);
  useEffect(() => { fillFromAccount(); }, [fillFromAccount]);

  const visible = useMemo(() => fields.filter((field) => evalCond(field.showIf, values)), [fields, values]);
  const missing = visible.filter((x) => x.required && !isFilled(values[x.id]));
  // Answers that are there but can't be right (an email without "@", a link without a domain).
  const invalid = visible.filter((x) => answerProblem(x, values[x.id]));

  // One response per press of Send: a ref (not the mutation's isPending, which lags a render) blocks a
  // double click, and the attempt's key lets the server drop a repeat that still got through (a retry
  // after a lost reply). "Send another response" starts a new attempt.
  const sending = useRef(false);
  const attemptKey = useRef<string>("");
  const newAttemptKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const submit = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      const data: Record<string, unknown> = {};
      for (const field of visible) {
        const v = values[field.id];
        if (field.type === "file") {
          // Each file goes under the same `file:<id>` key; the route turns them all into task attachments.
          const files = Array.isArray(v) ? (v as File[]) : v instanceof File ? [v] : [];
          data[field.id] = files.map((f) => f.name).join(", ");
          for (const f of files) fd.append(`file:${field.id}`, f);
        } else {
          data[field.id] = v ?? "";
        }
        const att = values[`attachment:${field.id}`];
        if (field.attachmentEnabled && att instanceof File) {
          data[`attachment:${field.id}`] = att.name;
          fd.append(`attachment:${field.id}`, att);
        }
      }
      fd.append("data", JSON.stringify(data));
      if (!attemptKey.current) attemptKey.current = newAttemptKey();
      const res = await fetch(`/api/forms/${formKey}/submit`, { method: "POST", body: fd, headers: { "Idempotency-Key": attemptKey.current, "X-Nexus-Client": "web/1" } });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || t("Couldn't send the form. Try again."));
      }
      return res.json().catch(() => ({}));
    },
    onSuccess: () => setDone(true),
    onSettled: () => { sending.current = false; },
  });

  const send = () => {
    if (sending.current) return;
    if (missing.length || invalid.length) { setShowMissing(true); return; }
    if (mode === "preview") { setDone(true); return; }
    sending.current = true;
    submit.mutate();
  };
  const again = () => {
    setValues({});
    fillFromAccount();
    attemptKey.current = "";
    setDone(false); setShowMissing(false); submit.reset();
  };
  const s = form.settings ?? null;

  if (done) {
    return (
      <div className="@container min-h-full bg-background text-foreground">
        <div className="mx-auto flex min-h-[60vh] w-full max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
          <CheckCircle2 className="mb-4 h-11 w-11 text-success" />
          <h1 className="font-display text-2xl font-bold tracking-tight text-balance">{s?.confirmationTitle || t("Sent. Thank you!")}</h1>
          <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{s?.confirmationMessage || t("Your answer to “{name}” was received.", { name: form.name })}</p>
          {mode === "preview" && <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"><Eye className="h-3.5 w-3.5" /> {t("Preview: nothing was sent.")}</p>}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={again} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-accent"><RotateCcw className="h-3.5 w-3.5" /> {t("Send another response")}</button>
            {mode === "live" && <Link to="/submissions" className="inline-flex items-center rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">{t("Open My Submissions")}</Link>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="@container min-h-full bg-background text-foreground">
      <FormHead branding={form.branding}>
        <h1 className="mt-4 font-display text-[28px] font-bold leading-tight tracking-tight text-balance @lg:text-[34px]">{form.name || t("Untitled form")}</h1>
        {form.description && <p className="mt-2 whitespace-pre-line text-[15px] text-muted-foreground">{form.description}</p>}

        {me && (
          <div className="mt-5 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-muted/40 py-1 pl-1 pr-3 text-xs">
            {me.avatar
              ? <img src={thumbUrl(me.avatar, 40)} loading="lazy" decoding="async" alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
              : <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold">{(me.name ?? me.email ?? "?").slice(0, 1).toUpperCase()}</span>}
            <span className="truncate text-muted-foreground">{t("Sending as")} <span className="font-semibold text-foreground">{me.name ?? me.email}</span></span>
          </div>
        )}

        <form className="mt-8 space-y-8 pb-6" noValidate onSubmit={(e) => { e.preventDefault(); send(); }}>
          {visible.map((field) => (
            <div key={field.id} className={cn(showMissing && (missing.includes(field) || invalid.includes(field)) && "rounded-lg ring-2 ring-destructive/40 ring-offset-8 ring-offset-background")}>
              <QuestionBlock field={field} value={values[field.id]} onChange={(v) => set(field.id, v)} attachment={values[`attachment:${field.id}`]} onAttachment={(f) => set(`attachment:${field.id}`, f)} />
              {showMissing && invalid.includes(field) && <p className="mt-1.5 text-xs font-medium text-destructive">{answerProblem(field, values[field.id]) === "email" ? t("Enter an email address, like name@company.com.") : t("Enter a web address, like company.com.")}</p>}
            </div>
          ))}
          {visible.length === 0 && <p className="text-sm text-muted-foreground">{t("This form has no questions yet.")}</p>}
          <div className="pt-2">
            <button type="submit" disabled={submit.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50 @lg:w-auto">
              {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {s?.submitLabel || t("Send")}
            </button>
            {showMissing && missing.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{t("Fill in the required fields first")} <span className="text-destructive">*</span>: <span className="font-semibold text-foreground">{missing.map((f) => fieldTitle(f) || t("Question")).join(", ")}</span></p>}
            {submit.isError && <p className="mt-3 text-xs font-semibold text-destructive">{(submit.error as Error)?.message || t("Couldn't send the form. Try again.")}</p>}
          </div>
        </form>
        <p className="pb-10 pt-6 text-xs text-muted-foreground">{t("Powered by NEXUS Phaëthon")}</p>
      </FormHead>
    </div>
  );
}
