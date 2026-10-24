import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import type { FeedImage } from "@/lib/nexus-api";
import type { MentionUser } from "@/hooks/useMentionAutocomplete";
import { localeOf, t as tr, useLang } from "@/lib/lang";

/**
 * Relative time, one rule on every platform (UI tour run 13, W-B9: "6d" next to "30 Jun" read as two
 * systems): "now", "5m ago", "3h ago", "6d ago", then the date ("30 Jun"; the year only when it isn't this one).
 */
export function timeAgo(iso: string): string {
  // Called while rendering, so the current language applies.
  const date = new Date(iso);
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return tr("now");
  const m = Math.floor(s / 60); if (m < 60) return tr("{n}m ago", { n: m });
  const h = Math.floor(m / 60); if (h < 24) return tr("{n}h ago", { n: h });
  const d = Math.floor(h / 24); if (d < 7) return tr("{n}d ago", { n: d });
  const otherYear = date.getFullYear() !== new Date().getFullYear();
  return date.toLocaleDateString(localeOf(), { day: "numeric", month: "short", ...(otherYear ? { year: "numeric" } : {}) });
}

const MENTION_RE = /(@[\p{L}\p{N}._-]+)/gu;
/** Plain-text post body with @mentions highlighted (XSS-safe — never injects HTML). */
export function RenderText({ text }: { text: string }) {
  const parts = text.split(MENTION_RE);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) =>
        p.startsWith("@") && p.length > 1
          ? <span key={i} className="font-medium text-accent-foreground">{p}</span>
          : <span key={i}>{p}</span>,
      )}
    </span>
  );
}

/** The @-mention autocomplete dropdown (shared by the post composer + comment box). */
export function MentionList({ matches, active, onPick }: { matches: MentionUser[]; active: number; onPick: (u: MentionUser) => void }) {
  if (!matches.length) return null;
  return (
    <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-64 overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1 shadow-pop">
      {matches.map((u, i) => (
        <button key={u.id} type="button" onMouseDown={(e) => { e.preventDefault(); onPick(u); }}
          className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors", i === active ? "bg-accent" : "hover:bg-accent")}>
          <Avatar userId={u.id} name={u.name} avatar={u.avatar} size={22} />
          <span className="truncate">{u.name ?? u.email}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Post photos, laid out like Threads (24 Oct 2026): one photo at its own shape, up to 430px tall and never
 * wider than the text column; two or more in a sideways row of equal-height tiles that scrolls (snap) and
 * runs to the edge of the post (`bleed`). Width/height from the server reserve the box (no layout shift).
 */
export function ImageGrid({ images, onOpen, bleed }: { images: FeedImage[]; onOpen: (i: number) => void; bleed?: boolean }) {
  if (!images.length) return null;
  const ratioOf = (im: FeedImage) => (im.width && im.height ? `${im.width} / ${im.height}` : "4 / 5");

  if (images.length === 1) {
    const im = images[0];
    return (
      <button type="button" aria-label={tr("Open photo")} onClick={() => onOpen(0)}
        className="mt-2 block max-w-full overflow-hidden rounded-lg border border-border/70 bg-muted">
        <img src={im.url} loading="lazy" alt="" width={im.width ?? undefined} height={im.height ?? undefined}
          className="block h-auto max-h-[430px] w-auto max-w-full object-contain" style={{ aspectRatio: ratioOf(im) }} />
      </button>
    );
  }

  return (
    <div className={cn("mt-2 flex snap-x snap-mandatory gap-1.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", bleed && "-mr-4 pr-4 md:-mr-6 md:pr-6")}>
      {images.map((im, i) => (
        <button type="button" key={im.id} aria-label={tr("Open photo {n} of {total}", { n: i + 1, total: images.length })} onClick={() => onOpen(i)}
          className="h-[220px] shrink-0 snap-start overflow-hidden rounded-lg border border-border/70 bg-muted md:h-[250px]" style={{ aspectRatio: ratioOf(im) }}>
          <img src={im.url} loading="lazy" alt="" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}

/** Fullscreen image viewer with keyboard nav. */
export function Lightbox({ images, index, onClose }: { images: FeedImage[]; index: number; onClose: () => void }) {
  const { t } = useLang();
  const [i, setI] = useState(index);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => (x + 1) % images.length);
      if (e.key === "ArrowLeft") setI((x) => (x - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[80] grid grid-cols-1 place-items-center bg-black/90 p-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <button onClick={onClose} aria-label={t("Close")} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><X className="h-5 w-5" /></button>
        <motion.img
          key={images[i].id}
          src={images[i].url} alt=""
          initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain"
          onClick={(e) => e.stopPropagation()}
        />
        {images.length > 1 && (
          <>
            <button onClick={(e) => { e.stopPropagation(); setI((x) => (x - 1 + images.length) % images.length); }} aria-label={t("Previous photo")} className="absolute left-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><ChevronLeft className="h-6 w-6" /></button>
            <button onClick={(e) => { e.stopPropagation(); setI((x) => (x + 1) % images.length); }} aria-label={t("Next photo")} className="absolute right-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><ChevronRight className="h-6 w-6" /></button>
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">{i + 1} / {images.length}</div>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
