import { type CSSProperties, type ElementType, type HTMLAttributes, useLayoutEffect, useRef } from "react";

/**
 * A name in a fixed-width spot (the sidebar project tree, a leaderboard row, a My Tasks row) that is never cut
 * while it can still be read in full (owner rule, QA final #2, 24 Oct 2026: no cut-off text, but no layout
 * change). In this order:
 *   1. wraps between words onto a second line (never inside a word);
 *   2. if two lines are not enough, shrinks a little, 1/2 px at a time, down to `minScale` of its size;
 *   3. only then: an ellipsis after the second line. A single word wider than the whole line is split only in
 *      this last step, after the shrink.
 * The full text is always the element's tooltip. The same approach as the project title fit (PageHeader).
 * Clears its own inline size on every pass, so a wider box or a shorter name gets the full size back.
 */
export function FitText({
  text,
  as: Tag = "span",
  lines = 2,
  minScale = 0.8,
  title,
  style,
  ...rest
}: {
  text: string;
  as?: ElementType;
  lines?: number;
  minScale?: number;
  /** Tooltip; defaults to the text. Pass `null` when the row around it already carries the same title. */
  title?: string | null;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "title">) {
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let lastWidth = -1;
    const fit = () => {
      lastWidth = el.clientWidth;
      el.style.fontSize = "";
      el.style.overflowWrap = "normal";
      el.removeAttribute("data-fit-cut");
      const cs = getComputedStyle(el);
      const base = parseFloat(cs.fontSize) || 0;
      if (!base || !el.clientWidth) return;
      const min = Math.ceil(base * minScale * 2) / 2;
      // Over = more lines than allowed (the clamp hides them) or a word sticking out sideways.
      const over = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
      for (let size = base; over() && size > min; ) {
        size = Math.max(min, size - 0.5);
        el.style.fontSize = `${size}px`;
      }
      if (!over()) return;
      // Last resort: a word too long for a line on its own may now be split, then the clamp's ellipsis.
      el.style.overflowWrap = "anywhere";
      if (over()) el.setAttribute("data-fit-cut", "");
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    fit();
    void document.fonts?.ready.then(schedule).catch(() => {});
    // Width only: the fit itself changes the height.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { if (el.clientWidth !== lastWidth) schedule(); });
    ro?.observe(el);
    return () => { cancelAnimationFrame(frame); ro?.disconnect(); };
  }, [text, lines, minScale]);

  const clamp: CSSProperties = {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
    // Inline, so a parent's `truncate` (shadcn's sidebar button) cannot force one line again.
    whiteSpace: "normal",
    wordBreak: "normal",
    overflowWrap: "normal",
    ...style,
  };
  return (
    <Tag ref={ref} data-fit-text="" title={title === null ? undefined : (title ?? text)} style={clamp} {...rest}>
      {text}
    </Tag>
  );
}
