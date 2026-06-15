import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export type MorphOrigin = { x: number; y: number };

/** Center point (viewport coords) of an element — for the `origin` (genie-zoom) fallback. */
export function rectCenter(el: Element | null | undefined): MorphOrigin | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Centered modal with a few open animations (best → fallback):
 *  - `layoutId`  → true shared-element MORPH from a trigger with the same layoutId (StatCard quality).
 *  - `origin`    → genie-zoom from a point (no matching trigger needed).
 *  - neither     → gentle centered scale-fade.
 *
 * `placeholder`: if the real content is heavy (many rows, <img> avatars that decode on mount), pass a
 *  light skeleton here. While the box morphs/zooms we render ONLY the placeholder, then swap in the real
 *  children once the box settles — so nothing heavy reconciles/decodes mid-animation (that was the See
 *  All "laggy banget"). Give the panel a fixed height (className) so the swap doesn't resize the box.
 *
 * Render inside a parent <AnimatePresence>, mounted conditionally, so it animates back on close.
 */
export function MorphPanel({
  layoutId,
  origin,
  originScale,
  onClose,
  children,
  className,
  placeholder,
}: {
  layoutId?: string;
  origin?: MorphOrigin;
  /** Start scale for the genie zoom (≈ sourceWidth / panelWidth) so the box begins at the trigger's
   *  actual size and grows — reads as the card itself expanding, not a zoom from a tiny point. */
  originScale?: number;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  placeholder?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const morph = !reduce && !!layoutId;
  const hasPlaceholder = !reduce && !!placeholder;
  // Heavy content stays unmounted until the opening animation lands (only when a placeholder is given).
  const [settled, setSettled] = useState(!hasPlaceholder);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    // Lock scroll WITHOUT shifting the page: reserve the scrollbar's width as padding so hiding it
    // doesn't change the layout — otherwise every other layoutId card on the page re-animates (jank).
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`;
    // Safety net: reveal content even if the animation-complete events never fire.
    const t = hasPlaceholder ? window.setTimeout(() => setSettled(true), 520) : undefined;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
      if (t) window.clearTimeout(t);
    };
  }, [onClose, hasPlaceholder]);

  if (typeof document === "undefined") return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const collapsed = reduce
    ? { opacity: 0 }
    : origin
      ? { opacity: 0, scale: originScale ?? 0.14, x: origin.x - vw / 2, y: origin.y - vh / 2 }
      : { opacity: 0, scale: 0.92, x: 0, y: 0 };
  const expanded = reduce ? { opacity: 1 } : { opacity: 1, scale: 1, x: 0, y: 0 };
  const onSettle = hasPlaceholder ? () => setSettled(true) : undefined;

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center p-4">
      {/* Plain dim (no backdrop-blur — re-blurring the whole screen each frame janks the morph). */}
      <motion.div className="absolute inset-0 bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        layoutId={morph ? layoutId : undefined}
        role="dialog" aria-modal="true"
        initial={morph ? undefined : collapsed}
        animate={morph ? undefined : expanded}
        exit={morph ? undefined : collapsed}
        // Morph: NO custom transition → framer's tuned default layout-spring (crisp, like StatCard).
        transition={morph ? undefined : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onLayoutAnimationComplete={onSettle}
        onAnimationComplete={onSettle}
        className={cn("relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border", className)}
      >
        {reduce ? children : hasPlaceholder ? (
          // Box zooms showing only the light skeleton; once it lands we hand the real content straight
          // to the modal so IT can run its own entrance (e.g. a staggered row cascade) — wrapping it in
          // our own fade here would just flatten that into one dull opacity blink.
          !settled ? <div className="flex min-h-0 w-full flex-1 flex-col">{placeholder}</div> : children
        ) : (
          // No placeholder → box settles first (delay), THEN content fades in so the trigger's text/photo
          // never crossfades through ("kebawa"). Used by the #5 person-click morph.
          <motion.div
            className="flex min-h-0 w-full flex-1 flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: morph ? 0.2 : 0.16, duration: 0.18 }}
          >
            {children}
          </motion.div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
