import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { EscClose } from "@/hooks/use-escape";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Heart, MessageCircle, MoreHorizontal, Trash2, Pencil, RotateCw, Send, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { FeedPost } from "@/lib/nexus-api";
import { useMentionAutocomplete, type MentionUser } from "@/hooks/useMentionAutocomplete";
import { RenderText, ImageGrid, Lightbox, MentionList, timeAgo } from "./feed-shared";
import { useLang } from "@/lib/lang";

export type FeedPostUI = FeedPost & { _pending?: boolean; _failed?: boolean; _tempId?: string };

/*
 * Threads-style post anatomy (24 Oct 2026, owner: "copy the look of Threads"; measured spec in
 * nexus-qa/threads-ref/SPEC.md): a 36px avatar column + 12px gap, a name/time row of 15/21, the body in
 * the text column, media under it, then an icon row of 36px pills (20px icons, 13px counts) pulled 12px
 * left so the first icon lines up with the text. Posts are separated by a hairline; the whole row opens
 * the post, like the original.
 */

export const postX = "px-3 md:px-6";

/** Copy the link a notification would open. */
export function copyPostLink(id: string, okText: string) {
  const url = `${window.location.origin}/threads?post=${encodeURIComponent(id)}`;
  void navigator.clipboard?.writeText(url).then(() => toast.success(okText)).catch(() => toast.error(url));
}

/** Clicks on these never open the post (they do their own thing). */
const interactive = (el: EventTarget | null) =>
  el instanceof Element && !!el.closest("button, a, textarea, input, [role='menu'], [role='dialog'], [data-no-open]");

/** Name · time · edited, and the ⋯ menu. Names wrap to two lines, then end in an ellipsis. */
export function PostHeader({ post, onOpen, menu }: { post: FeedPostUI; onOpen?: () => void; menu?: ReactNode }) {
  const { t } = useLang();
  const pending = post._pending;
  return (
    <div className="flex min-h-[21px] items-start gap-2">
      <div className="flex min-w-0 flex-1 items-baseline gap-x-2">
        <span className="line-clamp-2 min-w-0 break-words text-[15px] font-semibold leading-[21px] text-foreground">{post.author.name}</span>
        {onOpen && !pending ? (
          <button type="button" onClick={onOpen} className="shrink-0 whitespace-nowrap text-[15px] leading-[21px] text-muted-foreground hover:underline" title={new Date(post.createdAt).toLocaleString()}>
            {timeAgo(post.createdAt)}
          </button>
        ) : (
          <span className="shrink-0 whitespace-nowrap text-[15px] leading-[21px] text-muted-foreground">{pending ? t("Posting…") : timeAgo(post.createdAt)}</span>
        )}
        {post.editedAt && !pending && <span className="shrink-0 whitespace-nowrap text-[15px] leading-[21px] text-muted-foreground">· {t("edited")}</span>}
      </div>
      {menu}
    </div>
  );
}

/** ⋯ → Copy link / Edit / Delete (Delete asks first; Control Room → Audit can restore it). */
export function PostMenu({ post, onEdit, onDelete }: { post: FeedPostUI; onEdit: () => void; onDelete: () => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (post._pending || post._failed) return null;
  const item = "flex h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-[15px] font-semibold transition-colors hover:bg-muted active:bg-muted";
  return (
    // Stops clicks here (and in the portalled dialog, which React bubbles through this tree) from opening the post.
    // The box is one text line tall; the 36px (44px on touch) button hangs over it, so the row keeps its 21px.
    <div className="relative h-[21px] w-6 shrink-0" data-no-open onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((m) => !m)} aria-label={t("More options")} aria-expanded={open}
        className="absolute -right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 pointer-coarse:size-11 pointer-coarse:-right-2.5 place-items-center rounded-full text-muted-foreground transition hover:bg-muted active:scale-90">
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <EscClose onClose={() => setOpen(false)} />
          <div role="menu" className="absolute -right-1.5 top-full z-30 mt-2 w-56 rounded-2xl border border-border bg-popover p-1.5 shadow-pop">
            <button role="menuitem" type="button" className={item} onClick={() => { copyPostLink(post.id, t("Link copied")); setOpen(false); }}>
              {t("Copy link")} <Link2 className="h-[18px] w-[18px] shrink-0" />
            </button>
            {post.canEdit && (
              <button role="menuitem" type="button" className={item} onClick={() => { onEdit(); setOpen(false); }}>
                {t("Edit")} <Pencil className="h-[18px] w-[18px] shrink-0" />
              </button>
            )}
            {post.canDelete && (
              <>
                <div className="mx-3 my-1 h-px bg-border" />
                <button role="menuitem" type="button" className={cn(item, "text-rose-600 dark:text-rose-400")} onClick={() => { setOpen(false); setConfirm(true); }}>
                  {t("Delete")} <Trash2 className="h-[18px] w-[18px] shrink-0" />
                </button>
              </>
            )}
          </div>
        </>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this post?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("It disappears from Threads for everyone. You can restore it from Control Room → Audit.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onDelete}>{t("Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const pill = "inline-flex h-9 pointer-coarse:h-11 items-center gap-1 rounded-full px-3 text-[13px] leading-[18px] tabular-nums transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.92]";

/** Like · Reply · Share — the Threads icon row. */
export function ActionRow({ post, onLike, onReply }: { post: FeedPostUI; onLike: () => void; onReply: () => void }) {
  const { t } = useLang();
  const reduce = useReducedMotion();
  const [burstKey, setBurstKey] = useState(0);
  const like = () => {
    if (!post.likedByMe && !reduce) setBurstKey((k) => k + 1); // burst only on the un-liked → liked transition
    onLike();
  };
  return (
    <div className="-ml-3 mt-1 flex items-center text-foreground/75" data-no-open>
      <button type="button" onClick={like} aria-label={post.likedByMe ? t("Unlike") : t("Like")} aria-pressed={post.likedByMe} className={cn(pill, post.likedByMe && "text-rose-500")}>
        <span className="relative grid place-items-center">
          <Heart className={cn("h-5 w-5 transition-transform", post.likedByMe && "fill-rose-500")} strokeWidth={1.75} style={{ transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }} />
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
        {post.likeCount > 0 && (
          <span className="inline-block overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={post.likeCount} initial={reduce ? false : { y: 9, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { y: -9, opacity: 0 }} transition={{ duration: 0.18 }} className="block">{post.likeCount}</motion.span>
            </AnimatePresence>
          </span>
        )}
      </button>
      <button type="button" onClick={onReply} aria-label={t("Reply")} className={pill}>
        <MessageCircle className="h-5 w-5" strokeWidth={1.75} />
        {post.commentCount > 0 && <span>{post.commentCount}</span>}
      </button>
      <button type="button" onClick={() => copyPostLink(post.id, t("Link copied"))} aria-label={t("Copy link")} title={t("Copy link")} className={pill}>
        <Send className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </button>
    </div>
  );
}

/** One post in the feed. Tapping it (or its time, or Reply) opens the post with its replies. */
export function PostCard({ post, members, onLike, onDelete, onEdit, onRetry, onOpen }: {
  post: FeedPostUI;
  members: MentionUser[];
  onLike: (post: FeedPostUI) => void;
  onDelete: (post: FeedPostUI) => void;
  onEdit: (id: string, text: string, mentions: string[]) => void;
  onRetry: (post: FeedPostUI) => void;
  /** Open the post page; `reply` puts the cursor in the reply box. */
  onOpen: (post: FeedPostUI, reply?: boolean) => void;
}) {
  const { t } = useLang();
  const reduce = useReducedMotion();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const pending = post._pending;
  const failed = post._failed;
  const openable = !pending && !failed && !editing;

  const onRowClick = (e: MouseEvent) => {
    if (!openable || interactive(e.target)) return;
    if (window.getSelection()?.toString()) return; // selecting text is not a tap
    onOpen(post);
  };

  return (
    <motion.article
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={failed && !reduce ? { opacity: 1, y: 0, x: [0, -6, 6, -4, 4, 0] } : { opacity: 1, y: 0, x: 0 }}
      transition={failed ? { x: { duration: 0.4 } } : { duration: 0.25 }}
      onClick={onRowClick}
      className={cn("relative border-b border-border pb-1 pt-3", postX, openable && "cursor-pointer", failed && "bg-rose-50/40 dark:bg-rose-500/10")}
    >
      {/* sending hairline */}
      {pending && (
        <motion.div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-violet-500 to-fuchsia-500"
          initial={{ scaleX: 0, transformOrigin: "left" }} animate={{ scaleX: 1 }} transition={{ duration: 1.2, ease: "easeInOut" }} />
      )}

      <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-3">
        <div className="pt-px"><Avatar userId={post.author.id} name={post.author.name} avatar={post.author.avatar} size={36} /></div>
        <div className="min-w-0">
          <PostHeader post={post} onOpen={openable ? () => onOpen(post) : undefined}
            menu={!editing && <PostMenu post={post} onEdit={() => setEditing(true)} onDelete={() => onDelete(post)} />} />

          {editing ? (
            <EditBox post={post} members={members} onCancel={() => setEditing(false)} onSave={(text, m) => { onEdit(post.id, text, m); setEditing(false); }} />
          ) : (
            post.text && <div className="mt-0.5 text-[15px] leading-[21px] text-foreground"><RenderText text={post.text} names={post.mentions.map((m) => m.name)} /></div>
          )}

          {post.images.length > 0 && <ImageGrid images={post.images} onOpen={(i) => setLightbox(i)} bleed />}

          {openable && <ActionRow post={post} onLike={() => onLike(post)} onReply={() => onOpen(post, true)} />}
          {(pending || editing) && <div className="h-2" />}

          {failed && (
            <div className="mb-2 mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-rose-600 dark:text-rose-400">
              {t("Couldn't send.")}
              <button onClick={() => onRetry(post)} className="inline-flex items-center gap-1 rounded-lg bg-rose-500 px-2.5 py-1 text-white"><RotateCw className="h-3.5 w-3.5" /> {t("Try again")}</button>
              <button onClick={() => onDelete(post)} className="text-muted-foreground hover:text-foreground">{t("Discard")}</button>
            </div>
          )}
        </div>
      </div>

      {lightbox !== null && <div data-no-open onClick={(e) => e.stopPropagation()}><Lightbox images={post.images} index={lightbox} onClose={() => setLightbox(null)} /></div>}
    </motion.article>
  );
}

export function EditBox({ post, members, onCancel, onSave }: { post: FeedPost; members: MentionUser[]; onCancel: () => void; onSave: (text: string, mentions: string[]) => void }) {
  const { t } = useLang();
  const mention = useMentionAutocomplete({ members });
  // seed the textarea with the current post text + mentions, once on mount
  useEffect(() => { mention.seed(post.text, post.mentions.filter((m) => m.name).map((m) => ({ id: m.userId, name: m.name as string }))); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="mt-1.5" data-no-open>
      <div className="relative">
        <textarea ref={mention.ref} value={mention.text} onChange={mention.onChange} onKeyDown={mention.onKeyDown} rows={3}
          className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[15px] leading-[21px] outline-none focus:border-ring" />
        {mention.open && <MentionList matches={mention.matches} active={mention.active} onPick={mention.pick} />}
      </div>
      <div className="mb-2 mt-1.5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-9 rounded-[10px] px-3.5 text-[15px] font-semibold text-muted-foreground hover:bg-muted">{t("Cancel")}</button>
        <button type="button" onClick={() => onSave(mention.text.trim(), mention.resolveIds(mention.text.trim()))} disabled={!mention.text.trim()} className="h-9 rounded-[10px] bg-primary px-4 text-[15px] font-semibold text-primary-foreground disabled:opacity-40">{t("Save")}</button>
      </div>
    </div>
  );
}
