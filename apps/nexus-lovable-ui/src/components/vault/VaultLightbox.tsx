import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, Share2, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { VaultItem } from "@/lib/nexus-api";
import { mediaKind, thumbSrc, viewerSrc } from "@/lib/vault-media";

// ─────────────────────────────────────────────────────────────────────────────
// The pictures and films of one vault folder, full screen (owner, 9 Oct 2026). A picture fits the
// screen and zooms (wheel or trackpad pinch, two fingers, double-click, + and -); prev/next with the
// arrow keys, the side buttons or a swipe; Esc closes. A film plays with the browser's own controls,
// which the vault's Range support (lib/file-response.ts) is what makes seekable.
//
// Radix's Dialog underneath for the parts that are easy to get wrong by hand: focus moves in and
// back out, the page behind is inert to a screen reader, and Esc closes.
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  items: VaultItem[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onShare: (item: VaultItem) => void;
};

const MAX_SCALE = 6;

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

export function VaultLightbox({ items, index, onIndexChange, onClose, onShare }: Props) {
  const { t, lang } = useLang();
  const open = index !== null && index >= 0 && index < items.length;
  const item = open ? items[index] : null;
  const count = items.length;

  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      const next = index + delta;
      if (next >= 0 && next < count) onIndexChange(next);
    },
    [index, count, onIndexChange],
  );

  // Arrow keys page, unless a film's own controls have the focus (there they seek).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "VIDEO" || target.tagName === "INPUT" || target.isContentEditable)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  // The neighbours' pictures start loading now, so paging feels instant.
  useEffect(() => {
    if (index === null) return;
    for (const n of [items[index - 1], items[index + 1]]) {
      if (!n || mediaKind(n) !== "image") continue;
      const src = viewerSrc(n);
      if (src) { const img = new Image(); img.src = src; }
    }
  }, [index, items]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black" />
        <DialogPrimitive.Content
          lang={lang}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {item && (
            <>
              <header className="flex items-center gap-2 px-3 sm:px-5 py-2.5 bg-gradient-to-b from-black/70 to-transparent">
                <div className="min-w-0 flex-1">
                  <DialogPrimitive.Title className="truncate text-sm font-medium">{item.name}</DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-xs text-white/60 tabular-nums">
                    {count > 1 ? t("{index} of {total}", { index: (index ?? 0) + 1, total: count }) : t("Preview")}
                  </DialogPrimitive.Description>
                </div>
                <a
                  href={item.downloadUrl ?? "#"}
                  className="h-10 w-10 grid place-items-center rounded-full hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                  aria-label={t("Download")}
                  title={t("Download")}
                >
                  <Download className="h-5 w-5" />
                </a>
                <button
                  type="button"
                  onClick={() => onShare(item)}
                  className="h-10 w-10 grid place-items-center rounded-full hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                  aria-label={t("Share")}
                  title={t("Share")}
                >
                  <Share2 className="h-5 w-5" />
                </button>
                <DialogPrimitive.Close
                  className="h-10 w-10 grid place-items-center rounded-full hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                  aria-label={t("Close")}
                  title={`${t("Close")} (Esc)`}
                >
                  <X className="h-5 w-5" />
                </DialogPrimitive.Close>
              </header>

              <div className="relative flex-1 min-h-0">
                {mediaKind(item) === "video" ? (
                  <VideoStage key={item.id} item={item} />
                ) : (
                  <ImageStage key={item.id} item={item} onSwipe={go} />
                )}

                {count > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => go(-1)}
                      disabled={index === 0}
                      className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 h-11 w-11 grid place-items-center rounded-full bg-black/40 hover:bg-black/60 disabled:opacity-30 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                      aria-label={t("Previous")}
                      title={t("Previous")}
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <button
                      type="button"
                      onClick={() => go(1)}
                      disabled={index === count - 1}
                      className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 h-11 w-11 grid place-items-center rounded-full bg-black/40 hover:bg-black/60 disabled:opacity-30 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                      aria-label={t("Next")}
                      title={t("Next")}
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ── a picture ────────────────────────────────────────────────────────────────

/**
 * Fit to the stage, then zoom and pan. One transform, `translate(x, y) scale(s)` around the centre;
 * a zoom keeps the point under the cursor (or between two fingers) where it is. Unzoomed, a
 * horizontal drag is a swipe to the neighbour.
 */
function ImageStage({ item, onSwipe }: { item: VaultItem; onSwipe: (delta: number) => void }) {
  const { t } = useLang();
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [swipe, setSwipe] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; pinch: number; view: View; moved: boolean } | null>(null);
  const lastTap = useRef(0);

  const src = viewerSrc(item);
  const placeholder = thumbSrc(item, 640);

  /** A point on screen as an offset from the stage's centre. */
  const fromCentre = useCallback((clientX: number, clientY: number) => {
    const r = stage.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
  }, []);

  const zoomAt = useCallback((next: number, q: { x: number; y: number }, from: View): View => {
    const scale = Math.min(MAX_SCALE, Math.max(1, next));
    if (scale === 1) return FIT;
    const k = scale / from.scale;
    return { scale, x: q.x - k * (q.x - from.x), y: q.y - k * (q.y - from.y) };
  }, []);

  // The wheel zooms (there is nothing to scroll), and a trackpad pinch arrives as a wheel with ctrlKey.
  // A listener of its own, not onWheel: React's is passive, and only a non-passive one may stop the
  // browser from zooming the whole page on that pinch.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      const q = fromCentre(e.clientX, e.clientY);
      setView((v) => zoomAt(v.scale * factor, q, v));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fromCentre, zoomAt, src, failed]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = {
      startX: pts[0].x,
      startY: pts[0].y,
      pinch: pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
      view,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.pinch > 0) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = fromCentre((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      g.moved = true;
      setView(zoomAt(g.view.scale * (dist / g.pinch), mid, g.view));
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) g.moved = true;
    if (g.view.scale > 1) setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    else setSwipe(dx);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      // One finger of a pinch lifted: carry on from here with the other one.
      const [rest] = [...pointers.current.values()];
      gesture.current = { startX: rest.x, startY: rest.y, pinch: 0, view, moved: true };
      return;
    }
    gesture.current = null;
    if (!g) return;
    if (g.view.scale === 1 && !g.pinch) {
      const dx = e.clientX - g.startX;
      setSwipe(0);
      if (dx <= -60) { onSwipe(1); return; }
      if (dx >= 60) { onSwipe(-1); return; }
    }
    if (!g.moved && e.pointerType !== "mouse") {
      // A double tap on a touch screen: in to 2.5× at the finger, or back to fit.
      const now = Date.now();
      if (now - lastTap.current < 300) {
        const q = fromCentre(e.clientX, e.clientY);
        setView((v) => (v.scale > 1 ? FIT : zoomAt(2.5, q, v)));
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const q = fromCentre(e.clientX, e.clientY);
    setView((v) => (v.scale > 1 ? FIT : zoomAt(2.5, q, v)));
  };

  // + / - / 0 from the keyboard, around the centre.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") setView((v) => zoomAt(v.scale * 1.5, { x: 0, y: 0 }, v));
      else if (e.key === "-" || e.key === "_") setView((v) => zoomAt(v.scale / 1.5, { x: 0, y: 0 }, v));
      else if (e.key === "0") setView(FIT);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomAt]);

  if (!src || failed) {
    return (
      <div className="absolute inset-0 grid place-items-center p-8 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-sm text-white/80">{t("This picture can't be shown in the browser. Download it to open it.")}</p>
          <a href={item.downloadUrl ?? "#"} className="inline-flex items-center gap-2 rounded-full bg-white/15 hover:bg-white/25 px-4 py-2 text-sm">
            <Download className="h-4 w-4" /> {t("Download")}
          </a>
        </div>
      </div>
    );
  }

  const zoomed = view.scale > 1;
  return (
    <div
      ref={stage}
      className={cn("absolute inset-0 overflow-hidden select-none touch-none", zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {placeholder && !loaded && (
        <img src={placeholder} alt="" aria-hidden className="absolute inset-0 m-auto max-h-full max-w-full object-contain blur-sm opacity-70" draggable={false} />
      )}
      <img
        src={src}
        alt={item.name}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn("absolute inset-0 m-auto max-h-full max-w-full object-contain transition-opacity duration-150", loaded ? "opacity-100" : "opacity-0")}
        style={{
          transform: `translate(${view.x + swipe}px, ${view.y}px) scale(${view.scale})`,
          transition: gesture.current ? "none" : "transform 160ms ease-out",
        }}
      />
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-black/45 p-1">
        <button
          type="button"
          className="h-9 w-9 grid place-items-center rounded-full hover:bg-white/15 disabled:opacity-30"
          onClick={() => setView((v) => zoomAt(v.scale / 1.5, { x: 0, y: 0 }, v))}
          disabled={!zoomed}
          aria-label={t("Zoom out")}
          title={t("Zoom out")}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="min-w-[3.25rem] text-center text-xs tabular-nums text-white/80">{Math.round(view.scale * 100)}%</span>
        <button
          type="button"
          className="h-9 w-9 grid place-items-center rounded-full hover:bg-white/15 disabled:opacity-30"
          onClick={() => setView((v) => zoomAt(v.scale * 1.5, { x: 0, y: 0 }, v))}
          disabled={view.scale >= MAX_SCALE}
          aria-label={t("Zoom in")}
          title={t("Zoom in")}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── a film ───────────────────────────────────────────────────────────────────

function VideoStage({ item }: { item: VaultItem }) {
  const { t } = useLang();
  const [failed, setFailed] = useState(false);
  if (failed || !item.url) {
    return (
      <div className="absolute inset-0 grid place-items-center p-8 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-sm text-white/80">{t("This video can't play in the browser. Download it to watch it.")}</p>
          <a href={item.downloadUrl ?? "#"} className="inline-flex items-center gap-2 rounded-full bg-white/15 hover:bg-white/25 px-4 py-2 text-sm">
            <Download className="h-4 w-4" /> {t("Download")}
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 grid place-items-center px-2 pb-4 sm:px-16">
      <video
        src={item.url}
        controls
        autoPlay
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        className="max-h-full max-w-full rounded-md bg-black"
      />
    </div>
  );
}
