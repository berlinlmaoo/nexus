import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import type { FeedImage } from "@/lib/nexus-api";
import type { MentionUser } from "@/hooks/useMentionAutocomplete";

/** Compact relative time: "just now", "5m", "3h", "2d", then a date. */
export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

const MENTION_RE = /(@[\p{L}\p{N}._-]+)/gu;
/** Plain-text post body with @mentions highlighted (XSS-safe — never injects HTML). */
export function RenderText({ text }: { text: string }) {
  const parts = text.split(MENTION_RE);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) =>
        p.startsWith("@") && p.length > 1
          ? <span key={i} className="font-semibold text-primary">{p}</span>
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

/** 1–4 image collage. Reserves an aspect-ratio box (uses stored width/height when present) to kill CLS. */
export function ImageGrid({ images, onOpen }: { images: FeedImage[]; onOpen: (i: number) => void }) {
  if (!images.length) return null;
  const n = images.length;

  // Single image → fill the column width at the photo's OWN aspect ratio (no white space).
  if (n === 1) {
    const im = images[0];
    const ratio = im.width && im.height ? `${im.width} / ${im.height}` : "4 / 3";
    return (
      <button onClick={() => onOpen(0)} className="mt-2.5 block w-full overflow-hidden rounded-2xl border border-border bg-muted">
        <img src={im.url} loading="lazy" alt="" className="block w-full object-cover transition duration-300 hover:scale-[1.02]" style={{ aspectRatio: ratio, maxHeight: 680 }} />
      </button>
    );
  }

  // 3 images → one tall on the left, two stacked on the right (deterministic; no blank cell).
  if (n === 3) {
    return (
      <div className="mt-2.5 grid aspect-[3/2] grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-2xl border border-border">
        <button onClick={() => onOpen(0)} className="row-span-2 overflow-hidden bg-muted"><img src={images[0].url} loading="lazy" alt="" className="h-full w-full object-cover transition duration-300 hover:scale-[1.03]" /></button>
        <button onClick={() => onOpen(1)} className="overflow-hidden bg-muted"><img src={images[1].url} loading="lazy" alt="" className="h-full w-full object-cover transition duration-300 hover:scale-[1.03]" /></button>
        <button onClick={() => onOpen(2)} className="overflow-hidden bg-muted"><img src={images[2].url} loading="lazy" alt="" className="h-full w-full object-cover transition duration-300 hover:scale-[1.03]" /></button>
      </div>
    );
  }

  // 2 or 4 images → square collage.
  return (
    <div className="mt-2.5 grid grid-cols-2 gap-1 overflow-hidden rounded-2xl border border-border">
      {images.map((im, i) => (
        <button key={im.id} onClick={() => onOpen(i)} className="relative aspect-square overflow-hidden bg-muted">
          <img src={im.url} loading="lazy" alt="" className="h-full w-full object-cover transition duration-300 hover:scale-[1.03]" />
        </button>
      ))}
    </div>
  );
}

/** Fullscreen image viewer with keyboard nav. */
export function Lightbox({ images, index, onClose }: { images: FeedImage[]; index: number; onClose: () => void }) {
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
        className="fixed inset-0 z-[80] grid place-items-center bg-black/90 p-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <button onClick={onClose} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><X className="h-5 w-5" /></button>
        <motion.img
          key={images[i].id}
          src={images[i].url} alt=""
          initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain"
          onClick={(e) => e.stopPropagation()}
        />
        {images.length > 1 && (
          <>
            <button onClick={(e) => { e.stopPropagation(); setI((x) => (x - 1 + images.length) % images.length); }} className="absolute left-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><ChevronLeft className="h-6 w-6" /></button>
            <button onClick={(e) => { e.stopPropagation(); setI((x) => (x + 1) % images.length); }} className="absolute right-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><ChevronRight className="h-6 w-6" /></button>
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">{i + 1} / {images.length}</div>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
