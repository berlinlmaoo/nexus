import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Image as ImageIcon, X, Send } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { useMentionAutocomplete, type MentionUser } from "@/hooks/useMentionAutocomplete";
import { MentionList } from "./feed-shared";

const TEXT_MAX = 280;
const IMG_MAX = 4;

export type ComposerPayload = { text: string; mentions: string[]; images: File[]; imageMeta: { w?: number; h?: number }[] };
type Pic = { file: File; url: string; w?: number; h?: number };

export function Composer({ me, members, onPost, autoFocus }: { me?: MentionUser; members: MentionUser[]; onPost: (p: ComposerPayload) => void; autoFocus?: boolean }) {
  const [pics, setPics] = useState<Pic[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const mention = useMentionAutocomplete({ members });
  const { text } = mention;

  const len = text.length;
  const over = len > TEXT_MAX;
  const remaining = TEXT_MAX - len;
  const showRing = len >= 220;
  const canPost = (text.trim().length > 0 || pics.length > 0) && !over;

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

  // ring geometry
  const r = 10, C = 2 * Math.PI * r, pct = Math.min(len / TEXT_MAX, 1);

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex gap-3">
        {me && <Avatar userId={me.id} name={me.name} avatar={me.avatar} size={40} className="mt-0.5 shrink-0" />}
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={mention.ref}
            value={text}
            autoFocus={autoFocus}
            onChange={mention.onChange}
            onKeyDown={mention.onKeyDown}
            rows={2}
            placeholder="What's new?"
            className="w-full resize-none border-0 bg-transparent px-0 py-1.5 text-[15px] outline-none placeholder:text-muted-foreground"
          />
          {mention.open && <MentionList matches={mention.matches} active={mention.active} onPick={mention.pick} />}

          {pics.length > 0 && (
            <div className={cn("mt-1 grid gap-1.5", pics.length === 1 ? "grid-cols-2" : "grid-cols-4")}>
              {pics.map((p, i) => (
                <div key={p.url} className="group relative aspect-square overflow-hidden rounded-xl border border-border">
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  <button onClick={() => removePic(i)} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={pics.length >= IMG_MAX}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-primary transition hover:bg-primary/10 disabled:opacity-40"
        >
          <ImageIcon className="h-4 w-4" /> Photo {pics.length > 0 && `(${pics.length}/${IMG_MAX})`}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

        <div className="flex items-center gap-2.5">
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
                    className={cn(over ? "stroke-rose-500" : remaining <= 20 ? "stroke-amber-500" : "stroke-primary")}
                    strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
                </svg>
                {remaining <= 20 && <span className={cn("absolute text-[10px] font-bold tabular-nums", over ? "text-rose-500" : "text-amber-600")}>{remaining}</span>}
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={submit}
            disabled={!canPost}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-sm transition active:scale-[0.97] disabled:scale-100 disabled:opacity-40"
          >
            <Send className="h-4 w-4" /> Post
          </button>
        </div>
      </div>
    </div>
  );
}
