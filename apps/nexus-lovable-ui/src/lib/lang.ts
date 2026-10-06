import { useSyncExternalStore } from "react";
import { ID_CALENDAR } from "@/lib/i18n/id-calendar";
import { ID_CALENDAR_PAGE } from "@/lib/i18n/id-calendar-page";
import { ID_COMMON } from "@/lib/i18n/id-common";
import { ID_ORGCHART } from "@/lib/i18n/id-orgchart";

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

const ID: Record<string, string> = { ...ID_COMMON, ...ID_ORGCHART, ...ID_CALENDAR, ...ID_CALENDAR_PAGE };

function read(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "id") return saved;
  } catch { /* ignore */ }
  return "id";
}

let current: Lang = typeof window === "undefined" ? "id" : read();
// <html lang> stays as index.html sets it: most screens are not translated yet. A translated screen
// sets lang={lang} on its own root (Calendar, Bagan).

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

/** The current language; re-renders the component when it changes. */
export function useLang() {
  const lang = useSyncExternalStore(subscribe, () => current, () => "id" as Lang);
  return {
    lang,
    setLang,
    locale: localeOf(lang),
    t: (en: string, vars?: Record<string, string | number>) => t(en, vars, lang),
    tn: (n: number, one: string, many: string, vars?: Record<string, string | number>) => tn(n, one, many, vars, lang),
  };
}
