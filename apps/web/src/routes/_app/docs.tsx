import { plainPreview } from "@/lib/plain-preview";
import { docTitle } from "@/lib/doc-title";
import { createFileRoute, Link, Outlet, useChildMatches, useNavigate } from "@tanstack/react-router";
import { SelectPicker } from "@/components/SelectPicker";
import { EmptyState } from "@/components/EmptyState";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate, nexusApi, tiptapToText, type NexusDoc, type NexusProject } from "@/lib/nexus-api";
import { BookOpen, Plus, Search, Loader2, X } from "lucide-react";
import { celebrate } from "@/components/Celebration";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/Avatar";
import { useLang } from "@/lib/lang";

export const Route = createFileRoute("/_app/docs")({ component: Docs });

// /docs/$docId is a child of this route in the file tree. Without an <Outlet/> a doc link rendered this
// list instead of the doc (the page was unreachable on web until 12 Oct 2026).
function Docs() {
  const children = useChildMatches();
  return children.length > 0 ? <Outlet /> : <DocsList />;
}

function DocsList() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const docs = useQuery({ queryKey: ["nexus", "docs"], queryFn: () => nexusApi.docs(), retry: false });
  const rows = docs.data?.docs ?? [];
  const filtered = query.trim() ? rows.filter((d) => d.title.toLowerCase().includes(query.toLowerCase())) : rows;

  // Build a tree by parentId (roots = no parent or parent not in set).
  const ids = new Set(rows.map((d) => d.id));
  const roots = rows.filter((d) => !d.parentId || !ids.has(d.parentId));

  return (
    <div>
      <PageHeader title={t("Pages")} subtitle={t("SOPs, meeting notes, briefs and reference pages from every project you're in.")} actions={
        <>
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search pages…")} className="pl-7 pr-3 py-1.5 text-sm rounded-md border border-border bg-background w-full sm:w-56 outline-none focus:border-primary" />
          </div>
          <button onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" /> {t("New page")}</button>
        </>
      } />
      <div className="p-4 md:p-8 grid grid-cols-1 lg:grid-cols-4 gap-6">
        <aside className="lg:col-span-1 space-y-0.5">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-1 px-2">{t("All pages")}</div>
          {roots.length === 0 && <p className="px-2 text-xs text-muted-foreground">{t("No pages yet.")}</p>}
          {roots.map((d) => <DocTreeNode key={d.id} doc={d} allDocs={rows} depth={0} />)}
        </aside>
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          {docs.isLoading && <Empty title={t("Loading pages…")} message="" />}
          {docs.isError && <Empty title={t("Couldn't load pages")} message={t("Your session may have ended. Sign in again to see your pages.")} />}
          {!docs.isLoading && !docs.isError && filtered.length === 0 && <Empty title={query ? t("No matches") : t("No pages yet")} message={query ? t("No page matches “{query}”.", { query }) : t("Pages you can see in this workspace show up here. Create one with New page.")} />}
          {filtered.map((d) => <DocCard key={d.id} doc={d} />)}
        </div>
      </div>
      {open && <DocComposer onClose={() => setOpen(false)} />}
    </div>
  );
}

function DocTreeNode({ doc, allDocs, depth }: { doc: NexusDoc; allDocs: NexusDoc[]; depth: number }) {
  const children = allDocs.filter((d) => d.parentId === doc.id);
  return (
    <div>
      <Link to="/docs/$docId" params={{ docId: doc.id }} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent pointer-coarse:min-h-11" style={{ paddingLeft: `${depth * 14 + 8}px` }}>
        <span className="shrink-0">{emojiForDoc(doc)}</span>
        <span className="truncate">{docTitle(doc.title)}</span>
      </Link>
      {children.map((c) => <DocTreeNode key={c.id} doc={c} allDocs={allDocs} depth={depth + 1} />)}
    </div>
  );
}

function DocComposer({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [content, setContent] = useState("");
  const [templateId, setTemplateId] = useState("");
  const projects = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false });
  const templates = useQuery({ queryKey: ["nexus", "doc-templates"], queryFn: () => nexusApi.docTemplates(), retry: false });
  const applyTemplate = (id: string) => {
    const tpl = (templates.data?.templates ?? []).find((x) => x.id === id);
    if (tpl) { const text = tiptapToText(tpl.content); setContent(text); setTemplate({ text, content: tpl.content }); if (!title.trim()) setTitle(tpl.name); }
  };
  // A template keeps its formatting (headings, lists, to-dos…) unless the text was edited here.
  const [template, setTemplate] = useState<{ text: string; content: unknown } | null>(null);
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => nexusApi.createDoc({ title, projectId, content: template && template.text === content ? template.content : contentToTipTap(content) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["nexus", "docs"] });
      celebrate(t("Page created"));
      onClose();
      // Straight into the block editor, like Notion.
      if (res.doc?.id) navigate({ to: "/docs/$docId", params: { docId: res.doc.id } });
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const field = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="fixed inset-0 z-[70] grid grid-cols-1 place-items-center bg-black/50 dark:bg-scrim p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight">{t("New page")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("The page belongs to the project you pick.")}</p>
          </div>
          <button onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-5 space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Page title")} className={field} />
          <SelectPicker variant="field" value={projectId} onChange={setProjectId} placeholder={t("Pick a project")} ariaLabel={t("Project")} options={(projects.data ?? []).map((p: NexusProject) => ({ value: p.id, label: p.name }))} className={cn(field, "flex hover:border-primary/40")} />
          {(templates.data?.templates?.length ?? 0) > 0 && (
            <SelectPicker variant="field" value={templateId} onChange={(v) => { setTemplateId(v); if (v) applyTemplate(v); }} placeholder={t("Start from a template (optional)")} ariaLabel={t("Start from a template (optional)")} options={(templates.data?.templates ?? []).map((x) => ({ value: x.id, label: x.name }))} className={cn(field, "flex hover:border-primary/40")} />
          )}
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder={t("Write a note, an SOP or meeting notes…")} className={cn(field, "min-h-32")} />
          {create.isError && <p className="text-sm text-destructive">{t("Couldn't create the page. Check that you're a member of the project, then try again.")}</p>}
          <button disabled={!title.trim() || !projectId || create.isPending} onClick={() => create.mutate()} className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default disabled:opacity-50">
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Create page")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DocCard({ doc }: { doc: NexusDoc }) {
  const { t } = useLang();
  const author = doc.author || doc.owner;
  return (
    <Link to="/docs/$docId" params={{ docId: doc.id }} className="block cursor-pointer rounded-2xl border border-border bg-card p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <div className="flex items-start gap-3">
        <span className="text-2xl">{emojiForDoc(doc)}</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold tracking-tight truncate">{docTitle(doc.title)}</h3>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{plainPreview(doc.contentText) || (doc.project?.name ? t("In {project}", { project: doc.project.name }) : t("No content yet"))}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          {author?.id ? <Avatar userId={author.id} name={author.name} avatar={author.avatar} size={20} className="ring-0" /> : <span className="grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-[9px] font-black text-primary">?</span>}
          <span>{author?.name || "NEXUS"}</span>
        </div>
        <span>{t("Updated {date}", { date: fmtDate(doc.updatedAt) })}</span>
      </div>
    </Link>
  );
}

function Empty({ title, message }: { title: string; message: string }) {
  return <EmptyState icon={BookOpen} tone="muted" title={title} message={message} className="md:col-span-2" />;
}

function emojiForDoc(doc: NexusDoc) {
  const text = `${doc.title} ${doc.project?.name || ""}`.toLowerCase();
  if (text.includes("sop") || text.includes("policy")) return "📜";
  if (text.includes("brief") || text.includes("client")) return "🧭";
  if (text.includes("creative") || text.includes("design")) return "🎨";
  if (text.includes("finance") || text.includes("invoice")) return "💸";
  return "📚";
}


function contentToTipTap(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return {
    type: "doc",
    content: trimmed.split(/\n{2,}/).map((paragraph) => ({
      type: "paragraph",
      content: paragraph.trim() ? [{ type: "text", text: paragraph.trim() }] : [],
    })),
  };
}
