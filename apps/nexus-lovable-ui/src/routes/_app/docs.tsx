import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate, nexusApi, tiptapToText, type NexusDoc, type NexusProject } from "@/lib/nexus-api";
import { BookOpen, Plus, Search, Loader2, X } from "lucide-react";
import { celebrate } from "@/components/Celebration";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/docs")({ component: Docs });

function Docs() {
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
      <PageHeader title="Knowledge Library" subtitle="Live wiki, SOP spells, and project lore in one cozy shelf." icon={<BookOpen className="h-6 w-6 text-primary" />} actions={
        <>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search docs…" className="pl-7 pr-3 py-1.5 text-sm rounded-md border border-border bg-background w-56 outline-none focus:border-primary" />
          </div>
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" /> New doc</button>
        </>
      } />
      <div className="p-4 md:p-8 grid grid-cols-1 lg:grid-cols-4 gap-6">
        <aside className="lg:col-span-1 space-y-0.5">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-1 px-2">Tree</div>
          {roots.length === 0 && <p className="px-2 text-xs text-muted-foreground">No docs.</p>}
          {roots.map((d) => <DocTreeNode key={d.id} doc={d} allDocs={rows} depth={0} />)}
        </aside>
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          {docs.isLoading && <Empty title="Opening library..." message="Pulling live docs from NEXUS." />}
          {docs.isError && <Empty title="Library locked" message="Login/session needed to read live docs." />}
          {!docs.isLoading && !docs.isError && filtered.length === 0 && <Empty title={query ? "No matches" : "Shelf's still empty"} message={query ? `No docs match "${query}".` : "No docs visible in this workspace yet."} />}
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
      <Link to="/docs/$docId" params={{ docId: doc.id }} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent" style={{ paddingLeft: `${depth * 14 + 8}px` }}>
        <span className="shrink-0">{emojiForDoc(doc)}</span>
        <span className="truncate">{doc.title}</span>
      </Link>
      {children.map((c) => <DocTreeNode key={c.id} doc={c} allDocs={allDocs} depth={depth + 1} />)}
    </div>
  );
}

function DocComposer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [content, setContent] = useState("");
  const projects = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false });
  const templates = useQuery({ queryKey: ["nexus", "doc-templates"], queryFn: () => nexusApi.docTemplates(), retry: false });
  const applyTemplate = (id: string) => {
    const tpl = (templates.data?.templates ?? []).find((t) => t.id === id);
    if (tpl) { setContent(tiptapToText(tpl.content)); if (!title.trim()) setTitle(tpl.name); }
  };
  const create = useMutation({
    mutationFn: () => nexusApi.createDoc({ title, projectId, content: contentToTipTap(content) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexus", "docs"] });
      celebrate("New lore added 📚✨");
      onClose();
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
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight">Add a knowledge gem</h2>
            <p className="mt-1 text-sm text-muted-foreground">Creates a real NEXUS doc under selected project.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-5 space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Doc title" className={field} />
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={field}>
            <option value="">Pick project shelf</option>
            {(projects.data ?? []).map((p: NexusProject) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {(templates.data?.templates?.length ?? 0) > 0 && (
            <select defaultValue="" onChange={(e) => { if (e.target.value) applyTemplate(e.target.value); }} className={field}>
              <option value="">Start from template (optional)</option>
              {(templates.data?.templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Quick note / SOP / project lore..." className={cn(field, "min-h-32")} />
          {create.isError && <p className="text-sm text-destructive">Create doc failed. Check project permission/session.</p>}
          <button disabled={!title.trim() || !projectId || create.isPending} onClick={() => create.mutate()} className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default disabled:opacity-50">
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create real doc
          </button>
        </div>
      </div>
    </div>
  );
}

function DocCard({ doc }: { doc: NexusDoc }) {
  const author = doc.author || doc.owner;
  return (
    <Link to="/docs/$docId" params={{ docId: doc.id }} className="block cursor-pointer rounded-2xl border border-border bg-card p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <div className="flex items-start gap-3">
        <span className="text-2xl">{emojiForDoc(doc)}</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold tracking-tight truncate">{doc.title}</h3>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{doc.contentText || `Filed under ${doc.project?.name || "NEXUS lore"}.`}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-[9px] font-black text-primary">{initials(author?.name)}</span>
          <span>{author?.name || "NEXUS"}</span>
        </div>
        <span>Updated {fmtDate(doc.updatedAt)}</span>
      </div>
    </Link>
  );
}

function Empty({ title, message }: { title: string; message: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft md:col-span-2"><div className="text-lg font-black">{title}</div><p className="mt-2 text-sm text-muted-foreground">{message}</p></div>;
}

function emojiForDoc(doc: NexusDoc) {
  const text = `${doc.title} ${doc.project?.name || ""}`.toLowerCase();
  if (text.includes("sop") || text.includes("policy")) return "📜";
  if (text.includes("brief") || text.includes("client")) return "🧭";
  if (text.includes("creative") || text.includes("design")) return "🎨";
  if (text.includes("finance") || text.includes("invoice")) return "💸";
  return "📚";
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
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
