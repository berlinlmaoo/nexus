import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Lock, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SegmentsView } from "@/components/legal/LegalDiffView";
import { diffWordsClient } from "@/components/legal/diff-words";
import { legalVersionsApi, type DocPageSetup, type DocParagraph, type LegalDocument } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/** CSS pixels per point. */
const PX = 96 / 72;
/** Below this width the page is reflowed (phone): to scale, 9.5 pt text would be unreadable. */
const PAPER_MIN = 560;
const DEFAULT_PAGE: DocPageSetup = { width: 595.3, marginLeft: 72, marginRight: 72, marginTop: 72 };

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/**
 * Review a generated document on the page itself (owner, 16 Oct 2026: "review dan edit langsung di view kaya
 * PDF-nya"; it was a plain list of lines, 14 Oct). The body is drawn as it prints: the page's width and margins,
 * alignment, indents, list numbers, spacing, size, bold / italic / underline and tables. Click a paragraph to
 * change it in place; every save is a new version with your name on it. The number's paragraph and paragraphs
 * with a field, image or link are locked. `selected`/`onSelect` tick paragraphs for GIDEON (the box in the
 * left margin). The letterhead and the page footer are not part of the body: the PDF shows them.
 */
export function LegalDocumentEditor({ doc, selected, onSelect }: { doc: LegalDocument; selected?: Set<number>; onSelect?: (index: number) => void }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["legal", "paragraphs", doc.id, doc.currentVersion], queryFn: () => legalVersionsApi.paragraphs(doc.id) });
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => { setEdits({}); setEditing(null); setNote(""); }, [doc.currentVersion]);
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);

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

  const page = q.data?.page ?? DEFAULT_PAGE;
  const pagePx = page.width * PX;
  const paper = width >= PAPER_MIN;
  const zoom = paper ? Math.min(1, width / pagePx) : 1;
  // On a phone the indents shrink with the margins, so a numbered clause still has room for its text.
  const k = paper ? 1 : 0.55;
  const padLeft = paper ? page.marginLeft * PX : 36;
  const padRight = paper ? page.marginRight * PX : 16;
  const baseSize = page.size ?? 11;
  const font = `${page.font ? `"${page.font}", ` : ""}Arial, "Liberation Sans", Helvetica, sans-serif`;

  const renderParagraph = (p: DocParagraph): ReactNode => {
    const l = p.layout ?? {};
    const size = l.size ?? baseSize;
    const lh = (l.lineHeight ?? 1) * 1.15;
    const blank = p.lockReason === "empty" || (!p.text.trim() && p.editable);
    const style: CSSProperties = {
      textAlign: l.align ?? "left",
      paddingLeft: (l.indentLeft ?? 0) * PX * k,
      textIndent: l.firstLine ? l.firstLine * PX * k : undefined,
      marginTop: (l.spaceBefore ?? 0) * PX,
      marginBottom: (l.spaceAfter ?? 0) * PX,
      fontSize: `${size}pt`,
      lineHeight: lh,
    };
    // A blank line keeps its height, so the page keeps its rhythm; there is nothing to edit on it.
    if (blank) return <div key={p.index} aria-hidden style={{ ...style, height: `${size * lh}pt` }} />;

    const text = edits[p.index] ?? p.text;
    const changed = edits[p.index] !== undefined && edits[p.index] !== p.text;
    const isSelected = !!selected?.has(p.index);
    const marker = l.marker
      ? l.hanging
        ? <span aria-hidden className="absolute" style={{ left: ((l.indentLeft ?? 0) - l.hanging) * PX * k, textIndent: 0 }}>{l.marker}</span>
        : <span aria-hidden>{l.marker} </span>
      : null;
    const body = changed
      ? <SegmentsView segments={diffWordsClient(p.text, text)} />
      : l.runs
        ? l.runs.map((r, i) => <span key={i} className={cn(r.b && "font-bold", r.i && "italic", r.u && "underline")}>{r.text}</span>)
        : text;
    const gutter = (
      <span className="absolute top-0 flex items-center" style={{ left: -padLeft + (paper ? 14 : 8), height: `${size * lh}pt` }}>
        {p.editable
          ? onSelect && (
            <input type="checkbox" aria-label={t("Select paragraph {n}", { n: p.index + 1 })} checked={isSelected} onChange={() => onSelect(p.index)}
              className={cn("h-3.5 w-3.5 cursor-pointer accent-primary transition-opacity pointer-coarse:opacity-100", isSelected || (selected?.size ?? 0) > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")} />
          )
          : <Lock aria-hidden className="h-3 w-3 text-neutral-400" />}
      </span>
    );

    if (!p.editable) {
      return (
        <Tooltip key={p.index}>
          <TooltipTrigger asChild>
            <div className="relative cursor-default whitespace-pre-wrap" style={style}>
              {gutter}{marker}{body}
            </div>
          </TooltipTrigger>
          <TooltipContent>{p.lockReason === "number" ? t("The document number can't be edited.") : t("Has a field, image or link: edit it in Word and upload the file as a new version.")}</TooltipContent>
        </Tooltip>
      );
    }
    return (
      <div key={p.index} className="group relative" style={style}>
        {gutter}{marker}
        {editing === p.index ? (
          <textarea autoFocus value={text} aria-label={t("Paragraph {n}", { n: p.index + 1 })}
            onChange={(e) => setEdits((cur) => ({ ...cur, [p.index]: e.target.value }))}
            onBlur={() => setEditing(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setEdits(({ [p.index]: _drop, ...rest }) => rest); setEditing(null); }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
            }}
            className="-mx-1 block w-[calc(100%+0.5rem)] resize-none rounded-sm border-0 bg-sky-50 px-1 py-0 text-neutral-900 outline-none ring-2 ring-sky-400 [field-sizing:content]"
            style={{ font: "inherit", textAlign: style.textAlign, textIndent: style.textIndent, lineHeight: "inherit" }} />
        ) : (
          <div role="button" tabIndex={0} onClick={() => setEditing(p.index)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(p.index); } }}
            title={t("Click to edit")}
            className={cn("-mx-1 cursor-text whitespace-pre-wrap rounded-sm px-1 transition-colors hover:bg-sky-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
              changed && "bg-amber-100", isSelected && "bg-violet-100 ring-1 ring-violet-300")}>
            {body}
          </div>
        )}
      </div>
    );
  };

  // Paragraphs inside a table are drawn as that table: grouped by table, then row, then cell.
  const blocks: ReactNode[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const cell = paragraphs[i].layout?.cell;
    if (!cell) { blocks.push(renderParagraph(paragraphs[i])); continue; }
    const rows: DocParagraph[][][] = [];
    let j = i;
    for (; j < paragraphs.length && paragraphs[j].layout?.cell?.table === cell.table; j++) {
      const c = paragraphs[j].layout!.cell!;
      ((rows[c.row] ??= [])[c.col] ??= []).push(paragraphs[j]);
    }
    blocks.push(
      <table key={`t${cell.table}-${i}`} className="my-1 w-full border-collapse" style={{ textIndent: 0 }}>
        <tbody>
          {rows.map((cols, r) => (
            <tr key={r}>{(cols ?? []).map((ps, c) => <td key={c} className="border border-neutral-300 px-1.5 py-0.5 align-top" style={{ paddingLeft: padLeft > 40 ? 6 : 4 }}>{(ps ?? []).map(renderParagraph)}</td>)}</tr>
          ))}
        </tbody>
      </table>,
    );
    i = j - 1;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {onSelect ? t("Click a paragraph to edit it, or tick paragraphs to ask GIDEON to change them.") : t("Click a paragraph to edit it.")}
        {" "}{t("The letterhead and page footer show in the PDF.")}
      </p>
      <div ref={box} className="w-full">
        {q.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
        ) : q.isError ? (
          <p className="py-4 text-sm text-muted-foreground">{(q.error as Error).message}</p>
        ) : width > 0 && (
          <div className="mx-auto rounded-sm bg-white text-neutral-900 shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.08)] ring-1 ring-black/5"
            style={{ width: paper ? pagePx : "100%", zoom, fontFamily: font, fontSize: `${baseSize}pt`, padding: `${(paper ? page.marginTop * 0.6 : 12) * (paper ? PX : 1)}px ${padRight}px ${paper ? 56 : 20}px ${padLeft}px` }}>
            {blocks}
          </div>
        )}
      </div>
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
