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
import { ID_TEMPLATES } from "@/lib/i18n/id-templates";
import { ID_VAULT } from "@/lib/i18n/id-vault";
import { ID_NAV } from "@/lib/i18n/id-nav";
import { ID_PIPELINE } from "@/lib/i18n/id-pipeline";
import { ID_AUTOMATIONS } from "@/lib/i18n/id-automations";
import { ID_FOLDERS } from "@/lib/i18n/id-folders";
import { ID_OUTLET } from "@/lib/i18n/id-outlet";
import { ID_SOCIAL } from "@/lib/i18n/id-social";
import { ID_PROJECT_OVERVIEW } from "@/lib/i18n/id-project-overview";
import { ID_SHEETS } from "@/lib/i18n/id-sheets";
import { ID_SHEETS_MENUS } from "@/lib/i18n/id-sheets-menus";
import { ID_SHEETS_PANELS } from "@/lib/i18n/id-sheets-panels";
import { ID_SHEETS_CHART } from "@/lib/i18n/id-sheets-chart";
import { ID_SHEETS_DATA } from "@/lib/i18n/id-sheets-data";
import { ID_SHEETS_TOOLBAR } from "@/lib/i18n/id-sheets-toolbar";
import { ID_SHEETS_GRID } from "@/lib/i18n/id-sheets-grid";
import { ID_SHEETS_PIVOT } from "@/lib/i18n/id-sheets-pivot";
import { ID_SHEETS_FORMATS } from "@/lib/i18n/id-sheets-formats";
import { ID_VIEWS } from "@/lib/i18n/id-views";
import { ID_EDITOR } from "@/lib/i18n/id-editor";
import { ID_GIDEON } from "@/lib/i18n/id-gideon";
import { ID_GIDEON_AI } from "@/lib/i18n/id-gideon-ai";
import { ID_CATEGORIES } from "@/lib/i18n/id-categories";
import { ID_COPY } from "@/lib/i18n/id-copy";
import { ID_I18N_ADMIN } from "@/lib/i18n/id-i18n-admin";
import { ID_I18N_SHELL } from "@/lib/i18n/id-i18n-shell";
import { ID_I18N_ATTENDANCE } from "@/lib/i18n/id-i18n-attendance";
import { ID_I18N_WORK } from "@/lib/i18n/id-i18n-work";
import { ID_FORMS } from "@/lib/i18n/id-forms";
import { ID_I18N_PROJECTS_EXTRA } from "@/lib/i18n/id-i18n-projects";
import { ID_SESSIONS } from "@/lib/i18n/id-sessions";
import { ID_FIX_PAGES } from "@/lib/i18n/id-fix-pages";
import { ID_UISWEEP } from "@/lib/i18n/id-uisweep";
import { ID_TASK_VIEWS } from "@/lib/i18n/id-task-views";
import { ID_QAFIX_PERM } from "@/lib/i18n/id-qafix-perm";
import { ID_LEGAL } from "@/lib/i18n/id-legal";
import { ID_LEGAL_REQUESTS } from "@/lib/i18n/id-legal-requests";
import { ID_QAFIX_WORK } from "@/lib/i18n/id-qafix-work";
import { ID_QAFIX_KBD } from "@/lib/i18n/id-qafix-kbd";
import { ID_R7WEB } from "@/lib/i18n/id-r7web";
import { ID_R10WEB } from "@/lib/i18n/id-r10web";
import { ID_R11WEB } from "@/lib/i18n/id-r11web";
import { ID_R12WEB } from "@/lib/i18n/id-r12web";
import { ID_R13WEB } from "@/lib/i18n/id-r13web";
import { ID_R14WEB_A } from "@/lib/i18n/id-r14web-a";
import { ID_R14WEB_B } from "@/lib/i18n/id-r14web-b";
import { ID_R14WEB_C } from "@/lib/i18n/id-r14web-c";
import { ID_R14WEB_D } from "@/lib/i18n/id-r14web-d";
import { ID_NUMFMT } from "@/lib/i18n/id-numfmt";
import { ID_R15WEB } from "@/lib/i18n/id-r15web";
import { ID_R16WEB } from "@/lib/i18n/id-r16web";
import { ID_R17WEB } from "@/lib/i18n/id-r17web";
import { ID_R18WEB } from "@/lib/i18n/id-r18web";
import { ID_R19WEB } from "@/lib/i18n/id-r19web";

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

const ID: Record<string, string> = { ...ID_COMMON, ...ID_ORGCHART, ...ID_CALENDAR, ...ID_CALENDAR_PAGE, ...ID_CALENDAR_EXTRA, ...ID_CHAT, ...ID_AUDIT, ...ID_OFFBOARD, ...ID_FORMER, ...ID_PROJECTS, ...ID_TEMPLATES, ...ID_PROFILE, ...ID_VAULT, ...ID_NAV, ...ID_PIPELINE, ...ID_AUTOMATIONS, ...ID_FOLDERS, ...ID_OUTLET, ...ID_SOCIAL, ...ID_PROJECT_OVERVIEW, ...ID_SHEETS, ...ID_SHEETS_MENUS, ...ID_SHEETS_PANELS, ...ID_SHEETS_CHART, ...ID_SHEETS_DATA, ...ID_SHEETS_TOOLBAR, ...ID_SHEETS_GRID, ...ID_SHEETS_PIVOT, ...ID_SHEETS_FORMATS, ...ID_VIEWS, ...ID_EDITOR, ...ID_GIDEON, ...ID_GIDEON_AI, ...ID_CATEGORIES, ...ID_COPY, ...ID_I18N_ADMIN, ...ID_I18N_SHELL, ...ID_I18N_ATTENDANCE, ...ID_I18N_WORK, ...ID_FORMS, ...ID_I18N_PROJECTS_EXTRA, ...ID_SESSIONS, ...ID_FIX_PAGES, ...ID_UISWEEP, ...ID_TASK_VIEWS, ...ID_QAFIX_WORK, ...ID_QAFIX_KBD, ...ID_QAFIX_PERM, ...ID_LEGAL, ...ID_LEGAL_REQUESTS, ...ID_R7WEB, ...ID_R10WEB, ...ID_R11WEB, ...ID_R12WEB, ...ID_R13WEB, ...ID_R14WEB_A, ...ID_R14WEB_B, ...ID_R14WEB_C, ...ID_R14WEB_D, ...ID_NUMFMT, ...ID_R15WEB, ...ID_R16WEB, ...ID_R17WEB, ...ID_R18WEB, ...ID_R19WEB };

function read(): Lang {
  try {
    // `?lang=en|id` in the address picks the language for this browser and keeps it (UI tour, 13 Oct
    // 2026: real Safari has no way to preset localStorage). Local only: the account setting that
    // notifications follow is changed by setLang, not by a link.
    const asked = new URLSearchParams(window.location.search).get("lang");
    if (asked === "en" || asked === "id") {
      try { localStorage.setItem(KEY, asked); } catch { /* private mode: this page only */ }
      return asked;
    }
  } catch { /* no location */ }
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
  // A chosen language: notifications and pushes follow it (server User.uiLanguage, 13 Oct 2026).
  // Best effort; signed out = 401, ignored.
  try {
    void fetch("/api/user/profile", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", "X-Nexus-Client": "web/1" }, body: JSON.stringify({ uiLanguage: l }) }).catch(() => {});
  } catch { /* no fetch */ }
}

function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * Translate an English source text into the current language, then fill `{placeholders}`. A key may carry a
 * context before "\u0004" (the gettext convention), for one English text that needs two Indonesian ones:
 * "self\u0004Sign out" reads "Sign out" in English and "Keluar" in Indonesian, while the sessions list's
 * "Sign out" (another device) stays "Keluarkan" (UI tour run 18, decision 1).
 */
export function t(en: string, vars?: Record<string, string | number>, lang: Lang = current): string {
  const text = lang === "id" ? (ID[en] ?? en) : en;
  const cut = text.indexOf("\u0004");
  return fill(cut >= 0 ? text.slice(cut + 1) : text, vars);
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
