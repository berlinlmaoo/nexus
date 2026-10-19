import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, FileText, Plus } from "lucide-react";
import { nexusApi, type NexusForm } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Reveal } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { FormBuilder } from "./FormStudio";
import { coverCss } from "./form-model";
import { useProjectCanEdit } from "@/components/projects/project-access";

// The builder itself lives in FormStudio.tsx (Notion-style rebuild, 12 Oct 2026).
export { FormBuilder };

/**
 * The open builder lives in the address (`?form=<id>`, `?form=new`), like the task popup's `?task=`:
 * opening pushes a history entry, so browser Back closes only the builder (it saves on the way out) and
 * Forward / refresh open it again. Closing goes back over our entry; a builder opened from a link (no
 * entry of ours) just drops the param. A new form's first save swaps "new" for its id (replace).
 * The route must accept `form` in validateSearch.
 */
export function useFormBuilderParam(forms: NexusForm[] | undefined, loaded: boolean) {
  const navigate = useNavigate();
  const param = (useSearch({ strict: false }) as { form?: string }).form ?? null;
  const pushed = useRef(false);
  const created = useRef(new Set<string>());
  // The form the builder was opened with; kept while it stays open (the list may refetch, or not hold a
  // just-created form yet).
  const [opened, setOpened] = useState<{ key: string; form?: NexusForm } | null>(null);
  const setParam = useCallback((form: string | undefined, replace: boolean) => {
    navigate({ to: ".", search: ((prev: Record<string, unknown>) => ({ ...prev, form })) as never, replace });
  }, [navigate]);
  const open = useCallback((form?: NexusForm) => {
    const key = form?.id ?? "new";
    setOpened({ key, form });
    pushed.current = true;
    setParam(key, false);
  }, [setParam]);
  const close = useCallback(() => {
    if (pushed.current) { pushed.current = false; window.history.back(); }
    else setParam(undefined, true);
  }, [setParam]);
  const onCreated = useCallback((id: string) => {
    created.current.add(id);
    setOpened((o) => (o ? { ...o, key: id } : o));
    setParam(id, true);
  }, [setParam]);
  useEffect(() => {
    if (!param) { pushed.current = false; setOpened(null); return; }
    if (opened && (opened.key === param || created.current.has(param))) return;
    if (param === "new") { setOpened({ key: "new" }); return; }
    const f = forms?.find((x) => x.id === param || x.slug === param);
    if (f) setOpened({ key: f.id, form: f });
    else if (loaded) setParam(undefined, true); // deleted, or not a form of this place
  }, [param, forms, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  return { builder: param ? opened : null, open, close, onCreated };
}

export function FormCard({ form, projectName, onEdit }: { form: NexusForm; projectName?: string; onEdit: () => void }) {
  const { t, tn } = useLang();
  const [copied, setCopied] = useState(false);
  // Prefer the readable, STABLE slug (e.g. /f/pengajuan-finance-outlet) over the opaque id — the public
  // form route resolves either. Falls back to id only if a form somehow has no slug.
  const publicUrl = `${window.location.origin}/f/${form.slug || form.id}`;
  const copy = () => { navigator.clipboard?.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const cover = coverCss(form.branding?.cover);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-all hover:border-primary/30 hover:shadow-pop">
      {cover && <div aria-hidden className="h-10 w-full shrink-0" style={{ background: cover }} />}
      <div className="flex flex-1 flex-col p-5">
        <button onClick={onEdit} className="flex-1 text-left">
          <div className="flex items-start gap-2">
            {form.branding?.icon ? <span className="mt-[-2px] shrink-0 text-xl leading-none">{form.branding.icon}</span> : <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
            <div className="min-w-0"><h3 className="truncate font-semibold tracking-tight">{form.name}</h3>{projectName && <p className="mt-0.5 truncate text-[11px] font-medium text-primary/80">{projectName}</p>}{form.description && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{form.description}</p>}</div>
          </div>
        </button>
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>{tn(form._count?.submissions ?? 0, "{n} submission", "{n} submissions")} · {tn(form.fields?.length ?? 0, "{n} field", "{n} fields")}</span>
          <span className={cn("rounded-full px-2 py-0.5 font-bold", form.isPublic ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{form.isPublic ? t("Public") : t("Members")}</span>
        </div>
        <button onClick={copy} className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold transition-colors hover:bg-accent active:scale-[0.98]">
          {copied ? <><Check className="h-3.5 w-3.5 text-success" /> {t("Copied")}</> : <><Copy className="h-3.5 w-3.5" /> {form.isPublic ? t("Copy public link") : t("Copy link")}</>}
        </button>
      </div>
    </div>
  );
}

/** Project-scoped forms list + builder (used in the project detail "Forms" tab). */
export function ProjectFormsView({ projectId }: { projectId: string }) {
  const { t } = useLang();
  // Can view / Can comment: no "New form" (its first save answered 403, QA final 19 Oct).
  const canEdit = useProjectCanEdit();
  const forms = useQuery({ queryKey: ["nexus", "forms", projectId], queryFn: () => nexusApi.forms(projectId), enabled: !!projectId, retry: false });
  const rows = forms.data ?? [];
  const { builder, open, close, onCreated } = useFormBuilderParam(forms.data, forms.isSuccess || forms.isError);
  return (
    <div className="p-4 md:p-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">{t("Forms")}</h2>
          <p className="text-sm text-muted-foreground">{t("Each time someone submits a form, it creates a task in this project.")}</p>
        </div>
        {canEdit && <button onClick={() => open()} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" /> {t("New form")}</button>}
      </div>
      {forms.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
              <div className="flex items-start gap-2"><Skeleton className="h-5 w-5 rounded" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div></div>
              <Skeleton className="mt-4 h-3 w-1/3" />
            </div>
          ))}
        </div>
      )}
      {!forms.isLoading && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft">
          <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <div className="text-lg font-bold">{t("No forms yet")}</div>
          <p className="mt-2 text-sm text-muted-foreground">{t("Create the first form for this project.")}</p>
          {canEdit && <button onClick={() => open()} className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"><Plus className="h-3.5 w-3.5" /> {t("New form")}</button>}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((f, i) => <Reveal key={f.id} delay={Math.min(i, 8) * 0.05} className="h-full"><FormCard form={f} onEdit={() => open(f)} /></Reveal>)}
      </div>
      {builder && <FormBuilder projectId={projectId} form={builder.form} onClose={close} onCreated={onCreated} />}
    </div>
  );
}
