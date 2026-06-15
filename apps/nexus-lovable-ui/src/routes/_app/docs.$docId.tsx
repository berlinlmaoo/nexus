import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Loader2, Trash2 } from "lucide-react";
import { fmtDate, nexusApi, textToTiptap, tiptapToText } from "@/lib/nexus-api";

export const Route = createFileRoute("/_app/docs/$docId")({ component: DocEditor });

function DocEditor() {
  const { docId } = useParams({ from: "/_app/docs/$docId" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const doc = useQuery({ queryKey: ["nexus", "doc", docId], queryFn: () => nexusApi.doc(docId), retry: false });
  const d = doc.data?.doc;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (d) {
      setTitle(d.title ?? "");
      setBody(d.contentText || tiptapToText((d as { content?: unknown }).content));
      setDirty(false);
    }
  }, [d?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => nexusApi.updateDoc(docId, { title: title.trim() || "Untitled", content: textToTiptap(body) }),
    onSuccess: () => { setDirty(false); setSavedAt(new Date().toLocaleTimeString()); qc.invalidateQueries({ queryKey: ["nexus", "doc", docId] }); qc.invalidateQueries({ queryKey: ["nexus", "docs"] }); },
  });
  const duplicate = useMutation({ mutationFn: () => nexusApi.duplicateDoc(docId), onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["nexus", "docs"] }); if (res.doc?.id) navigate({ to: "/docs/$docId", params: { docId: res.doc.id } }); } });
  const del = useMutation({ mutationFn: () => nexusApi.deleteDoc(docId), onSuccess: () => { qc.invalidateQueries({ queryKey: ["nexus", "docs"] }); navigate({ to: "/docs" }); } });

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 md:px-8 md:py-10">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => navigate({ to: "/docs" })} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent active:scale-[0.98]"><ArrowLeft className="h-4 w-4" /> Docs</button>
        {d?.project && <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: d.project.color ?? "#7b68ee" }} />{d.project.name}</span>}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {save.isPending ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span> : savedAt ? <span>Saved {savedAt}</span> : d?.updatedAt ? <span>Updated {fmtDate(d.updatedAt)}</span> : null}
          <button onClick={() => duplicate.mutate()} disabled={duplicate.isPending} className="rounded-lg p-1.5 transition-colors hover:bg-accent" title="Duplicate"><Copy className="h-4 w-4" /></button>
          <button onClick={() => { if (confirm("Delete this doc?")) del.mutate(); }} className="rounded-lg p-1.5 transition-colors hover:bg-destructive/10 hover:text-destructive" title="Delete"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      {doc.isLoading && <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
      {doc.isError && <p className="py-20 text-center text-sm font-semibold text-destructive">Gagal memuat doc. Cek sesi / akses.</p>}

      {d && (
        <div className="space-y-4">
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
            placeholder="Untitled"
            className="w-full bg-transparent font-display text-3xl font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
          />
          <textarea
            value={body}
            onChange={(e) => { setBody(e.target.value); setDirty(true); }}
            placeholder="Start writing… notes, SOP, briefs, project lore."
            className="min-h-[50vh] w-full resize-y rounded-2xl border border-border bg-card px-4 py-3 text-sm leading-relaxed text-foreground outline-none transition focus:border-primary"
          />
          <div className="flex items-center gap-2">
            <button disabled={!dirty || save.isPending} onClick={() => save.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
            </button>
            {dirty && <span className="text-xs font-medium text-warning-foreground">Unsaved changes</span>}
            {save.isError && <span className="text-xs font-semibold text-destructive">Save gagal.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
