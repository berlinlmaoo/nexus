import { useEffect, useRef, useState } from "react";
import { FileText, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * The first page of a PDF as a picture, for phone widths (visual QA 24 Oct, owner 25 Oct 2026): an <iframe>
 * of a PDF is a blank grey box in Chrome on Android and only a fixed first page in iPhone Safari. pdf.js
 * draws page 1 here; a tap opens the whole file in the browser's own viewer, which can be zoomed.
 * pdf.js and its worker load on first use only, so screens without a PDF never download them.
 */

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjs) {
    pdfjs = Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      // Bundled by Vite as a classic worker with a .js name: nginx serves the package's own .mjs file as
      // application/octet-stream, which a module worker refuses (the preview stayed "could not be drawn").
      import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker"),
    ]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerPort = new worker.default();
      return lib;
    }).catch((e) => {
      pdfjs = null; // a failed chunk load may succeed on the next try
      throw e;
    });
  }
  return pdfjs;
}

export function PdfFirstPage({ src, href, title, className }: {
  /** The PDF to draw (same origin, sent with the session cookie). */
  src: string;
  /** What a tap opens; defaults to `src`. */
  href?: string;
  title: string;
  className?: string;
}) {
  const { t } = useLang();
  const box = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setImg(null);
    setFailed(false);
    const cssWidth = Math.max(240, Math.round(box.current?.clientWidth || 360));
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    let task: { destroy: () => Promise<void> } | null = null;
    (async () => {
      const lib = await loadPdfJs();
      const loading = lib.getDocument({ url: src, withCredentials: true, isEvalSupported: false });
      task = loading;
      const doc = await loading.promise;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (cssWidth * dpr) / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      // White paper under the page: a PDF without a background would show the card colour in dark mode.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      void doc.destroy();
      if (!blob) throw new Error("no image");
      url = URL.createObjectURL(blob);
      if (cancelled) URL.revokeObjectURL(url);
      else setImg(url);
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      void task?.destroy().catch(() => {});
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);

  return (
    <a
      href={href ?? src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("Open {name} full screen", { name: title })}
      className={cn("group relative block overflow-hidden rounded-md border border-border bg-muted focus-visible:outline-2 focus-visible:outline-ring", className)}
    >
      <div ref={box} className="w-full">
        {img ? (
          <img src={img} alt={t("First page of {name}", { name: title })} className="block h-auto w-full bg-white" />
        ) : failed ? (
          <div className="flex aspect-[1/1.414] w-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <FileText aria-hidden className="h-8 w-8" />
            <span>{t("The preview could not be drawn. Tap to open the PDF.")}</span>
          </div>
        ) : (
          <div className="aspect-[1/1.414] w-full animate-pulse bg-muted" aria-label={t("Loading preview")} role="img" />
        )}
      </div>
      {img && (
        <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-foreground/80 px-2.5 py-1 text-xs font-medium text-background">
          <Maximize2 aria-hidden className="h-3.5 w-3.5" />{t("Tap to open")}
        </span>
      )}
    </a>
  );
}

/**
 * A PDF on screen: the browser's own viewer in an <iframe> from tablet width up, the drawn first page (tap
 * opens the whole file) on a phone.
 */
export function PdfPreview({ src, frameSrc, href, title, frameClassName, pageClassName }: {
  /** The PDF itself (drawn on a phone, opened on tap). */
  src: string;
  /** What the <iframe> loads, when it needs extra parameters (`#toolbar=0`, a cache-bust); defaults to `src`. */
  frameSrc?: string;
  href?: string;
  title: string;
  frameClassName?: string;
  pageClassName?: string;
}) {
  const phone = useIsMobile();
  if (phone) return <PdfFirstPage src={src} href={href} title={title} className={pageClassName} />;
  return <iframe src={frameSrc ?? src} title={title} className={frameClassName} />;
}
