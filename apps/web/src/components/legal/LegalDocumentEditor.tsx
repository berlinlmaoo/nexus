import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Lock, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SegmentsView } from "@/components/legal/LegalDiffView";
import { diffWordsClient } from "@/components/legal/diff-words";
import { legalVersionsApi, type LegalDocument } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * Review a generated document paragraph by paragraph (owner, 14 Oct 2026). Click a paragraph to change its
 * text; every save is a new version with your name on it. The number's paragraph and paragraphs with a
 * field, image or link are locked. `selected`/`onSelect` mark paragraphs for GIDEON.
 */
export function LegalDocumentEditor({ doc, selected, onSelect }: { doc: LegalDocument; selected?: Set<number>; onSelect?: (index: number) => void }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["legal", "paragraphs", doc.id, doc.currentVersion], queryFn: () => legalVersionsApi.paragraphs(doc.id) });
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => { setEdits({}); setEditing(null); setNote(""); }, [doc.currentVersion]);

  const paragraphs = q.data?.paragraphs ?? [];
  const pending = Object.entries(edits).filter(([i, text]) => paragraphs[Number(i)]?.text !== text);
  const save = useMutation({
    mutationFn: () => legalVersionsApi.saveEdits(doc.id, doc.currentVersion, pending.map(([i, text]) => ({ index: Number(i), text })), note.trim()),
    onSuccess: (res) => {
      toast.success(t("Saved as version {n}", { n: res.version }));
      if (res.pdfError) toast.warning(t("The PDF couldn't be made yet: {reason}", { reason: res.pdfError }));
      void qc.invalidateQueries({ queryKey: ["legal", "document", doc.id] });
      void qc.invalidateQueries({ queryKey: ["legal", "documents"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>;
  if (q.isError) return <p className="py-4 text-sm text-muted-foreground">{(q.error as Error).message}</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {onSelect ? t("Click a paragraph to edit it, or tick paragraphs to ask GIDEON to change them.") : t("Click a paragraph to edit it.")}
      </p>
      <ol className="space-y-1">
        {paragraphs.map((p) => {
          if (p.lockReason === "empty" || (!p.text.trim() && p.editable)) return null;
          const text = edits[p.index] ?? p.text;
          const changed = edits[p.index] !== undefined && edits[p.index] !== p.text;
          const isHeading = /^(Heading|Judul|Title)/i.test(p.style ?? "");
          return (
            <li key={p.index} className={cn("group flex gap-2 rounded-md px-2 py-1", changed && "bg-amber-500/10", selected?.has(p.index) && "ring-1 ring-primary/50")}>
              {onSelect && (
                <input type="checkbox" className="mt-1.5 h-3.5 w-3.5 shrink-0 accent-primary disabled:opacity-30" aria-label={t("Select paragraph {n}", { n: p.index + 1 })}
                  disabled={!p.editable} checked={!!selected?.has(p.index)} onChange={() => onSelect(p.index)} />
              )}
              <div className="min-w-0 flex-1">
                {editing === p.index ? (
                  <Textarea autoFocus rows={Math.min(10, Math.max(2, Math.ceil(text.length / 90)))} value={text}
                    onChange={(e) => setEdits((cur) => ({ ...cur, [p.index]: e.target.value }))}
                    onBlur={() => setEditing(null)}
                    onKeyDown={(e) => { if (e.key === "Escape") { setEdits(({ [p.index]: _drop, ...rest }) => rest); setEditing(null); } }} />
                ) : p.editable ? (
                  <button type="button" onClick={() => setEditing(p.index)}
                    className={cn("w-full whitespace-pre-wrap rounded text-left text-sm leading-relaxed hover:bg-accent/60", isHeading && "font-semibold", p.inTable && "text-[13px]")}>
                    {changed ? <SegmentsView segments={diffWordsClient(p.text, text)} /> : text || " "}
                  </button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex cursor-not-allowed items-start gap-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                        <Lock className="mt-1 h-3 w-3 shrink-0" /> <span>{p.text || "—"}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{p.lockReason === "number" ? t("The document number can't be edited.") : t("Has a field, image or link: edit it in Word and upload the file as a new version.")}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {pending.length > 0 && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
          <span className="text-sm">{t("{n} paragraphs changed", { n: pending.length })}</span>
          <Input className="h-9 min-w-40 flex-1" placeholder={t("What changed (optional)")} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEdits({})}><RotateCcw className="h-4 w-4" /> {t("Discard")}</Button>
          <Button size="sm" className="gap-1.5" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("Save as new version")}
          </Button>
        </div>
      )}
    </div>
  );
}
