import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { nexusApi, type FeedComment } from "@/lib/nexus-api";
import { useMentionAutocomplete, type MentionUser } from "@/hooks/useMentionAutocomplete";
import { RenderText, ImageGrid, Lightbox, MentionList, timeAgo } from "./feed-shared";
import { ActionRow, EditBox, PostHeader, PostMenu, postX, type FeedPostUI } from "./PostCard";
import { PostButton, useAutoGrow } from "./Composer";
import { useLang } from "@/lib/lang";

/**
 * The bar over an open post: back arrow, "Thread", and how many replies. It sits above the column card on
 * wide screens (as on Threads, 26 Oct 2026) and is the top bar of the screen on a phone.
 */
export function DetailBar({ onBack, replies }: { onBack: () => void; replies?: number }) {
  const { t, tn } = useLang();
  return (
    <div className="flex h-14 items-center gap-2 px-1.5 md:-ml-2 md:h-16 md:px-0">
      <button type="button" onClick={onBack} aria-label={t("Back")} className="grid h-10 w-10 shrink-0 place-items-center rounded-full transition hover:bg-muted active:scale-90">
        <ArrowLeft className="h-[22px] w-[22px]" />
      </button>
      <div className="min-w-0 leading-tight">
        <div className="text-[17px] font-bold md:text-[20px]">{t("Thread")}</div>
        {replies !== undefined && <div className="mt-0.5 text-[13px] text-muted-foreground">{tn(replies, "{n} reply", "{n} replies")}</div>}
      </div>
    </div>
  );
}

/**
 * An open post (Threads' post page): the post at full width under its author row, the reply box
 * ("Reply to …"), then the replies, oldest first. Back returns to the feed where it was.
 */
export function PostDetail({ post, me, members, onLike, onDelete, onEdit, onCommentAdded, focusReply }: {
  post: FeedPostUI;
  me?: MentionUser;
  members: MentionUser[];
  onLike: (post: FeedPostUI) => void;
  onDelete: (post: FeedPostUI) => void;
  onEdit: (id: string, text: string, mentions: string[]) => void;
  onCommentAdded: (postId: string) => void;
  focusReply?: boolean;
}) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);

  // Replies refresh while the post is open (there is no socket for Threads), so a reply from someone
  // else shows up without a reload.
  const q = useQuery({ queryKey: ["feed-comments", post.id], queryFn: () => nexusApi.postComments(post.id), refetchInterval: 20_000 });
  const add = useMutation({
    mutationFn: (p: { text: string; mentions: string[] }) => nexusApi.addPostComment(post.id, p),
    onSuccess: (c) => {
      qc.setQueryData<{ comments: FeedComment[] }>(["feed-comments", post.id], (old) => (old ? { comments: [...old.comments.filter((x) => x.id !== c.id), c] } : old));
      void qc.invalidateQueries({ queryKey: ["feed-comments", post.id] });
      onCommentAdded(post.id);
    },
  });
  const mention = useMentionAutocomplete({ members, onSubmit: (text, mentions) => { if (!text.trim() || add.isPending) return; add.mutate({ text, mentions }); mention.reset(); } });
  useAutoGrow(mention.ref, mention.text, 240);
  useEffect(() => { if (focusReply) mention.ref.current?.focus(); }, [focusReply, mention.ref]);
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => mention.onKeyDown(e);

  const comments = q.data?.comments ?? [];
  // Replies carry no mention list; any member's name after @ is highlighted whole.
  const memberNames = useMemo(() => members.map((m) => m.name).filter((n): n is string => !!n), [members]);

  return (
    <div>
      {/* the post */}
      <article className={cn("pb-1 pt-3", postX)}>
        <div className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-x-3">
          <Avatar userId={post.author.id} name={post.author.name} avatar={post.author.avatar} size={36} />
          <PostHeader post={post} menu={!editing && <PostMenu post={post} onEdit={() => setEditing(true)} onDelete={() => onDelete(post)} />} />
        </div>
        {editing ? (
          <EditBox post={post} members={members} onCancel={() => setEditing(false)} onSave={(text, m) => { onEdit(post.id, text, m); setEditing(false); }} />
        ) : (
          post.text && <div className="mt-3 text-[15px] leading-[21px] text-foreground"><RenderText text={post.text} names={post.mentions.map((m) => m.name)} /></div>
        )}
        {post.images.length > 0 && <ImageGrid images={post.images} onOpen={(i) => setLightbox(i)} bleed />}
        {!editing && <ActionRow post={post} onLike={() => onLike(post)} onReply={() => mention.ref.current?.focus()} />}
      </article>

      {/* reply box */}
      <div className={cn("border-y border-border py-3", postX)}>
        <div className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-x-3">
          {me ? <Avatar userId={me.id} name={me.name} avatar={me.avatar} size={36} /> : <div />}
          <div className="relative min-w-0">
            <textarea ref={mention.ref} value={mention.text} onChange={mention.onChange} onKeyDown={onKeyDown} rows={1}
              aria-label={t("Reply to {name}…", { name: post.author.name })}
              placeholder={t("Reply to {name}…", { name: post.author.name })}
              className="block min-h-9 w-full resize-none border-0 bg-transparent px-0 py-[7px] text-[15px] leading-[21px] outline-none placeholder:text-muted-foreground" />
            {mention.open && <MentionList matches={mention.matches} active={mention.active} onPick={mention.pick} />}
          </div>
          <PostButton ready={!!mention.text.trim()} busy={add.isPending} onClick={mention.submit} label={t("Post")} />
        </div>
        {add.isError && <div className="ml-12 mt-1 text-[13px] font-semibold text-rose-600 dark:text-rose-400">{t("Couldn't send.")}</div>}
      </div>

      {/* replies */}
      {q.isLoading ? (
        <div className="space-y-0">{[0, 1].map((i) => <ReplySkeleton key={i} />)}</div>
      ) : q.isError ? (
        <div className={cn("py-6 text-[15px] text-muted-foreground", postX)}>
          {t("Couldn't load the replies.")} <button type="button" onClick={() => void q.refetch()} className="font-semibold text-foreground underline-offset-2 hover:underline">{t("Try again")}</button>
        </div>
      ) : comments.length === 0 ? (
        <div className={cn("flex flex-col items-center gap-1.5 py-10 text-center", postX)}>
          <MessageCircle className="h-6 w-6 text-muted-foreground" strokeWidth={1.75} />
          <div className="text-[15px] font-semibold">{t("No replies yet")}</div>
          <div className="text-[13px] text-muted-foreground">{t("Be the first to reply. Tag someone with @ to bring them in.")}</div>
        </div>
      ) : (
        <div>
          {comments.map((c, i) => (
            <Reply key={c.id} c={c} names={memberNames} chained={comments[i + 1]?.author.id === c.author.id} byAuthor={c.author.id === post.author.id} />
          ))}
        </div>
      )}

      {lightbox !== null && <Lightbox images={post.images} index={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

/**
 * One reply. A run of replies by the same person is joined by the thread line under the avatar (and no
 * hairline between them), the way Threads draws an author's chain.
 */
function Reply({ c, chained, names, byAuthor }: { c: FeedComment; chained: boolean; names: string[]; byAuthor: boolean }) {
  const { t } = useLang();
  return (
    <div className={cn("pt-3", chained ? "pb-0" : "border-b border-border pb-3", postX)}>
      <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-3">
        <div className="flex flex-col items-center pt-px">
          <Avatar userId={c.author.id} name={c.author.name} avatar={c.author.avatar} size={36} />
          {chained && <div aria-hidden className="-mb-1 mt-1.5 w-0.5 flex-1 rounded-full bg-border" style={{ minHeight: 12 }} />}
        </div>
        <div className={cn("min-w-0", chained && "pb-4")}>
          <div className="flex min-w-0 items-baseline gap-x-2">
            <span className="line-clamp-2 min-w-0 break-words text-[15px] font-semibold leading-[21px]">{c.author.name}</span>
            <span className="shrink-0 whitespace-nowrap text-[15px] leading-[21px] text-muted-foreground" title={new Date(c.createdAt).toLocaleString()}>{timeAgo(c.createdAt)}</span>
            {byAuthor && <span className="shrink-0 whitespace-nowrap text-[15px] leading-[21px] text-muted-foreground">· {t("Author")}</span>}
          </div>
          <div className="mt-0.5 text-[15px] leading-[21px]"><RenderText text={c.text} names={names} /></div>
        </div>
      </div>
    </div>
  );
}

function ReplySkeleton() {
  return (
    <div className={cn("border-b border-border py-3", postX)}>
      <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-3">
        <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
        <div className="space-y-2 pt-1">
          <div className="h-3 w-28 animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
