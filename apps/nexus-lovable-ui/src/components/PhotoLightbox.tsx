// A photo, full screen, and the avatar that opens it (owner, 9 Oct 2026: a way to actually see someone's
// profile picture). The iPhone has the same pair: ZoomableAvatar → PhotoViewer.
//
// Close with Esc, the close button or a click on the dark backdrop. Zoom with the buttons, the mouse wheel
// or a trackpad pinch, a double-click, the + / − / 0 keys, or two fingers on a touch screen; drag to pan
// while zoomed. Back at 100% the photo returns to the middle. Rendered into <body>, so no transformed or
// clipped ancestor of the avatar can trap it.
import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, Shrink, X, ZoomIn } from "lucide-react";
import { AvatarFace, useUserLookup } from "@/components/Avatar";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const STEP = 1.5;
type ViewState = { s: number; x: number; y: number };
const FIT: ViewState = { s: 1, x: 0, y: 0 };

/** Zoom to `s` (clamped). The pan scales with it, and at 100% the photo goes back to the middle. */
function zoomed(v: ViewState, s: number): ViewState {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  if (next === MIN_SCALE) return FIT;
  const k = next / v.s;
  return { s: next, x: v.x * k, y: v.y * k };
}

const barButton =
  "grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-35 disabled:hover:bg-white/10 motion-reduce:transition-none";

export function PhotoLightbox({ src, title, onClose }: { src: string; title?: string | null; onClose: () => void }) {
  const { t, lang } = useLang();
  const [view, setView] = useState<ViewState>(FIT);
  const [failed, setFailed] = useState(false);
  // Width over height, once the photo has loaded: the image box is sized to the picture itself, so a click
  // beside it lands on the backdrop and closes, and a small upload is still shown at a readable size.
  const [ratio, setRatio] = useState<number | null>(null);
  // No transition while a finger or the mouse is moving it: the photo follows the pointer exactly.
  const [moving, setMoving] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; s: number } | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const travelled = useRef(0);
  // Where the last press began. Read instead of the click's own target: with pointer capture on the stage
  // a click that started on the photo is reported on the stage, and would close it.
  const pressedBackdrop = useRef(false);

  const zoomBy = useCallback((factor: number) => setView((v) => zoomed(v, v.s * factor)), []);

  // Esc closes, + / − / 0 zoom, Tab stays inside, the page behind does not scroll, and focus goes back to
  // whatever opened the photo. Capture phase, so an Esc here never also closes something underneath.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setView((v) => zoomed(v, v.s * STEP));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setView((v) => zoomed(v, v.s / STEP));
      } else if (e.key === "0") {
        e.preventDefault();
        setView(FIT);
      } else if (e.key === "Tab" && dialogRef.current) {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const inside = dialogRef.current.contains(document.activeElement);
        if (e.shiftKey && (!inside || document.activeElement === first)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  // The wheel has to be a non-passive listener: a trackpad pinch arrives as ctrl+wheel, and left alone it
  // zooms the whole page instead of the photo.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      setView((v) => zoomed(v, v.s * factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      travelled.current = 0;
      pressedBackdrop.current = e.target === e.currentTarget;
    }
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: viewRef.current.s };
      drag.current = null;
    } else if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
    }
    setMoving(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(e.pointerId);
    if (!before) return;
    travelled.current += Math.hypot(e.clientX - before.x, e.clientY - before.y);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p && pointers.current.size >= 2) {
      const [a, b] = Array.from(pointers.current.values());
      const target = p.s * (Math.hypot(a.x - b.x, a.y - b.y) / p.dist);
      setView((v) => zoomed(v, target));
      return;
    }
    const d = drag.current;
    if (d && viewRef.current.s > 1) {
      const x = d.vx + e.clientX - d.x;
      const y = d.vy + e.clientY - d.y;
      setView((v) => ({ ...v, x, y }));
    }
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      // One finger still down after a pinch: carry on as a pan from where the photo is now.
      const [rest] = Array.from(pointers.current.values());
      drag.current = { x: rest.x, y: rest.y, vx: viewRef.current.x, vy: viewRef.current.y };
    }
    if (pointers.current.size === 0) {
      drag.current = null;
      setMoving(false);
    }
  };

  const label = title ? t("Profile photo of {name}", { name: title }) : t("Profile photo");

  return createPortal(
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} lang={lang} className="fixed inset-0 z-[90] flex flex-col bg-black/95 text-white">
      <div className="flex items-center gap-2 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4">
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
        <button type="button" className={barButton} onClick={() => zoomBy(1 / STEP)} disabled={failed || view.s <= MIN_SCALE} aria-label={t("Zoom out")} title={t("Zoom out")}>
          <Minus className="h-5 w-5" />
        </button>
        <span className="w-12 text-center text-xs font-semibold tabular-nums text-white/80">{Math.round(view.s * 100)}%</span>
        <button type="button" className={barButton} onClick={() => zoomBy(STEP)} disabled={failed || view.s >= MAX_SCALE} aria-label={t("Zoom in")} title={t("Zoom in")}>
          <Plus className="h-5 w-5" />
        </button>
        <button type="button" className={barButton} onClick={() => setView(FIT)} disabled={view.s === MIN_SCALE} aria-label={t("Fit to screen")} title={t("Fit to screen")}>
          <Shrink className="h-5 w-5" />
        </button>
        <button ref={closeRef} type="button" className={cn(barButton, "ml-1")} onClick={onClose} aria-label={t("Close")} title={t("Close")}>
          <X className="h-5 w-5" />
        </button>
      </div>
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden p-4"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        // A click on the backdrop closes; the end of a drag or a pinch that happens to finish there does not.
        onClick={() => { if (pressedBackdrop.current && travelled.current < 6) onClose(); }}
        onDoubleClick={() => { if (!pressedBackdrop.current) setView((v) => (v.s > MIN_SCALE ? FIT : zoomed(v, 2.5))); }}
      >
        {failed ? (
          <p className="text-sm text-white/80">{t("Couldn’t load this photo.")}</p>
        ) : (
          <img
            src={src}
            alt={title ?? ""}
            draggable={false}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              if (w > 0 && h > 0) setRatio(w / h);
            }}
            onError={() => setFailed(true)}
            className={cn(
              "max-h-full max-w-full rounded-lg object-contain",
              view.s > MIN_SCALE ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
              !moving && "transition-transform duration-150 ease-out motion-reduce:transition-none",
            )}
            style={{
              width: ratio ? `min(calc(100vw - 2rem), calc((100dvh - 8rem) * ${ratio}))` : undefined,
              height: "auto",
              transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`,
            }}
          />
        )}
      </div>
      <p className="px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 text-center text-[11px] text-white/70">
        {t("Scroll, pinch or double-click to zoom · Esc to close")}
      </p>
    </div>,
    document.body,
  );
}

/**
 * Someone's face. With a photo it is a button that opens the photo full screen; without one (or when the
 * photo fails to load) it is the usual initials and opens nothing. Same look as `Avatar`, which it reads
 * the same way: the photo passed in, else the workspace directory's.
 */
export function ZoomableAvatar({ userId, name, avatar, size = 64 }: { userId: string; name?: string | null; avatar?: string | null; size?: number }) {
  const { t } = useLang();
  const lookup = useUserLookup();
  const known = lookup.get(userId);
  const label = name ?? known?.name ?? null;
  const src = avatar ?? known?.avatar ?? null;
  const [broken, setBroken] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (!src || src === broken) return <AvatarFace name={label} avatar={null} seed={label || userId} size={size} />;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={label ? t("View {name}'s profile photo", { name: label }) : t("View profile photo")}
        title={t("View profile photo")}
        className="group relative shrink-0 cursor-zoom-in rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        style={{ width: size, height: size }}
      >
        <img src={src} alt="" onError={() => setBroken(src)} className="h-full w-full rounded-full object-cover ring-2 ring-background" />
        <span aria-hidden className="absolute inset-0 grid place-items-center rounded-full bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:bg-black/30 group-focus-visible:opacity-100 motion-reduce:transition-none">
          <ZoomIn className="h-5 w-5" />
        </span>
      </button>
      {open && <PhotoLightbox src={src} title={label} onClose={() => setOpen(false)} />}
    </>
  );
}
