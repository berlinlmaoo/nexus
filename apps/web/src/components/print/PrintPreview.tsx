import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, ChevronRight, FileText, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadPdfJs } from "@/components/PdfFirstPage";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { fetchPreview, printErrorText, type PrintKind } from "@/lib/print-api";

/**
 * The pages a print sends, as thumbnails (owner, 18 Nov 2026: "no page preview before printing"). The PDF is the one
 * the server would print (GET /api/print/preview); pdf.js draws each page only when it scrolls into view, so a
 * 50-page file costs what is on screen. Pages outside the typed range are dimmed, Black & white shows them in grey,
 * a click shows one page large (←/→ to move, Esc to go back to the grid).
 */

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
};

async function drawPage(doc: PdfDoc, n: number, cssWidth: number): Promise<string> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const viewport = page.getViewport({ scale: (cssWidth * dpr) / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("no image");
  return URL.createObjectURL(blob);
}

export function PrintPreview({ kind, id, version, selected, mono, onPages, className }: {
  kind: PrintKind;
  id: string;
  version?: number;
  /** Pages that will print; null = all. */
  selected: Set<number> | null;
  /** Black & white chosen: the thumbnails go grey. */
  mono: boolean;
  /** How many pages the preview has (known once it loads). */
  onPages?: (n: number) => void;
  className?: string;
}) {
  const { t } = useLang();
  const bytes = useQuery({
    queryKey: ["print", "preview", kind, id, version ?? null],
    queryFn: () => fetchPreview(kind, id, version),
    staleTime: 60_000,
    gcTime: 60_000,
    retry: false,
  });
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [drawError, setDrawError] = useState(false);
  const [big, setBig] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!bytes.data) return;
    let cancelled = false;
    let loaded: PdfDoc | null = null;
    setDoc(null);
    setDrawError(false);
    (async () => {
      const lib = await loadPdfJs();
      // pdf.js takes the buffer over: give it a copy so the cached bytes stay usable.
      loaded = (await lib.getDocument({ data: new Uint8Array(bytes.data.slice(0)), isEvalSupported: false }).promise) as unknown as PdfDoc;
      if (cancelled) { void loaded.destroy(); return; }
      setDoc(loaded);
      onPages?.(loaded.numPages);
    })().catch(() => { if (!cancelled) setDrawError(true); });
    return () => { cancelled = true; void loaded?.destroy().catch(() => {}); };
  }, [bytes.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const frame = cn("relative min-h-48 overflow-hidden rounded-lg border border-border bg-muted/40", className);
  if (bytes.isPending || (bytes.data && !doc && !drawError)) {
    return (
      <div className={cn(frame, "flex flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground")} role="status">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>{kind === "doc" ? t("Preparing the preview… (a page takes a few seconds)") : t("Loading the preview…")}</span>
      </div>
    );
  }
  if (bytes.isError || drawError) {
    return (
      <div className={cn(frame, "flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground")}>
        <AlertCircle className="h-5 w-5" />
        <span>{bytes.isError ? printErrorText(bytes.error) : t("The preview couldn't be drawn. Printing still works.")}</span>
        <Button variant="outline" size="sm" onClick={() => { setDrawError(false); void bytes.refetch(); }}>{t("Try again")}</Button>
      </div>
    );
  }
  if (!doc || doc.numPages === 0) {
    return (
      <div className={cn(frame, "flex flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground")}>
        <FileText className="h-5 w-5" />
        <span>{t("This file has no pages to show.")}</span>
      </div>
    );
  }
  return (
    <div className={frame}>
      <div ref={scroller} className="h-full overflow-y-auto overscroll-contain p-3">
        <ul className="grid grid-cols-3 gap-3" aria-label={t("Pages")}>
          {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
            <Thumb key={n} doc={doc} n={n} root={scroller} dim={!!selected && !selected.has(n)} mono={mono} onOpen={() => setBig(n)} />
          ))}
        </ul>
      </div>
      {big !== null && <BigPage doc={doc} n={big} mono={mono} dim={!!selected && !selected.has(big)} onMove={setBig} onClose={() => setBig(null)} />}
    </div>
  );
}

function Thumb({ doc, n, root, dim, mono, onOpen }: {
  doc: PdfDoc; n: number; root: RefObject<HTMLDivElement | null>; dim: boolean; mono: boolean; onOpen: () => void;
}) {
  const { t } = useLang();
  const el = useRef<HTMLLIElement | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let url: string | null = null;
    let cancelled = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      drawPage(doc, n, Math.max(90, node.clientWidth)).then((u) => {
        url = u;
        if (cancelled) URL.revokeObjectURL(u);
        else setImg(u);
      }).catch(() => { if (!cancelled) setFailed(true); });
    }, { root: root.current, rootMargin: "200px 0px" });
    io.observe(node);
    return () => { cancelled = true; io.disconnect(); if (url) URL.revokeObjectURL(url); };
  }, [doc, n, root]);
  return (
    <li ref={el} className="min-w-0">
      <button type="button" onClick={onOpen} aria-label={t("Page {n}, show larger", { n })}
        className={cn("block w-full overflow-hidden rounded-md border border-border bg-white shadow-sm transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", dim && "opacity-30")}>
        {img ? <img src={img} alt="" className={cn("block h-auto w-full", mono && "grayscale")} />
          : <div className={cn("aspect-[1/1.414] w-full", failed ? "bg-muted" : "animate-pulse bg-muted")} />}
      </button>
      <div className={cn("mt-1 text-center text-[11px] tabular-nums text-muted-foreground", dim && "opacity-50")}>{n}</div>
    </li>
  );
}

function BigPage({ doc, n, mono, dim, onMove, onClose }: { doc: PdfDoc; n: number; mono: boolean; dim: boolean; onMove: (n: number) => void; onClose: () => void }) {
  const { t } = useLang();
  const box = useRef<HTMLDivElement | null>(null);
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setImg(null);
    drawPage(doc, n, Math.max(320, box.current?.clientWidth ?? 480)).then((u) => {
      url = u;
      if (cancelled) URL.revokeObjectURL(u);
      else setImg(u);
    }).catch(() => {});
    box.current?.focus();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [doc, n]);
  const onKey = useCallback((e: KeyboardEvent) => {
    // Esc: the Print dialog's own Esc handler closes this view first (data-print-big-close), not the dialog.
    if (e.key === "ArrowRight" && n < doc.numPages) onMove(n + 1);
    if (e.key === "ArrowLeft" && n > 1) onMove(n - 1);
  }, [n, doc.numPages, onMove]);
  return (
    <div ref={box} tabIndex={-1} onKeyDown={onKey} role="group" aria-label={t("Page {n} of {total}", { n, total: doc.numPages })}
      className="absolute inset-0 z-10 flex flex-col bg-background/95 outline-none backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={n <= 1} onClick={() => onMove(n - 1)} aria-label={t("Previous page")}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="text-xs tabular-nums text-muted-foreground">{t("Page {n} of {total}", { n, total: doc.numPages })}{dim ? ` · ${t("not printed")}` : ""}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={n >= doc.numPages} onClick={() => onMove(n + 1)} aria-label={t("Next page")}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label={t("Back to all pages")} data-print-big-close=""><X className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {img ? <img src={img} alt="" className={cn("mx-auto block h-auto w-full max-w-full bg-white shadow", mono && "grayscale", dim && "opacity-40")} />
          : <div className="mx-auto aspect-[1/1.414] w-full animate-pulse rounded bg-muted" />}
      </div>
    </div>
  );
}
