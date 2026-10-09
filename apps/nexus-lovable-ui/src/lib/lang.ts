import { useEffect, useSyncExternalStore } from "react";
import { ID_AUDIT } from "@/lib/i18n/id-audit";
import { ID_CALENDAR } from "@/lib/i18n/id-calendar";
import { ID_CALENDAR_EXTRA } from "@/lib/i18n/id-calendar-extra";
import { ID_CALENDAR_PAGE } from "@/lib/i18n/id-calendar-page";
import { ID_CHAT } from "@/lib/i18n/id-chat";
import { ID_FORMER } from "@/lib/i18n/id-former";
import { ID_OFFBOARD } from "@/lib/i18n/id-offboard";
import { ID_COMMON } from "@/lib/i18n/id-common";
import { ID_ORGCHART } from "@/lib/i18n/id-orgchart";
import { ID_PROFILE } from "@/lib/i18n/id-profile";
import { ID_PROJECTS } from "@/lib/i18n/id-projects";
import { ID_VAULT } from "@/lib/i18n/id-vault";
import { ID_NAV } from "@/lib/i18n/id-nav";
import { ID_PIPELINE } from "@/lib/i18n/id-pipeline";

/**
 * Interface language, English or Indonesian (owner, 5 Oct 2026: "make sure there is English and
 * Indonesian, not suddenly Indonesian only"). The same scheme as the iOS app: the SOURCE text is
 * English and is the dictionary key; `t()` looks it up in the Indonesian tables when the language is
 * Indonesian, and falls back to the English text when a key is missing. Placeholders are `{name}`.
 *
 * Stored per browser (localStorage "nexus-lang", like "nexus-theme"); Indonesian by default, since that
 * is what the app has been until now. Switched from the profile menu (sidebar / More sheet) and
 * Settings › Appearance. Screens move over one by one: today the Calendar and the Bagan.
 */
export type Lang = "id" | "en";
const KEY = "nexus-lang";
const listeners = new Set<() => void>();

const ID: Record<string, string> = { ...ID_COMMON, ...ID_ORGCHART, ...ID_CALENDAR, ...ID_CALENDAR_PAGE, ...ID_CALENDAR_EXTRA, ...ID_CHAT, ...ID_AUDIT, ...ID_OFFBOARD, ...ID_FORMER, ...ID_PROJECTS, ...ID_PROFILE, ...ID_VAULT, ...ID_NAV, ...ID_PIPELINE };

function read(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "id") return saved;
  } catch { /* ignore */ }
  return "id";
}

let current: Lang = typeof window === "undefined" ? "id" : read();
// <html lang> stays as index.html sets it ("en"): most screens are not translated yet. A translated
// screen sets lang={lang} on its own root (Calendar, Bagan) and calls useDocumentLang(lang) while it is
// mounted, so popovers, drawers, tooltips and dialogs (portaled to <body>, outside that root) are read
// in the right language too.

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang) {
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  listeners.forEach((f) => f());
}

function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Translate an English source text into the current language, then fill `{placeholders}`. */
export function t(en: string, vars?: Record<string, string | number>, lang: Lang = current): string {
  return fill(lang === "id" ? (ID[en] ?? en) : en, vars);
}

/**
 * Count + noun: `tn(3, "{n} task", "{n} tasks")`. English picks singular/plural; Indonesian has one form
 * (the dictionary maps both English keys to the same text).
 */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>, lang: Lang = current): string {
  return t(n === 1 ? one : many, { n, ...vars }, lang);
}

/** BCP-47 locale for Intl formatting in the current language. */
export function localeOf(l: Lang = current): string {
  return l === "id" ? "id-ID" : "en-GB";
}

function subscribe(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export type LangApi = {
  lang: Lang
  setLang: (l: Lang) => void
  locale: string
  t: (en: string, vars?: Record<string, string | number>) => string
  tn: (n: number, one: string, many: string, vars?: Record<string, string | number>) => string
};

// One object per language, shared by every component: `t` keeps its identity between renders, so a
// useCallback/useMemo/memo() that depends on it only re-runs when the language actually changes.
const apis = new Map<Lang, LangApi>();
function apiOf(lang: Lang): LangApi {
  let api = apis.get(lang);
  if (!api) {
    api = {
      lang,
      setLang,
      locale: localeOf(lang),
      t: (en, vars) => t(en, vars, lang),
      tn: (n, one, many, vars) => tn(n, one, many, vars, lang),
    };
    apis.set(lang, api);
  }
  return api;
}

/** The current language; re-renders the component when it changes. */
export function useLang(): LangApi {
  const lang = useSyncExternalStore(subscribe, () => current, () => "id" as Lang);
  return apiOf(lang);
}

/**
 * While the calling screen is mounted, <html lang> follows the interface language, so content portaled
 * to <body> is announced in the right language. The previous value comes back on unmount.
 */
export function useDocumentLang(lang: Lang) {
  useEffect(() => {
    const html = document.documentElement;
    const before = html.lang;
    html.lang = lang;
    return () => { html.lang = before; };
  }, [lang]);
}
