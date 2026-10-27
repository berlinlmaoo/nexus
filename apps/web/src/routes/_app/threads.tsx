import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AtSign, ArrowUp, Loader2 } from "lucide-react";
import { AvatarStack } from "@/components/Avatar";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadError, retryTransient } from "@/components/LoadError";
import { celebrate } from "@/components/Celebration";
import { ApiError, nexusApi, type FeedPage, type FeedPost, type NexusUser } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import type { MentionUser } from "@/hooks/useMentionAutocomplete";
import { Composer, type ComposerPayload } from "@/components/feed/Composer";
import { PostCard, type FeedPostUI } from "@/components/feed/PostCard";
import { DetailBar, PostDetail } from "@/components/feed/PostDetail";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/threads")({
  component: ThreadsGate,
  // `?post=<id>` is what every Threads notification links to (new post, like, mention, comment). Until
  // 9 Oct 2026 the page ignored it and a tap landed on the top of the feed.
  // `?tab=mentions` keeps the Mentions tab across a reload / Back (QA 13 Oct 2026).
  validateSearch: (s: Record<string, unknown>): { post?: string; tab?: "mentions" } => ({
    post: typeof s.post === "string" && s.post ? s.post : undefined,
    tab: s.tab === "mentions" ? "mentions" : undefined,
  }),
});

// Threads is open to everyone. It spent its beta behind a BoD gate that lived in three places at
// once — this wrapper, a redirect inside FeedPage, and the API — so the menu entry was visible to
// every member and led to "Coming Soon". The wrapper stays as the route's component because the
// file route points at it; it no longer decides anything.
function ThreadsGate() {
  return <FeedPage />;
}

type Inf = { pages: FeedPage[]; pageParams: unknown[] };
type Tab = "all" | "mentions";

const updatePost = (old: Inf | undefined, id: string, fn: (p: FeedPostUI) => FeedPostUI): Inf | undefined =>
  old ? { ...old, pages: old.pages.map((pg) => ({ ...pg, posts: (pg.posts as FeedPostUI[]).map((p) => (p.id === id ? fn(p) : p)) })) } : old;
const replacePost = (old: Inf | undefined, id: string, np: FeedPostUI): Inf | undefined =>
  old ? { ...old, pages: old.pages.map((pg) => ({ ...pg, posts: (pg.posts as FeedPostUI[]).map((p) => (p.id === id ? np : p)) })) } : old;
const removePost = (old: Inf | undefined, id: string): Inf | undefined =>
  old ? { ...old, pages: old.pages.map((pg) => ({ ...pg, posts: (pg.posts as FeedPostUI[]).filter((p) => p.id !== id) })) } : old;
const prependPost = (old: Inf | undefined, np: FeedPostUI): Inf | undefined =>
  old && old.pages.length ? { ...old, pages: old.pages.map((pg, i) => (i === 0 ? { ...pg, posts: [np, ...(pg.posts as FeedPostUI[])] } : pg)) } : { pages: [{ posts: [np], nextCursor: null, hasMore: false }], pageParams: [undefined] };

function FeedPage() {
  const { t, tn } = useLang();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { post: focusId, tab: tabParam } = Route.useSearch();
  const tab: Tab = tabParam ?? "all";
  const setTab = (next: Tab) => { void navigate({ to: "/threads", search: { post: focusId, tab: next === "mentions" ? "mentions" : undefined }, replace: true }); };
  const key = useMemo(() => ["feed", tab] as const, [tab]);
  // Height of the (sticky) page header, so the new-posts pill sticks right under it.
  const headRef = useRef<HTMLDivElement>(null);
  const [headH, setHeadH] = useState(0);
  useLayoutEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeadH(el.offsetHeight));
    ro.observe(el);
    setHeadH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  // The post a notification opened, fetched on its own: it may be far down the feed or not loaded.
  const focus = useQuery({
    queryKey: ["feed-post", focusId],
    queryFn: () => nexusApi.feedPost(focusId as string) as Promise<FeedPostUI>,
    enabled: !!focusId,
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 410)) && n < 2,
  });
  // Opening a post remembers where the feed was; Back puts the reader there again (Threads does).
  const feedScroll = useRef<number | null>(null);
  const [replyFocus, setReplyFocus] = useState(false);
  useEffect(() => {
    if (focusId) { window.scrollTo({ top: 0 }); return; }
    if (feedScroll.current !== null) {
      const y = feedScroll.current;
      feedScroll.current = null;
      requestAnimationFrame(() => window.scrollTo({ top: y }));
    }
  }, [focusId]);
  const openPost = (post: FeedPostUI, reply = false) => {
    feedScroll.current = window.scrollY;
    qc.setQueryData<FeedPostUI>(["feed-post", post.id], (old) => old ?? post);
    setReplyFocus(reply);
    void navigate({ to: "/threads", search: { post: post.id, tab: tabParam } });
  };
  const closeFocus = () => {
    // Opened from the feed: step back in history, so the browser's Back and this arrow agree.
    if (feedScroll.current !== null) { window.history.back(); return; }
    // Opened from a notification or a link: land on the top of the feed.
    void navigate({ to: "/threads", search: tabParam ? { tab: tabParam } : {} });
  };

  // One post lives in several caches at once — both tabs and the focused copy. A like or an edit
  // written into only the visible tab left the other copy stale, and whichever was shown next said
  // the opposite.
  const patchPost = (id: string, fn: (p: FeedPostUI) => FeedPostUI) => {
    qc.setQueriesData<Inf>({ queryKey: ["feed"] }, (old) => updatePost(old, id, fn));
    qc.setQueryData<FeedPostUI>(["feed-post", id], (old) => (old ? fn(old) : old));
  };

  const profile = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const me = profile.data?.user;
  const membersQ = useQuery({ queryKey: ["members"], queryFn: nexusApi.members, retry: 1, staleTime: 300_000 });
  const members: MentionUser[] = useMemo(() => {
    const raw = membersQ.data;
    const arr: NexusUser[] = Array.isArray(raw) ? raw : raw?.members ?? [];
    return arr.map((u) => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar }));
  }, [membersQ.data]);

  const feed = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => nexusApi.feedPosts({ cursor: pageParam as string | undefined, mentions: tab === "mentions" ? "me" : undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: retryTransient,
  });

  const posts: FeedPostUI[] = useMemo(() => (feed.data?.pages ?? []).flatMap((pg) => pg.posts as FeedPostUI[]), [feed.data]);

  // ── infinite scroll sentinel ──
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [feed.hasNextPage, feed.isFetchingNextPage, feed]);

  // ── "↑ N new posts" pill (poll the head; don't yank the reader) ──
  const topRealId = useMemo(() => posts.find((p) => !p._pending && !p._failed)?.id ?? null, [posts]);
  const head = useQuery({
    queryKey: ["feed-head", tab],
    queryFn: () => nexusApi.feedPosts({ limit: 20, mentions: tab === "mentions" ? "me" : undefined }),
    refetchInterval: 30_000,
    enabled: !!feed.data,
  });
  const newPosts = useMemo(() => {
    if (!head.data || !topRealId) return [] as FeedPost[];
    const idx = head.data.posts.findIndex((p) => p.id === topRealId);
    return idx === -1 ? head.data.posts.slice(0, 5) : head.data.posts.slice(0, idx);
  }, [head.data, topRealId]);
  const flushNew = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    qc.invalidateQueries({ queryKey: key });
    head.refetch();
  };

  // ── create (optimistic "settling") ──
  const pendingPayloads = useRef<Map<string, ComposerPayload>>(new Map());
  const fire = (tempId: string, payload: ComposerPayload) => {
    qc.setQueryData<Inf>(key, (old) => updatePost(old, tempId, (p) => ({ ...p, _pending: true, _failed: false })));
    nexusApi.createPost(payload)
      .then((real) => { qc.setQueryData<Inf>(key, (old) => replacePost(old, tempId, real as FeedPostUI)); pendingPayloads.current.delete(tempId); })
      .catch(() => qc.setQueryData<Inf>(key, (old) => updatePost(old, tempId, (p) => ({ ...p, _pending: false, _failed: true }))));
  };
  const onPost = (payload: ComposerPayload) => {
    if (!me) return;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingPayloads.current.set(tempId, payload);
    const temp: FeedPostUI = {
      id: tempId, _tempId: tempId, _pending: true,
      text: payload.text, createdAt: new Date().toISOString(), editedAt: null,
      likeCount: 0, commentCount: 0,
      author: { id: me.id, name: me.name ?? t("Me"), avatar: me.avatar },
      images: payload.images.map((f, i) => ({ id: `t${i}`, url: URL.createObjectURL(f), width: payload.imageMeta[i]?.w ?? null, height: payload.imageMeta[i]?.h ?? null, position: i })),
      mentions: [], likedByMe: false, canDelete: true, canEdit: true,
    };
    qc.setQueryData<Inf>(key, (old) => prependPost(old, temp));
    fire(tempId, payload);
  };
  const onRetry = (post: FeedPostUI) => { const p = pendingPayloads.current.get(post._tempId ?? post.id); if (p) fire(post._tempId ?? post.id, p); };

  // ── like (optimistic + milestone celebrate) ──
  // The route is a toggle, so two taps in flight at once could land in either order and leave the
  // heart saying the opposite of the database. One request per post at a time; a tap during it is
  // dropped (it would only have undone the first).
  const liking = useRef<Set<string>>(new Set());
  const onLike = (post: FeedPostUI) => {
    if (post._pending || post._failed || liking.current.has(post.id)) return;
    liking.current.add(post.id);
    const like = !post.likedByMe;
    // A feed refetch already on its way (coming back to the page, the window regaining focus) was
    // read before this like and would paint the old heart over the new one.
    void qc.cancelQueries({ queryKey: ["feed"] });
    patchPost(post.id, (p) => ({ ...p, likedByMe: like, likeCount: Math.max(0, p.likeCount + (like ? 1 : -1)) }));
    nexusApi.likePost(post.id)
      .then((res) => {
        patchPost(post.id, (p) => ({ ...p, likedByMe: res.liked, likeCount: res.likeCount }));
        if (res.liked && [1, 10, 50, 100].includes(res.likeCount)) celebrate(res.likeCount === 1 ? t("First like") : t("{n} likes", { n: res.likeCount }));
      })
      .catch(() => patchPost(post.id, (p) => ({ ...p, likedByMe: post.likedByMe, likeCount: post.likeCount })))
      .finally(() => { liking.current.delete(post.id); });
  };

  const onDelete = (post: FeedPostUI) => {
    qc.setQueriesData<Inf>({ queryKey: ["feed"] }, (old) => removePost(old, post.id));
    if (focusId === post.id) closeFocus();
    if (post._pending || post._failed) { pendingPayloads.current.delete(post._tempId ?? post.id); return; }
    nexusApi.deletePost(post.id).catch(() => qc.invalidateQueries({ queryKey: key }));
  };

  const onEdit = (id: string, text: string, mentions: string[]) => {
    nexusApi.editPost(id, { text, mentions })
      .then((real) => patchPost(id, () => real as FeedPostUI))
      .catch(() => qc.invalidateQueries({ queryKey: key }));
  };

  const onCommentAdded = (postId: string) => patchPost(postId, (p) => ({ ...p, commentCount: p.commentCount + 1 }));

  const loading = feed.isLoading;
  const failed = feed.isError && !feed.data;
  const empty = !feed.isLoading && !failed && posts.length === 0;

  const tabs: { key: Tab; label: string }[] = [{ key: "all", label: t("All") }, { key: "mentions", label: t("Mentions") }];
  const meUser = me ? { id: me.id, name: me.name, avatar: me.avatar } : undefined;

  return (
    <div>
      {/* The app's standard header (title + one line on what this is), like every page. An open post shows only
          its "← Thread" bar, as on Threads (owner, 27 Oct 2026): with the page header over it the page said
          "Threads" and "Thread" (ID: "Utas" twice). Hidden, the header measures 0 and the bar sticks to the top. */}
      <div ref={headRef} className={cn("sticky top-0 z-30 md:z-40", focusId && "hidden")}>
        <PageHeader title={t("Threads")} subtitle={t("Short updates from the team. Tag someone with @ and they get notified.")} />
      </div>

      {/* Threads layout (owner, 24 + 26 Oct 2026: "copy the look of Threads"; measured spec in
          nexus-qa/visual-qa-24oct/dec25/oct26/threads-meta-spec.md): one 640px column (672 minus the 16px side gutters). The column is a card
          whose top corners are rounded and which runs on to the bottom of the screen — it never ends as a
          floating box (wide screens); on a phone it is edge to edge and fills the screen the same way. An open
          post's bar ("← Thread") sits above the card, like the original. */}
      <div className="mx-auto flex w-full max-w-[672px] flex-col md:px-4" style={{ "--threads-head": `${headH}px`, minHeight: `calc(100dvh - ${headH}px)` } as CSSProperties}>
        {focusId ? (
          <div className="sticky z-20 border-b border-border bg-card pt-[env(safe-area-inset-top)] md:border-b-0 md:bg-background md:pt-4" style={{ top: headH }}>
            <DetailBar onBack={closeFocus} replies={focus.data?.commentCount} />
          </div>
        ) : (
          <div aria-hidden className="hidden h-6 md:block" />
        )}
        <div className="flex-1 overflow-clip bg-card pb-28 md:rounded-t-[28px] md:border md:border-b-0 md:border-border md:pb-12">
          {focusId ? (
            <>
              {focus.isLoading && <PostSkeleton />}
              {focus.isError && (
                <div className="px-6 py-10 text-center text-[15px] text-muted-foreground">
                  {focus.error instanceof ApiError && (focus.error.status === 404 || focus.error.status === 410) ? t("This post was deleted.") : t("Couldn't open this post.")}
                </div>
              )}
              {focus.data && (
                <PostDetail key={focus.data.id} post={focus.data} me={meUser} members={members} onLike={onLike} onDelete={onDelete} onEdit={onEdit} onCommentAdded={onCommentAdded} focusReply={replyFocus} />
              )}
            </>
          ) : (
            <>
              <div role="tablist" aria-label={t("Threads")} className="sticky z-20 grid grid-cols-2 bg-card" style={{ top: headH }}>
                {tabs.map((x) => {
                  const on = tab === x.key;
                  return (
                    <button key={x.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(x.key)}
                      className={cn("relative h-12 text-[15px] font-semibold transition-colors", on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                      {x.label}
                      <span aria-hidden className={cn("absolute inset-x-0 bottom-0", on ? "h-px bg-foreground" : "h-px bg-border")} />
                    </button>
                  );
                })}
              </div>

              {tab === "all" && me && <Composer me={meUser} members={members} onPost={onPost} />}

              {/* new-posts pill */}
              <div className="pointer-events-none sticky top-[calc(var(--threads-head,0px)+3.5rem)] z-10 flex h-0 justify-center">
                <AnimatePresence>
                  {newPosts.length > 0 && (
                    <motion.button
                      initial={{ y: -12, opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -12, opacity: 0, scale: 0.9 }}
                      onClick={flushNew}
                      className="pointer-events-auto mt-2 inline-flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-pop"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                      {tn(newPosts.length, "{n} new post", "{n} new posts")}
                      <AvatarStack ids={newPosts.slice(0, 3).map((p) => p.author.id)} size={20} max={3} />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>

              {/* list — a hairline under every post (the card runs on below the last one). */}
              <div>
                {loading && Array.from({ length: 5 }).map((_, i) => <PostSkeleton key={i} />)}

                {failed && <LoadError compact error={feed.error} what={t("the posts")} onRetry={() => void feed.refetch()} />}
                {empty && (
                  <EmptyState icon={AtSign} tone="muted" title={tab === "mentions" ? t("No mentions yet") : t("No posts yet")}
                    message={tab === "mentions" ? t("When someone tags you, it shows up here.") : t("Share what you're working on today.")} />
                )}

                <AnimatePresence initial={false}>
                  {posts.map((post) => (
                    <PostCard key={post._tempId ?? post.id} post={post} members={members} onLike={onLike} onDelete={onDelete} onEdit={onEdit} onRetry={onRetry} onOpen={openPost} />
                  ))}
                </AnimatePresence>

                <div ref={sentinel} aria-hidden className="h-px" />
                {feed.isFetchingNextPage && <div className="flex justify-center py-4 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PostSkeleton() {
  return (
    <div className="border-b border-border px-3 py-3 md:px-6">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
