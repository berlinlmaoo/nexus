import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart, MessageCircle, MoreHorizontal, Trash2, Pencil, Loader2, RotateCw, Send } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { nexusApi, type FeedPost } from "@/lib/nexus-api";
import { useMentionAutocomplete, type MentionUser } from "@/hooks/useMentionAutocomplete";
import { RenderText, ImageGrid, Lightbox, MentionList, timeAgo } from "./feed-shared";

export type FeedPostUI = FeedPost & { _pending?: boolean; _failed?: boolean; _tempId?: string };

export function PostCard({ post, members, onLike, onDelete, onEdit, onRetry, onCommentAdded }: {
  post: FeedPostUI;
  members: MentionUser[];
  onLike: (post: FeedPostUI) => void;
  onDelete: (post: FeedPostUI) => void;
  onEdit: (id: string, text: string, mentions: string[]) => void;
  onRetry: (post: FeedPostUI) => void;
  onCommentAdded: (postId: string) => void;
}) {
  const reduce = useReducedMotion();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [burstKey, setBurstKey] = useState(0);

  const pending = post._pending;
  const failed = post._failed;

  const handleLike = () => {
    if (pending || failed) return;
    if (!post.likedByMe && !reduce) setBurstKey((k) => k + 1); // burst only on the un-liked → liked transition
    onLike(post);
  };

  const actionBtn = "inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm transition";

  return (
    <motion.article
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={failed && !reduce ? { opacity: 1, y: 0, x: [0, -6, 6, -4, 4, 0] } : { opacity: 1, y: 0, x: 0 }}
      transition={failed ? { x: { duration: 0.4 } } : { duration: 0.25 }}
      className={cn("relative border-b border-border px-4 py-3 transition-colors", failed ? "bg-rose-50/40" : "hover:bg-muted/20")}
    >
      {/* sending hairline */}
      {pending && (
        <motion.div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-violet-500 to-fuchsia-500"
          initial={{ scaleX: 0, transformOrigin: "left" }} animate={{ scaleX: 1 }} transition={{ duration: 1.2, ease: "easeInOut" }} />
      )}

      <div className="flex items-start gap-3">
        <Avatar userId={post.author.id} name={post.author.name} avatar={post.author.avatar} size={40} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[15px] font-bold leading-tight">{post.author.name}</span>
            <span className="text-sm text-muted-foreground">· {pending ? "Posting…" : timeAgo(post.createdAt)}</span>
            {post.editedAt && !pending && <span className="text-sm text-muted-foreground">· edited</span>}
            {!pending && !failed && (post.canDelete || post.canEdit) && (
              <div className="relative ml-auto">
                <button onClick={() => setMenu((m) => !m)} className="-mr-1.5 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-accent"><MoreHorizontal className="h-4 w-4" /></button>
                {menu && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
                    <div className="absolute right-0 z-30 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-pop">
                      {post.canEdit && <button onClick={() => { setEditing(true); setMenu(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
                      {post.canDelete && <button onClick={() => { onDelete(post); setMenu(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {editing ? (
            <EditBox post={post} members={members} onCancel={() => setEditing(false)} onSave={(t, m) => { onEdit(post.id, t, m); setEditing(false); }} />
          ) : (
            post.text && <div className="mt-0.5 whitespace-pre-wrap text-[15px] leading-normal"><RenderText text={post.text} /></div>
          )}

          {post.images.length > 0 && <ImageGrid images={post.images} onOpen={(i) => setLightbox(i)} />}

          {/* action row — like · comment · repost · share */}
          {!pending && !failed && !editing && (
            <div className="-ml-2 mt-1.5 flex items-center gap-0.5 text-muted-foreground">
              <button onClick={handleLike} className={cn(actionBtn, post.likedByMe ? "text-rose-500" : "hover:bg-rose-500/10 hover:text-rose-500")}>
                <span className="relative grid place-items-center">
                  <Heart className={cn("h-[18px] w-[18px] transition-transform", post.likedByMe && "fill-rose-500")} style={{ transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }} />
                  {burstKey > 0 && (
                    <span key={burstKey} className="pointer-events-none absolute inset-0">
                      {Array.from({ length: 6 }).map((_, i) => {
                        const a = (Math.PI * 2 * i) / 6;
                        return <motion.span key={i} className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-rose-500"
                          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }} animate={{ x: Math.cos(a) * 16, y: Math.sin(a) * 16, opacity: 0, scale: 0.4 }} transition={{ duration: 0.42, ease: "easeOut" }} />;
                      })}
                    </span>
                  )}
                </span>
                <span className="inline-block min-w-[8px] overflow-hidden text-xs tabular-nums">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={post.likeCount} initial={reduce ? false : { y: 9, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { y: -9, opacity: 0 }} transition={{ duration: 0.18 }} className="block">{post.likeCount || ""}</motion.span>
                  </AnimatePresence>
                </span>
              </button>

              <button onClick={() => setShowComments((s) => !s)} className={cn(actionBtn, "hover:bg-primary/10 hover:text-primary", showComments && "text-primary")}>
                <MessageCircle className="h-[18px] w-[18px]" />
                <span className="text-xs tabular-nums">{post.commentCount || ""}</span>
              </button>
            </div>
          )}

          {failed && (
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-rose-600">
              Couldn't send.
              <button onClick={() => onRetry(post)} className="inline-flex items-center gap-1 rounded-lg bg-rose-500 px-2.5 py-1 text-white"><RotateCw className="h-3.5 w-3.5" /> Try again</button>
              <button onClick={() => onDelete(post)} className="text-muted-foreground hover:text-foreground">Discard</button>
            </div>
          )}

          {showComments && !pending && !failed && <CommentsSection postId={post.id} members={members} onCommentAdded={() => onCommentAdded(post.id)} />}
        </div>
      </div>

      {lightbox !== null && <Lightbox images={post.images} index={lightbox} onClose={() => setLightbox(null)} />}
    </motion.article>
  );
}

function EditBox({ post, members, onCancel, onSave }: { post: FeedPost; members: MentionUser[]; onCancel: () => void; onSave: (text: string, mentions: string[]) => void }) {
  const mention = useMentionAutocomplete({ members });
  // seed the textarea with the current post text + mentions, once on mount
  useEffect(() => { mention.seed(post.text, post.mentions.filter((m) => m.name).map((m) => ({ id: m.userId, name: m.name as string }))); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="mt-1">
      <div className="relative">
        <textarea ref={mention.ref} value={mention.text} onChange={mention.onChange} onKeyDown={mention.onKeyDown} rows={2}
          className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[15px] outline-none focus:border-primary" />
        {mention.open && <MentionList matches={mention.matches} active={mention.active} onPick={mention.pick} />}
      </div>
      <div className="mt-1.5 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:bg-accent">Cancel</button>
        <button onClick={() => onSave(mention.text.trim(), mention.resolveIds(mention.text.trim()))} disabled={!mention.text.trim()} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground disabled:opacity-40">Save</button>
      </div>
    </div>
  );
}

function CommentsSection({ postId, members, onCommentAdded }: { postId: string; members: MentionUser[]; onCommentAdded: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["feed-comments", postId], queryFn: () => nexusApi.postComments(postId) });
  const add = useMutation({
    mutationFn: (p: { text: string; mentions: string[] }) => nexusApi.addPostComment(postId, p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["feed-comments", postId] }); onCommentAdded(); },
  });
  const mention = useMentionAutocomplete({ members, onSubmit: (text, mentions) => { add.mutate({ text, mentions }); mention.reset(); } });

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      {q.isLoading ? (
        <div className="text-xs text-muted-foreground">Loading comments…</div>
      ) : (
        (q.data?.comments ?? []).map((c) => (
          <div key={c.id} className="flex items-start gap-2">
            <Avatar userId={c.author.id} name={c.author.name} avatar={c.author.avatar} size={28} className="shrink-0" />
            <div className="min-w-0 flex-1 rounded-2xl bg-muted/50 px-3 py-1.5">
              <div className="text-xs font-bold">{c.author.name} <span className="font-normal text-muted-foreground">· {timeAgo(c.createdAt)}</span></div>
              <div className="text-sm"><RenderText text={c.text} /></div>
            </div>
          </div>
        ))
      )}
      <div className="relative flex items-end gap-2">
        <textarea ref={mention.ref} value={mention.text} onChange={mention.onChange} onKeyDown={mention.onKeyDown} rows={1} placeholder="Reply… (@ to mention)"
          className="min-h-9 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        {mention.open && <MentionList matches={mention.matches} active={mention.active} onPick={mention.pick} />}
        <button onClick={mention.submit} disabled={!mention.text.trim() || add.isPending} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition active:scale-95 disabled:opacity-40">
          {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
