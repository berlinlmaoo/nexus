import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, LogIn, Lock, Paperclip } from "lucide-react";
import { ApiError, nexusApi, type NexusFormField } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/f/$formId")({ component: PublicForm });

type Cond = {
  fieldId: string;
  operator: "equals" | "not_equals" | "contains" | "is_empty" | "is_not_empty";
  value: string;
};
// The backend returns richer fields than NexusFormField declares (name/showIf/…).
type FField = NexusFormField & { name?: string; showIf?: Cond | null; attachmentEnabled?: boolean; autofill?: "name" | "email"; numberFormat?: "currency-idr" };

const idr = (digits: string) => { const n = Number(digits); return n ? new Intl.NumberFormat("id-ID").format(n) : ""; };

function fieldLabel(f: FField) {
  return f.name || f.label || "Field";
}
function fieldOptions(f: FField): string[] {
  if (Array.isArray(f.options)) return f.options;
  if (f.options && typeof f.options === "object" && Array.isArray(f.options.choices)) return f.options.choices;
  return [];
}

/** Client-side branching: a field with showIf only renders when its condition
 *  (against another field's current value) is met. Mirrors the backend. */
function evalCond(cond: Cond | null | undefined, values: Record<string, unknown>): boolean {
  if (!cond) return true;
  const raw = values[cond.fieldId];
  const list = Array.isArray(raw) ? raw.map(String) : [raw == null ? "" : String(raw)];
  const joined = list.join(", ");
  const exp = String(cond.value ?? "");
  switch (cond.operator) {
    case "equals": return list.includes(exp);
    case "not_equals": return !list.includes(exp);
    case "contains": return joined.toLowerCase().includes(exp.toLowerCase());
    case "is_empty": return !joined;
    case "is_not_empty": return !!joined;
    default: return true;
  }
}

function isFilled(v: unknown) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== "" && v !== false;
}

function PublicForm() {
  const { formId } = useParams({ from: "/f/$formId" });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [done, setDone] = useState(false);

  const form = useQuery({ queryKey: ["public-form", formId], queryFn: () => nexusApi.publicForm(formId), retry: false });
  const f = form.data;
  const fields = (f?.fields ?? []) as FField[];

  // Hardcoded: EVERY form requires a NEXUS login to submit — gate all forms behind sign-in.
  const me = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 60_000 });
  const loggedIn = !!me.data?.user;
  const needsLogin = !me.isLoading && !loggedIn;

  const set = (id: string, v: unknown) => setValues((cur) => ({ ...cur, [id]: v }));

  // Autofill fields (e.g. "Request by") prefill from the logged-in account so the user never retypes
  // their own name. Server re-applies this authoritatively on submit (anti-spoof) — this is just UX.
  const meUser = me.data?.user;
  useEffect(() => {
    if (!meUser) return;
    setValues((cur) => {
      let changed = false;
      const next = { ...cur };
      for (const fld of fields) {
        if (!fld.autofill) continue;
        const want = fld.autofill === "email" ? (meUser.email ?? "") : (meUser.name ?? "");
        if (cur[fld.id] !== want) { next[fld.id] = want; changed = true; }
      }
      return changed ? next : cur;
    });
  }, [meUser, fields]);

  // only fields whose showIf passes are shown + submitted
  const visible = useMemo(() => fields.filter((field) => evalCond(field.showIf, values)), [fields, values]);
  const canSubmit = visible.filter((x) => x.required).every((x) => isFilled(values[x.id]));
  const missingRequired = visible.filter((x) => x.required && !isFilled(values[x.id])).map(fieldLabel);

  const submit = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      const data: Record<string, unknown> = {};
      for (const field of visible) {
        const v = values[field.id];
        if (field.type === "file" && v instanceof File) {
          data[field.id] = v.name;
          fd.append(`file:${field.id}`, v);
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
      const res = await fetch(`/api/forms/${formId}/submit`, { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to submit form");
      }
      return res.json().catch(() => ({}));
    },
    onSuccess: () => setDone(true),
  });

  // access-schedule / unavailable handling (backend returns 403 + message)
  const err = form.error as ApiError | undefined;
  const scheduleMsg = err && typeof err.payload === "object" && err.payload && "accessSchedule" in err.payload ? err.message : null;

  const input = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-xl">
        {form.isLoading && <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}

        {form.isError && (
          <div className="rounded-3xl border border-border bg-card p-8 text-center shadow-soft">
            {scheduleMsg ? (
              <>
                <Clock className="mx-auto mb-4 h-10 w-10 text-warning-foreground" />
                <div className="text-lg font-bold">Form not open yet</div>
                <p className="mt-2 text-sm text-muted-foreground">{scheduleMsg}</p>
              </>
            ) : (
              <>
                <div className="text-lg font-bold">Form unavailable</div>
                <p className="mt-2 text-sm text-muted-foreground">This form is private or no longer exists.</p>
              </>
            )}
          </div>
        )}

        {f && done && (
          <div className="rounded-3xl border border-border bg-card p-10 text-center shadow-soft">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-success" />
            <h1 className="font-display text-2xl font-bold tracking-tight">Submitted — thank you!</h1>
            <p className="mt-2 text-sm text-muted-foreground">Your response for “{f.name}” was received.</p>
          </div>
        )}

        {f && !done && needsLogin && (
          <div className="rounded-3xl border border-border bg-card p-10 text-center shadow-soft">
            <LogIn className="mx-auto mb-4 h-10 w-10 text-primary" />
            <h1 className="font-display text-2xl font-bold tracking-tight">{f.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">This form needs a NEXUS login before you submit, so you can track your request under “My Requests”.</p>
            <a
              href={`/login?callbackUrl=${encodeURIComponent(`/f/${formId}`)}`}
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.99]"
            >
              <LogIn className="h-4 w-4" /> Log in to submit
            </a>
          </div>
        )}

        {f && !done && !needsLogin && (
          <div className="rounded-3xl border border-border bg-card p-6 shadow-soft md:p-8">
            <h1 className="font-display text-2xl font-bold tracking-tight">{f.name}</h1>
            {f.description && <p className="mt-2 text-sm text-muted-foreground">{f.description}</p>}

            {me.data?.user && (
              <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 px-3 py-2">
                {me.data.user.avatar
                  ? <img src={me.data.user.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                  : <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">{(me.data.user.name ?? me.data.user.email ?? "?").slice(0, 1).toUpperCase()}</span>}
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-[11px] text-muted-foreground">Submitting as</div>
                  <div className="truncate text-sm font-semibold">{me.data.user.name ?? me.data.user.email}{me.data.user.name && me.data.user.email ? <span className="font-normal text-muted-foreground"> · {me.data.user.email}</span> : null}</div>
                </div>
                <a href={`/login?callbackUrl=${encodeURIComponent(`/f/${formId}`)}`} className="shrink-0 text-xs font-semibold text-primary hover:underline">Switch account</a>
              </div>
            )}

            <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); if (canSubmit && !submit.isPending) submit.mutate(); }}>
              {visible.map((field) => {
                const label = fieldLabel(field);
                const val = values[field.id];
                return (
                  <div key={field.id} className="space-y-1.5">
                    {field.type !== "checkbox" && (
                      <label className="block text-sm font-semibold">{label}{field.required && <span className="text-destructive"> *</span>}</label>
                    )}

                    {field.type === "textarea" ? (
                      <textarea required={field.required} rows={3} placeholder={field.placeholder} value={String(val ?? "")} onChange={(e) => set(field.id, e.target.value)} className={`${input} resize-y`} />
                    ) : field.type === "dropdown" || field.type === "select" ? (
                      <select required={field.required} value={String(val ?? "")} onChange={(e) => set(field.id, e.target.value)} className={input}>
                        <option value="">Choose…</option>
                        {fieldOptions(field).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : field.type === "multi_select" ? (
                      <div className="space-y-1.5 rounded-xl border border-border bg-background p-3">
                        {fieldOptions(field).map((o) => {
                          const arr = Array.isArray(val) ? (val as string[]) : [];
                          const checked = arr.includes(o);
                          return (
                            <label key={o} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => set(field.id, e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))}
                                className="h-4 w-4 accent-primary"
                              />
                              {o}
                            </label>
                          );
                        })}
                      </div>
                    ) : field.type === "checkbox" ? (
                      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={Boolean(val)} onChange={(e) => set(field.id, e.target.checked)} className="h-4 w-4 accent-primary" /> {label}{field.required && <span className="text-destructive"> *</span>}</label>
                    ) : field.type === "file" ? (
                      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border bg-background px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary">
                        <Paperclip className="h-4 w-4 shrink-0" />
                        <span className="truncate">{val instanceof File ? val.name : "Choose a file…"}</span>
                        <input type="file" required={field.required} className="hidden" onChange={(e) => set(field.id, e.target.files?.[0] ?? "")} />
                      </label>
                    ) : field.type === "number" && field.numberFormat === "currency-idr" ? (
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">Rp</span>
                        <input required={field.required} inputMode="numeric" placeholder="0" value={idr(String(val ?? ""))} onChange={(e) => set(field.id, e.target.value.replace(/[^\d]/g, ""))} className={cn(input, "pl-9")} />
                      </div>
                    ) : field.autofill ? (
                      <div className="relative">
                        <input readOnly value={String(val ?? "")} className={cn(input, "cursor-not-allowed bg-muted/50 pr-9 text-muted-foreground")} />
                        <Lock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                      </div>
                    ) : (
                      <input required={field.required} type={field.type === "email" ? "email" : field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} placeholder={field.placeholder} value={String(val ?? "")} onChange={(e) => set(field.id, e.target.value)} className={input} />
                    )}
                    {field.autofill && <p className="mt-1 text-[11px] text-muted-foreground">🔒 auto-filled from your logged-in account</p>}

                    {/* optional extra attachment on non-file fields */}
                    {field.attachmentEnabled && field.type !== "file" && (
                      <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-primary">
                        <Paperclip className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{values[`attachment:${field.id}`] instanceof File ? (values[`attachment:${field.id}`] as File).name : "Attach a file (optional)"}</span>
                        <input type="file" className="hidden" onChange={(e) => set(`attachment:${field.id}`, e.target.files?.[0] ?? "")} />
                      </label>
                    )}
                  </div>
                );
              })}
              <button type="submit" disabled={!canSubmit || submit.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50">
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Submit
              </button>
              {!canSubmit && missingRequired.length > 0 && (
                <p className="text-center text-xs text-muted-foreground">Fill in the required ones first <span className="text-destructive">*</span>: <span className="font-semibold text-foreground">{missingRequired.join(", ")}</span></p>
              )}
              {submit.isError && <p className="text-center text-xs font-semibold text-destructive">{(submit.error as Error)?.message || "Submission failed. Try again."}</p>}
            </form>
          </div>
        )}
        <p className="mt-6 text-center text-xs text-muted-foreground">Powered by NEXUS Phaëthon</p>
      </div>
    </div>
  );
}
