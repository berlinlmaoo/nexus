#!/usr/bin/env node
import { existsSync } from "node:fs";
// Web half of the NEXUS UI screenshot tour (../ui-tour.sh, docs/UI-TOUR.md).
//
// The whole screen (owner, 13 Oct 2026), not just the first viewport: since run 10 as viewport-sized pages
// <id>.png, <id>-2.png … paged through the screen's scroller (capture()), not one full-page document shot.
// Photographs every screen in ../ui-tour-screens.json on the DEV web twice: desktop 1440x900 (the master
// reference) and mobile 440x956 @3x (iPhone 17 Pro Max). Signs in ONCE with the QA account and reuses
// that session for both. One Chromium, closed in `finally`.
//
// Read-only on purpose: every non-GET /api call except sign-in and realtime plumbing is answered 503 by
// this script, so opening a screen can never mark, save or send anything for the QA account.
//
//   TOUR_EMAIL / TOUR_PASSWORD   the QA account (ui-tour.sh reads them from the macOS Keychain)
//   TOUR_NONMEMBER_EMAIL / TOUR_NONMEMBER_PASSWORD   optional second account that is NOT invited to Legal
//                                (default qa6@dev.invalid; ui-tour.sh reads its Keychain entry). Screens with
//                                "account": "nonmember" are shot with it; without the password they are skipped.
//   TOUR_LEGAL_DOC_ID / TOUR_LEGAL_FORM_PATH   optional: the Legal document / request form path to use instead
//                                of looking them up (newest [TEST] document, the general request link)
//   node tour.mjs --out <dir> [--only id,id] [--base https://…] [--variants desktop,mobile]
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const OUT = path.resolve(opt("out", path.join(process.cwd(), "ui-tour-out")));
const BASE = (opt("base", process.env.TOUR_WEB_BASE || "https://nexus-prod.tail765d02.ts.net:8443")).replace(/\/$/, "");
const ONLY = new Set((opt("only", process.env.TOUR_ONLY || "")).split(",").map((s) => s.trim()).filter(Boolean));
const WANT = new Set(opt("variants", "desktop,mobile").split(",").map((s) => s.trim()));
const EMAIL = process.env.TOUR_EMAIL || "qa5@dev.invalid";
const PASSWORD = process.env.TOUR_PASSWORD || "";
const LANG = process.env.TOUR_LANG || "en";
const NONMEMBER_EMAIL = process.env.TOUR_NONMEMBER_EMAIL || "qa6@dev.invalid";
const NONMEMBER_PASSWORD = process.env.TOUR_NONMEMBER_PASSWORD || "";

const config = JSON.parse(fs.readFileSync(path.join(HERE, "..", "ui-tour-screens.json"), "utf8"));
const projectId = process.env.TOUR_PROJECT_ID || config.projectId;
const formId = process.env.TOUR_FORM_ID || config.formId;
const screens = config.screens
  .filter((s) => s.web && (ONLY.size === 0 || ONLY.has(s.id)))
  .map((s) => ({ ...s, web: s.web.replaceAll("{project}", projectId).replaceAll("{form}", formId) }));
// Screens of the QA account, and the ones shot as the account that is not invited to Legal.
const memberScreens = screens.filter((s) => s.account !== "nonmember");
const nonmemberScreens = screens.filter((s) => s.account === "nonmember");

const VARIANTS = {
  desktop: { dir: "web-desktop", context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  mobile: {
    dir: "web-mobile",
    context: {
      ...devices["iPhone 15 Pro Max"],
      viewport: { width: 440, height: 956 },
      screen: { width: 440, height: 956 },
      deviceScaleFactor: 3,
    },
  },
};

// Sign-in, the session, realtime and error reporting may write; nothing else may.
const ALLOW_WRITE = /\/api\/(auth\/|realtime-init|client-errors|errors|presence|socket)|\/socket\.io\//;

function memAvailableMB() {
  try {
    const m = fs.readFileSync("/proc/meminfo", "utf8").match(/MemAvailable:\s+(\d+)/);
    return m ? Math.round(Number(m[1]) / 1024) : Infinity;
  } catch {
    return Infinity; // macOS: no /proc, and its "free" memory figure means nothing useful here
  }
}

async function prepare(ctx) {
  await ctx.addInitScript((lang) => {
    try {
      localStorage.setItem("nexus-lang", lang);
      localStorage.setItem("nexus-theme", "light");
      localStorage.setItem("nexus-appstore-never", "1");
      // The "You haven't checked in today" reminder, answered "Later" in advance (its own 30-minute
      // snooze key, AttendanceReminderModal.tsx): run 10's legal-hidden shots of qa6 were that modal.
      localStorage.setItem("nx-checkin-reminder-snooze", String(Date.now() + 12 * 3600 * 1000));
      // The "install NEXUS on your phone" prompt, dismissed for this tab.
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) {
        if (this === window.sessionStorage && String(k).startsWith("nexus-phone-prompt-dismissed:")) return "1";
        return get.call(this, k);
      };
    } catch {}
  }, LANG);
  await ctx.route("**/api/**", (route) => {
    const r = route.request();
    if (["GET", "HEAD", "OPTIONS"].includes(r.method()) || ALLOW_WRITE.test(r.url())) return route.fallback();
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "UI tour: read-only" }) });
  });
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  // Spinners (Tailwind's animate-spin, aria-busy) gone for a moment, or 12 s, whichever first.
  const deadline = Date.now() + 12000;
  let quiet = 0;
  while (Date.now() < deadline) {
    const busy = await page
      .evaluate(() => [...document.querySelectorAll(".animate-spin, [aria-busy='true']")].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      }))
      .catch(() => false);
    quiet = busy ? 0 : quiet + 1;
    if (quiet >= 3) break;
    await page.waitForTimeout(300);
  }
  const remind = page.getByText(/Jangan ingatkan lagi|Don.t remind me/);
  if (await remind.count().catch(() => 0)) {
    await remind.first().click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await dismissAttendanceReminder(page);
  await page.waitForTimeout(800);
  return quiet >= 3;
}

/**
 * The attendance reminder over any page (check-in, or "finish your previous attendance"): "Later", else its
 * close button, as a person would. Only inside that dialog: My Tasks has a "Later" group of its own.
 */
async function dismissAttendanceReminder(page) {
  const dialog = page.locator('[role="dialog"]').filter({
    hasText: /checked in today|belum check-in hari ini|Finish your previous attendance|forgot to check out|lupa check-out/i,
  });
  if (!(await dialog.first().isVisible().catch(() => false))) return false;
  const later = dialog.first().getByRole("button", { name: /^(Later|Nanti)$/ });
  const close = dialog.first().getByRole("button", { name: /^(Close|Tutup)$/ });
  if (await later.first().isVisible().catch(() => false)) await later.first().click().catch(() => {});
  else await close.first().click().catch(() => {});
  await dialog.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  return true;
}

const MAX_PAGES = Number(process.env.TOUR_MAX_PAGES) || 6;

/**
 * The screenshot(s) of one screen: `<id>.png`, then `<id>-2.png` … like the app tour (TOUR_MAX_PAGES, default 6).
 * Not a full-page document screenshot (run 10): Chrome draws that beyond the viewport without resizing it, so
 * fixed parts stay where the viewport was (the mobile bottom nav floated mid-page), and on app-shell pages
 * (a 100vh shell whose content scrolls inside) the shot got the document's empty tail (Calendar desktop:
 * ~900 px of blank) while the inner scrollers stayed cut at the viewport (the Calendar's right rail). So:
 * viewport-sized shots; between them every scroller on screen (the document, and each inner content scroll
 * area that covers at least a fifth of the viewport, not the navigation) moves on by 85% of its height, but never past its last
 * visible content, so an empty tail is not photographed. Stops when nothing moves any more.
 */
async function capture(page, dir, id) {
  const shot = (n) => page.screenshot({ path: path.join(dir, n === 1 ? `${id}.png` : `${id}-${n}.png`) });
  for (const f of fs.readdirSync(dir)) if (f.startsWith(`${id}-`) && /^-\d+\.png$/.test(f.slice(id.length))) fs.rmSync(path.join(dir, f));
  const step = () => page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const doc = document.scrollingElement || document.documentElement;
    const all = [...document.body.querySelectorAll("*")];
    const inner = new Set(all.filter((el) => el.scrollHeight > el.clientHeight + 4 && el.clientHeight >= 120
      && /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY)));
    // Where each scroller's content really ends: the lowest drawn leaf (no element children, or a picture /
    // control) whose nearest scroller it is. Wrappers stretched to a min-height do not count.
    const end = new Map([[doc, 0], ...[...inner].map((s) => [s, 0])]);
    const pos = new Map();
    for (const el of all) {
      if (el.children.length && !/^(svg|img|canvas|video|input|textarea|select|button)$/i.test(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // Fixed and sticky parts move with the scroll position: counting them pushed the end on by every step.
      let s = doc, pinned = false;
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        if (a !== el && inner.has(a)) { s = a; break; }
        if (!pos.has(a)) pos.set(a, getComputedStyle(a).position);
        if (pos.get(a) === "fixed" || pos.get(a) === "sticky") { pinned = true; break; }
      }
      if (pinned) continue;
      const bottom = s === doc ? r.bottom + scrollY : r.bottom - s.getBoundingClientRect().top + s.scrollTop;
      if (bottom > end.get(s)) end.set(s, bottom);
    }
    let moved = false;
    for (const [s, bottom] of end) {
      const height = s === doc ? vh : s.clientHeight;
      if (s !== doc) {
        const r = s.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        // The navigation sidebar scrolls too, but is not the screen (run 10 retest: page 2 of short pages
        // was the sidebar scrolled): only content scrollers of a fifth of the viewport or more.
        if (w * h < vw * vh * 0.2 || s.closest("nav, [role='navigation'], [data-sidebar]")) continue;
      }
      const limit = Math.max(0, Math.ceil(bottom + 16 - height));
      const before = s.scrollTop;
      if (before >= limit) continue;
      s.scrollTop = Math.min(limit, before + Math.round(height * 0.85));
      if (s.scrollTop > before + 1) moved = true;
    }
    return moved;
  }).catch(() => false);
  await shot(1);
  let pages = 1;
  while (pages < MAX_PAGES && (await step())) {
    await page.waitForTimeout(700);
    pages += 1;
    await shot(pages);
  }
  return { pages };
}

async function signIn(browser) {
  const ctx = await browser.newContext({ ...VARIANTS.desktop.context, ignoreHTTPSErrors: true });
  try {
    await prepare(ctx);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });
    return await ctx.storageState();
  } finally {
    await ctx.close();
  }
}

/**
 * The run-time values of the Legal screens, read with the QA session (GET only): `{legalDoc}` = the newest
 * [TEST] document, `{legalForm}` = the general request link's path (/f/legal-<token>). A value that cannot
 * be found becomes `{ skip: "<reason>" }`, and the screens that need it are recorded as skipped.
 */
async function legalValues(browser, state) {
  const wanted = memberScreens.some((s) => /\{legal(Doc|Form)\}/.test(s.web));
  const values = {
    legalDoc: process.env.TOUR_LEGAL_DOC_ID ? { value: process.env.TOUR_LEGAL_DOC_ID } : null,
    legalForm: process.env.TOUR_LEGAL_FORM_PATH ? { value: process.env.TOUR_LEGAL_FORM_PATH } : null,
  };
  if (!wanted || (values.legalDoc && values.legalForm)) return values;
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, storageState: state });
  const get = async (p) => {
    const r = await ctx.request.get(BASE + p, { timeout: 30000 });
    if (!r.ok()) throw new Error(`HTTP ${r.status()} from ${p.split("?")[0]}`);
    return r.json();
  };
  try {
    if (!values.legalDoc) {
      try {
        const page = await get(`/api/legal/documents?q=${encodeURIComponent("[TEST]")}&limit=20`);
        const doc = (page.documents || []).find((d) => String(d.title || "").includes("[TEST]")) || null;
        values.legalDoc = doc ? { value: doc.id, title: doc.title } : { skip: "no [TEST] Legal document on dev" };
      } catch (e) {
        values.legalDoc = { skip: `Legal documents not readable (${e.message})` };
      }
    }
    if (!values.legalForm) {
      try {
        const links = (await get("/api/legal/request-links")).links || [];
        const general = links.find((l) => l.scope === "general");
        values.legalForm = general?.path ? { value: general.path } : { skip: "no general Legal request link" };
        if (general && general.accepting === false) values.legalForm.note = "link is closed (accepting: false)";
      } catch (e) {
        values.legalForm = { skip: `Legal request links not readable (${e.message})` };
      }
    }
  } finally {
    await ctx.close();
  }
  for (const [k, v] of Object.entries(values)) if (v) console.log(`legal ${k}: ${v.skip ? `skipped: ${v.skip}` : "found"}`);
  return values;
}

/** `s.web` with the Legal values filled in, or `{ skip }` when one of them is missing. */
function resolveWeb(s, legal) {
  let web = s.web;
  for (const key of ["legalDoc", "legalForm"]) {
    if (!web.includes(`{${key}}`)) continue;
    const v = legal[key];
    if (!v || v.skip) return { skip: v?.skip || `${key} not looked up` };
    web = web.replaceAll(`{${key}}`, v.value);
  }
  return { web };
}

/**
 * A session for the account that is NOT invited to Legal, through the API (/api/auth/app-login, the
 * app's own sign-in: a token the web accepts as its session cookie). No typing into the web form, and
 * the session is ended again with /api/auth/app-logout (that session only).
 */
async function apiSession(email, password) {
  const r = await fetch(`${BASE}/api/auth/app-login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexus-client": "web/1" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status !== 200 || !body.token || !body.cookieName) throw new Error(`sign-in refused: HTTP ${r.status}`);
  const host = new URL(BASE).hostname;
  return {
    cookie: { name: body.cookieName, value: body.token, domain: host, path: "/", httpOnly: true, secure: BASE.startsWith("https:"), sameSite: "Lax" },
    end: () =>
      fetch(`${BASE}/api/auth/app-logout`, {
        method: "POST",
        headers: { cookie: `${body.cookieName}=${body.token}` },
        signal: AbortSignal.timeout(15000),
      }).catch(() => {}),
  };
}

/**
 * The negative check (legal-hidden): signed in as the account without Legal, the server says
 * canAccessLegal false, no Legal entry in the navigation (desktop sidebar; on mobile the More sheet,
 * opened for a second shot `<id>-2`), and /legal shows the "by invitation only" state.
 */
async function nonmemberTour(browser, results) {
  if (nonmemberScreens.length === 0) return;
  const skipAll = (why) => {
    for (const [name, variant] of Object.entries(VARIANTS)) {
      for (const s of nonmemberScreens) {
        results.push({ variant: variant.dir, id: s.id, status: `skipped: ${why}`, seconds: 0, horizontalOverflowPx: null, pageErrors: [] });
        console.log(`${variant.dir} ${s.id}: skipped: ${why}`);
      }
    }
  };
  if (!NONMEMBER_PASSWORD) return skipAll(`no password for ${NONMEMBER_EMAIL} (TOUR_NONMEMBER_PASSWORD / Keychain; docs/UI-TOUR.md)`);
  let session;
  try {
    session = await apiSession(NONMEMBER_EMAIL, NONMEMBER_PASSWORD);
  } catch (e) {
    return skipAll(`${NONMEMBER_EMAIL} ${e.message}`);
  }
  try {
    // Both web variants, always: in the Safari mode the mobile web is shot by the iOS test, which has only
    // the QA account, so this one comes from Chrome's iPhone emulation.
    for (const [name, variant] of Object.entries(VARIANTS)) {
      const dir = path.join(OUT, variant.dir);
      fs.mkdirSync(dir, { recursive: true });
      const ctx = await browser.newContext({
        ...variant.context,
        ignoreHTTPSErrors: true,
        timezoneId: "Asia/Jakarta",
        locale: LANG === "id" ? "id-ID" : "en-US",
        colorScheme: "light",
      });
      try {
        await ctx.addCookies([session.cookie]);
        await prepare(ctx);
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
        for (const s of nonmemberScreens) {
          const started = Date.now();
          errors.length = 0;
          const problems = [];
          try {
            const r = await ctx.request.get(`${BASE}/api/workspaces/members`, { timeout: 30000 });
            const roster = r.ok() ? await r.json() : null;
            if (!roster) problems.push(`roster HTTP ${r.status()}`);
            else if (roster.canAccessLegal === true) problems.push(`${NONMEMBER_EMAIL} IS invited to Legal (canAccessLegal true)`);
            const legalApi = await ctx.request.get(`${BASE}/api/legal/me`, { timeout: 30000 });
            if (legalApi.status() !== 403) problems.push(`/api/legal/me answered ${legalApi.status()}, expected 403`);
            await page.goto(BASE + s.web, { waitUntil: "domcontentloaded", timeout: 45000 });
            const quiet = await settle(page);
            if (new URL(page.url()).pathname.startsWith("/login")) problems.push("bounced to /login (session lost)");
            const invited = page.getByText(/Legal is by invitation only|Legal hanya untuk yang diundang/);
            if (!(await invited.first().isVisible().catch(() => false))) problems.push('"by invitation only" state not shown');
            if (name === "desktop") {
              // The sidebar is drawn by now (settle waited for the network, the roster included).
              if (await page.locator('a[href="/legal"]').count()) problems.push("Legal menu item is visible");
            }
            if (!quiet) problems.push("spinner still visible after 12 s");
          } catch (e) {
            problems.push(`error: ${String(e.message || e).split("\n")[0]}`);
          }
          let pages = 0;
          try {
            pages = (await capture(page, dir, s.id)).pages;
          } catch (e) {
            problems.push(`no screenshot: ${e.message}`);
          }
          if (name === "mobile") {
            // The mobile navigation lives in the More sheet: open it, look for Legal, photograph it as the
            // next page. Run 10: the attendance reminder swallowed the click, the sheet never opened, the
            // "-2" shot repeated the first one and the Legal check passed on a page without the menu.
            await dismissAttendanceReminder(page);
            await page.evaluate(() => { for (const el of document.querySelectorAll("*")) if (el.scrollTop) el.scrollTop = 0; }).catch(() => {});
            const more = page.getByRole("button", { name: /^(More|Lainnya)$/ }).first();
            if (await more.isVisible().catch(() => false)) {
              await more.click().catch(() => {});
              const sheet = page.getByRole("dialog", { name: /More navigation|Navigasi lainnya/ }).first();
              if (await sheet.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
                await page.waitForTimeout(700);
                if (await sheet.locator('a[href="/legal"]').count()) problems.push("Legal menu item is in More");
                await page.screenshot({ path: path.join(dir, `${s.id}-${Math.max(pages, 1) + 1}.png`) }).catch(() => {});
                await page.keyboard.press("Escape").catch(() => {});
              } else {
                problems.push("More sheet did not open (mobile menu not checked)");
              }
            } else {
              problems.push("More button not found (mobile menu not checked)");
            }
          }
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => null);
          const status = problems.length ? `FAILED (${NONMEMBER_EMAIL}): ${problems.join("; ")}` : `ok (${NONMEMBER_EMAIL}: no Legal menu, invitation-only state)`;
          results.push({ variant: variant.dir, id: s.id, status, pages, seconds: (Date.now() - started) / 1000, horizontalOverflowPx: overflow, pageErrors: [...errors] });
          console.log(`${variant.dir} ${s.id}: ${status}`);
        }
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await session.end();
  }
}

async function main() {
  if (!PASSWORD) throw new Error("TOUR_PASSWORD is not set (ui-tour.sh reads it from the Keychain)");
  if (screens.length === 0) {
    console.log("web: no screens selected");
    return;
  }
  while (memAvailableMB() < 3000) {
    console.log(`web: only ${memAvailableMB()} MB RAM available (< 3000), waiting 60 s`);
    await new Promise((r) => setTimeout(r, 60000));
  }
  const results = [];
  // On a Mac with Google Chrome installed, drive that Chrome: Playwright's own Chromium download can hang
  // while unpacking (owner's Mac, 13 Oct 2026). Elsewhere (Linux) use Playwright's Chromium as before.
  const useChrome = process.platform === "darwin" && existsSync("/Applications/Google Chrome.app");
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"], ...(useChrome ? { channel: "chrome" } : {}),
    // TOUR_WATCH=1 (ui-tour.sh --watch): a visible Chrome window, so the owner can follow the web half.
    headless: !process.env.TOUR_WATCH, ...(process.env.TOUR_WATCH ? { slowMo: 150 } : {}) });
  try {
    const state = await signIn(browser);
    const legal = await legalValues(browser, state);
    for (const [name, variant] of Object.entries(VARIANTS)) {
      if (!WANT.has(name)) continue;
      const dir = path.join(OUT, variant.dir);
      fs.mkdirSync(dir, { recursive: true });
      // Two contexts at most: the signed-in one, and a signed-out one only for the login screen.
      for (const signedOut of [true, false]) {
        const list = memberScreens.filter((s) => (s.id === "login") === signedOut);
        if (list.length === 0) continue;
        const ctx = await browser.newContext({
          ...variant.context,
          ignoreHTTPSErrors: true,
          storageState: signedOut ? undefined : state,
          timezoneId: "Asia/Jakarta",
          locale: LANG === "id" ? "id-ID" : "en-US",
          colorScheme: "light",
        });
        try {
          await prepare(ctx);
          const page = await ctx.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
          for (const s of list) {
            const started = Date.now();
            errors.length = 0;
            let status = "ok";
            const target = resolveWeb(s, legal);
            if (target.skip) {
              results.push({ variant: variant.dir, id: s.id, status: `skipped: ${target.skip}`, seconds: 0, horizontalOverflowPx: null, pageErrors: [] });
              console.log(`${variant.dir} ${s.id}: skipped: ${target.skip}`);
              continue;
            }
            try {
              await page.goto(BASE + target.web, { waitUntil: "domcontentloaded", timeout: 45000 });
              const quiet = await settle(page);
              if (!quiet) status = "ok, spinner still visible after 12 s";
              if (!signedOut && new URL(page.url()).pathname.startsWith("/login")) status = "bounced to /login (session lost)";
              // The QA account is a Legal root on dev: the invitation-only state here means it lost that.
              else if (s.id.startsWith("legal-") && await page.getByText(/Legal is by invitation only|Legal hanya untuk yang diundang/).first().isVisible().catch(() => false)) {
                status = `wrong-screen: ${EMAIL} is not invited to Legal`;
              } else if (s.id === "legal-request-form" && legal.legalForm?.note) status = `ok, ${legal.legalForm.note}`;
            } catch (e) {
              status = `error: ${String(e.message || e).split("\n")[0]}`;
            }
            let pages = 0;
            try {
              pages = (await capture(page, dir, s.id)).pages;
            } catch (e) {
              status = `no screenshot: ${e.message}`;
            }
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => null);
            results.push({ variant: variant.dir, id: s.id, status, pages, seconds: (Date.now() - started) / 1000, horizontalOverflowPx: overflow, pageErrors: [...errors] });
            console.log(`${variant.dir} ${s.id}: ${status}`);
          }
        } finally {
          await ctx.close();
        }
      }
    }
    await nonmemberTour(browser, results);
  } finally {
    await browser.close();
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "web-results.json"), JSON.stringify(results, null, 2));
  }
}

main().catch((e) => {
  console.error(`web tour failed: ${e.message || e}`);
  process.exit(1);
});
