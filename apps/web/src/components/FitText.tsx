import { type CSSProperties, type ElementType, type HTMLAttributes, useLayoutEffect, useRef } from "react";

/**
 * A name in a fixed-width spot (the sidebar project tree, a leaderboard row, a My Tasks row) that is never cut
 * (owner, 24 Oct 2026: "gw gamau kepotong"; widths and layout stay as they are). In this order:
 *   1. wraps between whole words, up to `lines` lines (2);
 *   2. if that is not enough, shrinks a little, 1/2 px at a time, down to `minScale` (75%, like the project title);
 *   3. still too long: takes more lines at that size. There is no ellipsis.
 * A single word wider than the whole line is split only after the shrink, as the very last resort.
 * The full text is also the element's tooltip. Clears its own inline size on every pass, so a wider box or a
 * shorter name gets the full size back.
 */
export function FitText({
  text,
  as: Tag = "span",
  lines = 2,
  minScale = 0.75,
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
      el.removeAttribute("data-fit-over");
      const base = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (!base || !el.clientWidth) return;
      const min = Math.ceil(base * minScale * 2) / 2;
      const tooTall = () => {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 0;
        return lh > 0 && el.scrollHeight > lh * lines + 2;
      };
      const tooWide = () => el.scrollWidth > el.clientWidth + 1;
      for (let size = base; (tooTall() || tooWide()) && size > min; ) {
        size = Math.max(min, size - 0.5);
        el.style.fontSize = `${size}px`;
      }
      // Last resort for a word wider than the line on its own: split it rather than cut it.
      if (tooWide()) el.style.overflowWrap = "anywhere";
      // More lines than `lines` from here on (never an ellipsis); marked for QA.
      if (tooTall()) el.setAttribute("data-fit-over", "");
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    fit();
    void document.fonts?.ready.then(schedule).catch(() => {});
    // Width only: the fit itself changes the height.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { if (el.clientWidth !== lastWidth) schedule(); });
    ro?.observe(el);
    return () => { cancelAnimationFrame(frame); ro?.disconnect(); };
  }, [text, lines, minScale]);

  const wrap: CSSProperties = {
    display: "block",
    // Inline, so a parent's `truncate` (shadcn's sidebar button) cannot force one line or an ellipsis again.
    whiteSpace: "normal",
    textOverflow: "clip",
    overflow: "visible",
    wordBreak: "normal",
    overflowWrap: "normal",
    ...style,
  };
  return (
    <Tag ref={ref} data-fit-text="" title={title === null ? undefined : (title ?? text)} style={wrap} {...rest}>
      {text}
    </Tag>
  );
}
