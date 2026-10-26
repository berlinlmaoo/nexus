import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Image as ImageIcon, X, Loader2 } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { useMentionAutocomplete, type MentionUser } from "@/hooks/useMentionAutocomplete";
import { MentionList } from "./feed-shared";
import { useLang } from "@/lib/lang";

const TEXT_MAX = 280;
const IMG_MAX = 4;

export type ComposerPayload = { text: string; mentions: string[]; images: File[]; imageMeta: { w?: number; h?: number }[] };
type Pic = { file: File; url: string; w?: number; h?: number };

/** Grow a textarea with its text (no inner scrollbar until it is very long). */
export function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, max = 420) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [ref, value, max]);
}

/** The outlined Threads "Post" button; filled once there is something to post. */
export function PostButton({ ready, busy, onClick, label }: { ready: boolean; busy?: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={!ready || busy}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-4 text-[15px] font-semibold transition-[background-color,color,transform] active:scale-[0.96] disabled:active:scale-100",
        ready ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90" : "border-border bg-transparent text-foreground/40",
      )}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {label}
    </button>
  );
}

/**
 * The inline "What's new?" row at the top of the feed, as on Threads: avatar · one-line field · Post.
 * It grows as you type; the photo button and photos show once you are writing. Cmd/Ctrl+Enter posts.
 */
export function Composer({ me, members, onPost, autoFocus }: { me?: MentionUser; members: MentionUser[]; onPost: (p: ComposerPayload) => void; autoFocus?: boolean }) {
  const { t } = useLang();
  const [pics, setPics] = useState<Pic[]>([]);
  const [focused, setFocused] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mention = useMentionAutocomplete({ members });
  const { text } = mention;
  useAutoGrow(mention.ref, text);

  const len = text.length;
  const over = len > TEXT_MAX;
  const remaining = TEXT_MAX - len;
  const showRing = len >= 220;
  const canPost = (text.trim().length > 0 || pics.length > 0) && !over;
  const expanded = focused || text.length > 0 || pics.length > 0;

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const room = IMG_MAX - pics.length;
    const next = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, room);
    next.forEach((file) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => setPics((prev) => prev.map((p) => (p.file === file ? { ...p, w: img.naturalWidth, h: img.naturalHeight } : p)));
      img.src = url;
      setPics((prev) => [...prev, { file, url }]);
    });
  };
  const removePic = (i: number) => setPics((prev) => { URL.revokeObjectURL(prev[i].url); return prev.filter((_, x) => x !== i); });

  const submit = () => {
    if (!canPost) return;
    onPost({ text: text.trim(), mentions: mention.resolveIds(text.trim()), images: pics.map((p) => p.file), imageMeta: pics.map((p) => ({ w: p.w, h: p.h })) });
    mention.reset();
    setPics([]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); return; }
    mention.onKeyDown(e);
  };

  // ring geometry
  const r = 10, C = 2 * Math.PI * r, pct = Math.min(len / TEXT_MAX, 1);

  return (
    <div className="border-b border-border px-3 py-4 md:px-6">
      <div className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-x-3">
        {me ? <Avatar userId={me.id} name={me.name} avatar={me.avatar} size={36} /> : <div />}
        <div className="relative min-w-0">
          <textarea
            ref={mention.ref}
            value={text}
            autoFocus={autoFocus}
            onChange={mention.onChange}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            aria-label={t("What's new?")}
            placeholder={t("What's new?")}
            className="block min-h-9 w-full resize-none border-0 bg-transparent px-0 py-[7px] text-[15px] leading-[21px] outline-none placeholder:text-muted-foreground"
          />
          {mention.open && <MentionList matches={mention.matches} active={mention.active} onPick={mention.pick} />}

          {pics.length > 0 && (
            <div className="mt-1.5 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {pics.map((p, i) => (
                <div key={p.url} className="group relative h-40 shrink-0 overflow-hidden rounded-lg border border-border" style={{ aspectRatio: p.w && p.h ? `${p.w} / ${p.h}` : "4 / 5" }}>
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => removePic(i)} aria-label={t("Remove photo")} className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black/75"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}

          {/* Kept mounted (only hidden) so a blur → click on it still lands. */}
          <div className={cn("-ml-2 mt-1 flex items-center gap-1", !expanded && "hidden")}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
              disabled={pics.length >= IMG_MAX}
              aria-label={t("Add photo")}
              title={t("Add photo")}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <ImageIcon className="h-5 w-5" strokeWidth={1.75} />
            </button>
            {pics.length > 0 && <span className="text-[13px] tabular-nums text-muted-foreground">{pics.length}/{IMG_MAX}</span>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        </div>

        <div className="flex h-9 items-center gap-2">
          <AnimatePresence>
            {showRing && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: over ? 1.12 : 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ type: "spring", stiffness: 360, damping: 18 }}
                className="relative grid h-7 w-7 place-items-center"
              >
                <svg viewBox="0 0 28 28" className="h-7 w-7 -rotate-90">
                  <circle cx="14" cy="14" r={r} fill="none" strokeWidth="2.5" className="stroke-muted" />
                  <circle cx="14" cy="14" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round"
                    className={cn(over ? "stroke-rose-500" : remaining <= 20 ? "stroke-amber-500" : "stroke-[var(--ring)]")}
                    strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
                </svg>
                {remaining <= 20 && <span className={cn("absolute text-[10px] font-bold tabular-nums", over ? "text-rose-500" : "text-amber-600 dark:text-amber-400")}>{remaining}</span>}
              </motion.div>
            )}
          </AnimatePresence>
          <PostButton ready={canPost} onClick={submit} label={t("Post")} />
        </div>
      </div>
    </div>
  );
}
