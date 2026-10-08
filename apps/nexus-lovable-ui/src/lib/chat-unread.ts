import { useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError, nexusApi, type NexusConversation } from "@/lib/nexus-api";

/**
 * Chat unread counts for the nav badges (sidebar, phone More sheet) and the browser tab title.
 *
 * The key sits under ["conversations"] on purpose: everything that already invalidates the list
 * (sending, reading, a socket `conversation-updated`) refreshes the badge too.
 */
export const CHAT_UNREAD_KEY = ["conversations", "unread"] as const;

/** Muted = mutedUntil still in the future. "forever" is accepted in case a server echoes it raw. */
export function isMuted(c: Pick<NexusConversation, "mutedUntil">, now = Date.now()): boolean {
  const until = c.mutedUntil;
  if (!until) return false;
  if (until === "forever") return true;
  const at = new Date(until).getTime();
  return Number.isFinite(at) && at > now;
}

/** A mute that runs for decades is the "Always" choice (the server stores it as a far-future date). */
export function isMutedForever(c: Pick<NexusConversation, "mutedUntil">): boolean {
  if (c.mutedUntil === "forever") return true;
  const at = c.mutedUntil ? new Date(c.mutedUntil).getTime() : NaN;
  return Number.isFinite(at) && at - Date.now() > 10 * 365 * 24 * 3600 * 1000;
}

/**
 * The badge number from a conversation-list response: the server's `totalUnread` when it sends
 * one (since 8 Oct 2026), otherwise the sum over rooms that aren't muted.
 */
export function chatUnreadTotal(data?: { conversations?: NexusConversation[]; totalUnread?: number } | null): number {
  if (!data) return 0;
  if (typeof data.totalUnread === "number") return data.totalUnread;
  const now = Date.now();
  return (data.conversations ?? []).reduce((n, c) => n + (isMuted(c, now) ? 0 : c.unreadCount ?? 0), 0);
}

// Old servers answer /api/conversations/unread with 404 (the path matches /api/conversations/[id]).
// Remember that for this page load so the badge doesn't ask twice for a route that isn't there.
let unreadRouteMissing = false;

async function fetchChatUnread(qc: QueryClient): Promise<number> {
  if (!unreadRouteMissing) {
    try {
      const res = await nexusApi.conversationsUnread();
      if (typeof res?.totalUnread === "number") return res.totalUnread;
      unreadRouteMissing = true;
    } catch (e) {
      if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 405)) throw e;
      unreadRouteMissing = true;
    }
  }
  // Shares the list's cache entry, so on the Messages page this is the same request, not a second one.
  const list = await qc.fetchQuery({ queryKey: ["conversations"], queryFn: () => nexusApi.conversations(), staleTime: 10_000 });
  return chatUnreadTotal(list);
}

/** Unread chat messages over all unmuted rooms. Live via the socket; a minute's poll as a safety net. */
export function useChatUnread(): number {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: CHAT_UNREAD_KEY,
    queryFn: () => fetchChatUnread(qc),
    retry: false,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  return q.data ?? 0;
}

/** Whether this tab is in front. A chat open in a background tab doesn't count as read. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

const TITLE_COUNT = /^\(\d+\+?\)\s+/;

/** "(3) NEXUS Phaëthon" while chats are unread; the plain title again at zero. */
export function useUnreadTitle(count: number) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const base = document.title.replace(TITLE_COUNT, "");
    document.title = count > 0 ? `(${count > 99 ? "99+" : count}) ${base}` : base;
    return () => { document.title = document.title.replace(TITLE_COUNT, ""); };
  }, [count]);
}

/** Mounted once in the app shell: keeps the tab title's count in step with the badge. */
export function ChatUnreadTitle() {
  useUnreadTitle(useChatUnread());
  return null;
}
