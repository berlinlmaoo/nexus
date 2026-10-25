import { cn } from "@/lib/utils";

/**
 * "Level 6 · Diamond" that wraps cleanly: when the parts do not fit on one line, the next part moves down
 * whole and the "·" that would end the first line is not shown ("Level 6 · / Diamond", visual QA 24 Oct).
 * Each part after the first carries its separator in front; the box is shifted left by one separator's width
 * and clipped, so a part that starts a line has its separator cut off. A text without " · " renders as is.
 */
export function DotLine({ text, className }: { text: string; className?: string }) {
  const parts = text.split(" · ");
  if (parts.length < 2) return <span className={className}>{text}</span>;
  return (
    <span className={cn("block min-w-0 overflow-hidden", className)} aria-label={text}>
      <span aria-hidden className="-ml-[0.8em] flex flex-wrap">
        {parts.map((part, i) => (
          <span key={i} className="min-w-0 before:inline-block before:w-[0.8em] before:text-center before:content-['·']">{part}</span>
        ))}
      </span>
    </span>
  );
}
