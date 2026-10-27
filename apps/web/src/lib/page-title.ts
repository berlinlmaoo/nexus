import { useEffect, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";
import { t, useLang } from "@/lib/lang";

/**
 * The browser tab title (owner, 27 Oct 2026: every tab read "NEXUS Phaëthon"). Phaëthon is the web app's
 * internal name; people see NEXUS.
 *
 *   "<page> · NEXUS"            the page's own name when it has one (a form, project, task, doc, chat …),
 *                               otherwise the section ("Calendar · NEXUS", "Kalender · NEXUS")
 *   "(3) <page> · NEXUS"        while chats are unread (chat-unread.ts)
 *   "NEXUS"                     anywhere else
 *
 * Section names come from the address (below) and follow the UI language. A page with a name of its own calls
 * usePageTitle(name); the newest caller wins while it is mounted. One writer (<DocumentTitle/> in the root
 * route) sets document.title, so nothing else overwrites it. The DEV marker adds "[DEV] " on top.
 */

const SITE = "NEXUS";

type Entry = { name: string; full: boolean };
let stack: Entry[] = [];
let unread = 0;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach((f) => f()); };
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** Sections by address. `page\u0004` keeps these words apart from the same English elsewhere in the tables. */
const SECTIONS: [RegExp, string][] = [
  [/^\/dashboard$/, "page\u0004Dashboard"],
  [/^\/messages(\/|$)/, "page\u0004Messages"],
  [/^\/gideon(\/|$)/, "page\u0004GIDEON"],
  [/^\/inbox$/, "page\u0004Notifications"],
  [/^\/my-tasks$/, "page\u0004My Tasks"],
  [/^\/submissions$/, "page\u0004My Submissions"],
  [/^\/calendar$/, "page\u0004Calendar"],
  [/^\/master-calendar$/, "page\u0004Master Calendar"],
  [/^\/attendance$/, "page\u0004Attendance"],
  [/^\/projects(\/|$)/, "page\u0004Projects"],
  [/^\/tasks\//, "page\u0004Task"],
  [/^\/folders\//, "page\u0004Folder"],
  [/^\/docs(\/|$)/, "page\u0004Pages"],
  [/^\/forms$/, "page\u0004Forms"],
  [/^\/legal$/, "page\u0004Legal"],
  [/^\/leaderboard$/, "page\u0004Leaderboard"],
  [/^\/vault$/, "page\u0004Z Vault"],
  [/^\/(s|v)\//, "page\u0004Z Vault"],
  [/^\/threads$/, "page\u0004Threads"],
  [/^\/room-booking$/, "page\u0004Room Booking"],
  [/^\/complaints$/, "page\u0004Tickets"],
  [/^\/settings$/, "page\u0004Settings"],
  [/^\/admin$/, "page\u0004Control Room"],
  [/^\/pipelines$/, "page\u0004Pipelines"],
  [/^\/meetings(\/|$)/, "page\u0004Meeting notes"],
  [/^\/teams$/, "page\u0004Team"],
  [/^\/people\//, "page\u0004Team"],
  [/^\/reports(\/|$)/, "page\u0004Reports"],
  [/^\/reminders$/, "page\u0004Reminders"],
  [/^\/login$/, "page\u0004Sign in"],
  [/^\/sso\//, "page\u0004Sign in"],
  [/^\/register$/, "page\u0004Request access"],
  [/^\/forgot-password$/, "page\u0004Reset password"],
  [/^\/oauth\/authorize$/, "page\u0004Authorize access"],
  [/^\/download\/android$/, "page\u0004Get NEXUS for Android"],
  [/^\/room-display\//, "page\u0004Room display"],
  [/^\/f\/legal-[A-Za-z0-9]{24}$/, "page\u0004Legal request"],
  [/^\/f\//, "page\u0004Form"],
];

/** The section of an address in the current language, or null (the plain "NEXUS"). */
export function sectionTitle(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  for (const [re, key] of SECTIONS) if (re.test(path)) return t(key);
  return null;
}

/** "(n) <name> · NEXUS" — pure, for tests. */
export function composeTitle(name: string | null, opts: { full?: boolean; unread?: number } = {}): string {
  const base = name ? (opts.full ? name : `${name} · ${SITE}`) : SITE;
  const n = opts.unread ?? 0;
  return n > 0 ? `(${n > 99 ? "99+" : n}) ${base}` : base;
}

/**
 * Name this page in the tab while it is mounted ("Pengajuan Finance" → "Pengajuan Finance · NEXUS").
 * Empty / undefined = no name yet (still loading): the section shows. `full` = the whole title, as given.
 */
export function usePageTitle(name: string | null | undefined, opts: { full?: boolean } = {}) {
  const value = (name ?? "").replace(/\s+/g, " ").trim();
  const full = !!opts.full;
  useEffect(() => {
    if (!value) return;
    const entry: Entry = { name: value, full };
    stack = [...stack, entry];
    emit();
    return () => { stack = stack.filter((e) => e !== entry); emit(); };
  }, [value, full]);
}

/** The page's own name as the tab shows it, without "· NEXUS" (GIDEON's Ask AI reads it). */
export function currentPageName(): string | null {
  return stack.length ? stack[stack.length - 1].name : null;
}

/** Unread chats for the "(3)" in front (chat-unread.ts). */
export function setTitleUnread(n: number) {
  const next = Math.max(0, Math.floor(n) || 0);
  if (next === unread) return;
  unread = next;
  emit();
}

/** Mounted once in the root route: the only writer of document.title. */
export function DocumentTitle() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { lang } = useLang();
  const v = useSyncExternalStore(subscribe, () => version, () => version);
  useEffect(() => {
    const top = stack.length ? stack[stack.length - 1] : null;
    const title = top ? composeTitle(top.name, { full: top.full, unread }) : composeTitle(sectionTitle(pathname), { unread });
    if (document.title !== title) document.title = title;
  }, [pathname, lang, v]);
  return null;
}
