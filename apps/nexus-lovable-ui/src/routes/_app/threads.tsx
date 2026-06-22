import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AtSign, ArrowUp, Loader2 } from "lucide-react";
import { AvatarStack } from "@/components/Avatar";
import { celebrate } from "@/components/Celebration";
import { cn } from "@/lib/utils";
import { nexusApi, ORG_HIERARCHY, type FeedPage, type FeedPost, type NexusUser } from "@/lib/nexus-api";
import type { MentionUser } from "@/hooks/useMentionAutocomplete";
import { Composer, type ComposerPayload } from "@/components/feed/Composer";
import { PostCard, type FeedPostUI } from "@/components/feed/PostCard";
import { ComingSoon } from "@/components/ComingSoon";

export const Route = createFileRoute("/_app/threads")({ component: ThreadsGate });

// Role gate — Threads belum dibuka untuk Manager ke bawah (belum ada ETA rilis). BoD+ akses penuh;
// selain itu lihat halaman "Coming Soon". Wrapper terpisah supaya hooks di FeedPage tetap konsisten
// (early-return di tengah komponen berisi hooks = crash "rendered fewer hooks").
function ThreadsGate() {
  const roleQ = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const roleLoaded = roleQ.isSuccess || roleQ.isError;
  const fullAccess = (ORG_HIERARCHY[roleQ.data?.role ?? ""] ?? 0) >= ORG_HIERARCHY.BOD;
  if (!roleLoaded) return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!fullAccess) return <ComingSoon feature="Threads" />;
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
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("all");
  const key = useMemo(() => ["feed", tab] as const, [tab]);

  // BETA gate — Threads is BoD-and-above only for now. Bounce everyone else (and never call the API).
  const roleQ = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const roleLoaded = roleQ.isSuccess || roleQ.isError;
  const canSeeFeed = ["ONE_ABOVE_ALL", "BOD"].includes(roleQ.data?.role ?? "");
  useEffect(() => { if (roleLoaded && !canSeeFeed) navigate({ to: "/dashboard" }); }, [roleLoaded, canSeeFeed, navigate]);

  const profile = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1, enabled: canSeeFeed });
  const me = profile.data?.user;
  const membersQ = useQuery({ queryKey: ["members"], queryFn: nexusApi.members, retry: 1, staleTime: 300_000, enabled: canSeeFeed });
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
    enabled: canSeeFeed,
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
    enabled: canSeeFeed && !!feed.data,
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
      author: { id: me.id, name: me.name ?? "Saya", avatar: me.avatar },
      images: payload.images.map((f, i) => ({ id: `t${i}`, url: URL.createObjectURL(f), width: payload.imageMeta[i]?.w ?? null, height: payload.imageMeta[i]?.h ?? null, position: i })),
      mentions: [], likedByMe: false, canDelete: true, canEdit: true,
    };
    qc.setQueryData<Inf>(key, (old) => prependPost(old, temp));
    fire(tempId, payload);
  };
  const onRetry = (post: FeedPostUI) => { const p = pendingPayloads.current.get(post._tempId ?? post.id); if (p) fire(post._tempId ?? post.id, p); };

  // ── like (optimistic + milestone celebrate) ──
  const onLike = (post: FeedPostUI) => {
    if (post._pending || post._failed) return;
    const liking = !post.likedByMe;
    qc.setQueryData<Inf>(key, (old) => updatePost(old, post.id, (p) => ({ ...p, likedByMe: liking, likeCount: Math.max(0, p.likeCount + (liking ? 1 : -1)) })));
    nexusApi.likePost(post.id)
      .then((res) => {
        qc.setQueryData<Inf>(key, (old) => updatePost(old, post.id, (p) => ({ ...p, likedByMe: res.liked, likeCount: res.likeCount })));
        if (res.liked && [1, 10, 50, 100].includes(res.likeCount)) celebrate(res.likeCount === 1 ? "First like! ❤️" : `${res.likeCount} likes 🔥`);
      })
      .catch(() => qc.setQueryData<Inf>(key, (old) => updatePost(old, post.id, (p) => ({ ...p, likedByMe: post.likedByMe, likeCount: post.likeCount }))));
  };

  const onDelete = (post: FeedPostUI) => {
    qc.setQueryData<Inf>(key, (old) => removePost(old, post.id));
    if (post._pending || post._failed) { pendingPayloads.current.delete(post._tempId ?? post.id); return; }
    nexusApi.deletePost(post.id).catch(() => qc.invalidateQueries({ queryKey: key }));
  };

  const onEdit = (id: string, text: string, mentions: string[]) => {
    nexusApi.editPost(id, { text, mentions })
      .then((real) => qc.setQueryData<Inf>(key, (old) => replacePost(old, id, real as FeedPostUI)))
      .catch(() => qc.invalidateQueries({ queryKey: key }));
  };

  const onCommentAdded = (postId: string) => qc.setQueryData<Inf>(key, (old) => updatePost(old, postId, (p) => ({ ...p, commentCount: p.commentCount + 1 })));

  if (roleLoaded && !canSeeFeed) return null; // non-BoD → redirected to /dashboard
  const loading = !roleLoaded || feed.isLoading;
  const empty = roleLoaded && canSeeFeed && !feed.isLoading && posts.length === 0;

  return (
    <div className="mx-auto min-h-screen w-full max-w-[600px] sm:border-x sm:border-border">
      {/* slim sticky header */}
      <div className="sticky top-0 z-20 flex items-center justify-center border-b border-border bg-background/80 py-3 backdrop-blur-md">
        <h1 className="font-display text-lg font-black tracking-tight">Threads</h1>
      </div>

      {/* underline tabs */}
      <div className="sticky top-[49px] z-20 flex border-b border-border bg-background/80 backdrop-blur-md">
        {([["all", "Semua"], ["mentions", "Nyebut kamu"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className="relative flex-1 py-3.5 text-sm font-bold transition hover:bg-muted/30">
            <span className={cn(tab === t ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {tab === t && <motion.span layoutId="wire-tab" className="absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-full bg-primary" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
          </button>
        ))}
      </div>

      {tab === "all" && me && <Composer me={{ id: me.id, name: me.name, avatar: me.avatar }} members={members} onPost={onPost} />}

      {/* new-posts pill */}
      <div className="pointer-events-none sticky top-[104px] z-10 flex justify-center">
        <AnimatePresence>
          {newPosts.length > 0 && (
            <motion.button
              initial={{ y: -12, opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -12, opacity: 0, scale: 0.9 }}
              onClick={flushNew}
              className="pointer-events-auto mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-3.5 py-1.5 text-sm font-bold text-primary-foreground shadow-pop"
            >
              <ArrowUp className="h-3.5 w-3.5" />
              {newPosts.length} post baru
              <AvatarStack ids={newPosts.slice(0, 3).map((p) => p.author.id)} size={20} max={3} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* list — continuous, divider-separated */}
      <div>
        {loading && Array.from({ length: 5 }).map((_, i) => <PostSkeleton key={i} />)}

        {empty && (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><AtSign className="h-7 w-7" /></div>
            <div className="text-base font-black">{tab === "mentions" ? "Belum ada yang nyebut kamu ✨" : "Sepi nih, mulai obrolannya"}</div>
            <p className="mt-1 text-sm text-muted-foreground">{tab === "mentions" ? "Nanti kalau ada yang nge-tag kamu, muncul di sini." : "Post pertama tentang apa yang lagi kamu kerjain hari ini 🚀"}</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {posts.map((post) => (
            <PostCard key={post._tempId ?? post.id} post={post} members={members} onLike={onLike} onDelete={onDelete} onEdit={onEdit} onRetry={onRetry} onCommentAdded={onCommentAdded} />
          ))}
        </AnimatePresence>

        <div ref={sentinel} className="h-8" />
        {feed.isFetchingNextPage && <div className="flex justify-center py-4 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      </div>
    </div>
  );
}

function PostSkeleton() {
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
