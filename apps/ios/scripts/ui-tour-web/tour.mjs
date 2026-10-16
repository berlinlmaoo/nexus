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
//   TOUR_OUTLET_PROJECT_ID / TOUR_SOCMED_PROJECT_ID   optional: the Outlet Sales / Social Media Report project to
//                                show instead of looking it up by name and type (dashboardValues)
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
const BASE = (opt("base", process.env.TOUR_WEB_BASE || "")).replace(/\/$/, "");
if (!BASE) throw new Error("set TOUR_WEB_BASE or --base (the dev server URL)");
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
/** The least a scroll step must move (fraction of the viewport) to be worth a page of its own. */
const MIN_PAGE_STEP = Number(process.env.TOUR_MIN_PAGE_STEP) || 0.5;
/**
 * A shorter last step still gets one final "scrolled to the bottom" page when it moved at least this much
 * (run 14 tooling note: dashboard-2, project-overview-3, leaderboard-4, project-timeline-5 and
 * settings-security-6 on web-mobile stopped before the true end, so content under the tab bar could not be
 * checked). Less than this is the near-duplicate W-M24 was about (50-77 px) and ends the paging unshot.
 */
const MIN_LAST_STEP = Number(process.env.TOUR_MIN_LAST_STEP) || 0.15;

/**
 * The screenshot(s) of one screen: `<id>.png`, then `<id>-2.png` … like the app tour (TOUR_MAX_PAGES, default 6).
 * Not a full-page document screenshot (run 10): Chrome draws that beyond the viewport without resizing it, so
 * fixed parts stay where the viewport was (the mobile bottom nav floated mid-page), and on app-shell pages
 * (a 100vh shell whose content scrolls inside) the shot got the document's empty tail (Calendar desktop:
 * ~900 px of blank) while the inner scrollers stayed cut at the viewport (the Calendar's right rail). So:
 * viewport-sized shots; between them every scroller on screen (the document, and each inner content scroll
 * area that covers at least a fifth of the viewport, not the navigation) moves on by 85% of its height, but never past its last
 * visible content, so an empty tail is not photographed. Stops when nothing moves any more.
 * With a drawer, sheet or dialog open, only the scrollers inside the topmost one move (run 11: on web
 * `legal-document-2..4` the archive list scrolled behind the document drawer, which stayed put).
 */
async function capture(page, dir, id) {
  // The pointer off the content before every shot (run 20 tour request 2: the first leaderboard row was grey
  // from the pointer's hover on wd leaderboard-2…4, "Hosting Team" outlined on wd outlet-settings-2).
  const shot = async (n) => {
    await page.mouse.move(0, 0).catch(() => {});
    await page.waitForTimeout(150);
    return page.screenshot({ path: path.join(dir, n === 1 ? `${id}.png` : `${id}-${n}.png`) });
  };
  for (const f of fs.readdirSync(dir)) if (f.startsWith(`${id}-`) && /^-\d+\.png$/.test(f.slice(id.length))) fs.rmSync(path.join(dir, f));
  const step = () => page.evaluate((MIN_LAST_STEP_IN) => {
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
    // The topmost open overlay (a drawer, sheet or modal dialog) that is on screen: what the person looks at.
    const overlays = [...document.querySelectorAll("[role='dialog'], [aria-modal='true'], [data-sheet-panel], [data-vaul-drawer]")].filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    });
    const overlay = overlays[overlays.length - 1] ?? null;
    // How far the furthest-moving scroller went, as a fraction of its own height; `snapped`: a scroller came
    // to rest on its last snap point short of its end, which is then the last page.
    // `fresh`: how much of the VIEWPORT is new, each scroller's move weighted by the share of the viewport it
    // covers (run 20 tour request 1: wd / wm project-table-5 and wm project-board-3 were taken although only an
    // inner scroller had moved a little, so they repeated most of the page before). The document counts whole.
    // `moved` (the furthest-moving scroller) still decides whether paging goes on.
    let moved = 0;
    let fresh = 0;
    let snapped = false;
    let more = false;   // a scroller that still has a page to go after this step
    for (const [s, bottom] of end) {
      if (overlay && (s === doc || !overlay.contains(s))) continue;
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
      let target = Math.min(limit, before + Math.round(height * 0.85));
      let snappedHere = false;
      // Snap points of this scroller: the top of every [data-snap-row], [data-snap-rows] > * and [data-snap-top]
      // whose nearest scroll container it is, less scroll-padding-top and the element's scroll-margin-top.
      const padEl = s === doc ? document.documentElement : s;
      const pad = parseFloat(getComputedStyle(padEl).scrollPaddingTop) || 0;
      const top0 = s === doc ? 0 : s.getBoundingClientRect().top;
      const snaps = [];
      for (const el of s.querySelectorAll("[data-snap-row], [data-snap-rows] > *, [data-snap-top]")) {
        const r = el.getBoundingClientRect();
        if (!r.height) continue;
        let owner = doc;
        for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
          if (a === s || /(auto|scroll|hidden)/.test(getComputedStyle(a).overflowY)) { owner = a; break; }
        }
        if (owner !== s) continue;
        const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
        snaps.push(Math.floor((s === doc ? r.top + scrollY : r.top - top0 + s.scrollTop) - pad - margin));
      }
      const realMax = s === doc ? doc.scrollHeight - vh : s.scrollHeight - s.clientHeight;
      // A middle page rests on the furthest snap point in the last stretch of its step (run 18, R18-WB-1: Chrome's
      // proximity snap does not pull a page that lands ~100 px from one, so wm attendance-2 began mid-card). Only
      // from 0.7 of a page, so a screen at the page cap reaches about as far as before.
      if (target < limit) {
        const lo = before + height * 0.7;
        const mid = snaps.filter((at) => at > lo && at <= target);
        if (mid.length) target = Math.max(...mid);
      }
      // The last step: pinned at the scroller's end the browser cannot snap, so the page started on a half
      // row (run 17, R17-WB-1: wm tickets-2, wd/wm outlet-day-2, wm socmed-day-2, wd project-overview-2).
      // Rest on the last snap point (the web's [data-snap-row], [data-snap-rows] > *, [data-snap-top], less
      // scroll-padding-top) at or above the end instead, but only when nothing is lost: what that page no
      // longer reaches at the bottom must already be on the page before, and the step must still be worth a
      // page (MIN_LAST_STEP). Otherwise the end, as before.
      if (target === limit) {
        // Run 18 (R18-WB-1): the first snap point whose page still reaches the content's end, up to how far
        // the scroller REALLY scrolls (the web's end room after the last row, SnapTail, included), not only up
        // to `limit`. Then the last page starts on a whole row and loses nothing; without end room this is the
        // run 17 rule (a snap point within the 16 px end padding).
        let snap = -1;
        for (const at of snaps) {
          // Nothing lost: the snapped page still reaches the content's end.
          if (at + height < bottom - 1 || at > Math.max(limit, realMax) || at <= before) continue;
          if (snap < 0 || at < snap) snap = at;
        }
        if (snap >= 0 && (snap - before) / height >= MIN_LAST_STEP_IN) {
          target = snap;
          snapped = snappedHere = true;
        } else if (realMax > limit && realMax - limit <= height * 0.25) {
          // No snap point there: the real end, which the end room makes a whole-row stop (the Legal drawer's
          // 24 px after its tail left `limit` 8 px short). A long empty tail (an app shell) stays unshot.
          target = realMax;
        }
      }
      if (target < limit && !snappedHere) more = true;
      s.scrollTop = target;
      let share = 1;
      if (s !== doc) {
        const r = s.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        share = Math.min(1, (w * h) / (vw * vh));
      }
      if (s.scrollTop > before + 1) {
        moved = Math.max(moved, (s.scrollTop - before) / height);
        fresh = Math.min(1, fresh + ((s.scrollTop - before) / height) * share);
      }
    }
    return { moved, fresh, snapped: snapped && !more };
  }, MIN_LAST_STEP).catch(() => ({ moved: 0, fresh: 0, snapped: false }));
  await shot(1);
  let pages = 1;
  // A step that moved less than half a viewport shows mostly the previous page again (UI tour run 13, W-M24:
  // dashboard-3 and projects-2 were 50-77 px further down), so the paging ends there; but when it still
  // reached a real part of the page (MIN_LAST_STEP), that end is shot once as the last page.
  while (pages < MAX_PAGES) {
    const { moved, fresh, snapped } = await step();
    if (moved < MIN_LAST_STEP || fresh < MIN_LAST_STEP) break;
    await page.waitForTimeout(700);
    pages += 1;
    await shot(pages);
    // A page resting on its last snap point shows everything not yet seen: it is the last one.
    if (moved < MIN_PAGE_STEP || snapped) break;
  }
  // Run 20 tour request 4: a content scroller inside the page (the Table's rows above its Calculate footer, the
  // Timeline's late rows) that is still short of its end when the paging stops is brought to its end once and
  // shot, so its last rows are seen. Only scrollers of a fifth of the viewport or more, not the navigation, and
  // only when that end shows at least MIN_LAST_STEP of the viewport as new.
  const tail = await page.evaluate((MIN_LAST_STEP_IN) => {
    const vw = innerWidth, vh = innerHeight;
    let any = false;
    for (const el of document.body.querySelectorAll("*")) {
      if (el.scrollHeight <= el.clientHeight + 4 || el.clientHeight < 120) continue;
      if (!/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY)) continue;
      if (el.closest("nav, [role='navigation'], [data-sidebar]")) continue;
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (w * h < vw * vh * 0.2) continue;
      const max = el.scrollHeight - el.clientHeight;
      // What the end brings in, as a share of the VIEWPORT (as `fresh` in the paging): no near-duplicate page.
      if (Math.min(1, (max - el.scrollTop) / el.clientHeight) * ((w * h) / (vw * vh)) < MIN_LAST_STEP_IN) continue;
      el.scrollTop = max;
      any = true;
    }
    return any;
  }, MIN_LAST_STEP).catch(() => false);
  if (tail && pages < MAX_PAGES + 1) {
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

/** "YYYY-MM" of the month before `month`. */
function monthBefore(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * The run-time values of the dashboard screens (14 Oct 2026), read with the QA session (GET only):
 * `{outlet}` / `{socmed}` = the QA Outlet Sales / Social Media Report project (by name, else the first "ZZ QA"
 * project of that type; TOUR_OUTLET_PROJECT_ID / TOUR_SOCMED_PROJECT_ID win), `{outletDay}` = a day other than
 * today (the newest night waiting for its report, else reported, else with its own daily target), `{socmedDay}` = the newest date up to today with
 * figures; this month, else the month before. Missing = `{ skip: "<reason>" }`, like the Legal values.
 */
async function dashboardValues(browser, state) {
  const values = {};
  const wanted = (key) => memberScreens.some((s) => s.web.includes(`{${key}`));
  if (!wanted("outlet") && !wanted("socmed")) return values;
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, storageState: state });
  const get = async (p) => {
    const r = await ctx.request.get(BASE + p, { timeout: 30000 });
    if (!r.ok()) throw new Error(`HTTP ${r.status()} from ${p.split("?")[0]}`);
    return r.json();
  };
  const kinds = [
    { key: "outlet", env: "TOUR_OUTLET_PROJECT_ID", type: "OUTLET_SALES", name: "ZZ QA Manager Outlet", api: "outlet-sales",
      // A day other than today: the calendar opens with today picked and its panel already shown, so a shot
      // of today repeated outlet-calendar (run 14 tooling note / P-T1). The newest night waiting for its
      // report, else the newest reported one, else a day with its own target, else any event day.
      day: (d) => {
        const today = String(d.today || new Date(Date.now() + 7 * 3600e3).toISOString()).slice(0, 10); // WIB day without a server `today`
        const day = (x) => String(x || "").slice(0, 10);
        const events = d.events || [];
        const of = (status) => events.filter((e) => !status || e.status === status).map((e) => day(e.date)).filter((x) => x && x !== today);
        const targets = (d.dayTargets || []).map((t) => day(t.date)).filter((x) => x && x !== today);
        const pick = [of("WAITING_REPORT"), of("REPORTED"), targets, of(null)].find((l) => l.length);
        return pick ? pick.sort().pop() : null;
      } },
    { key: "socmed", env: "TOUR_SOCMED_PROJECT_ID", type: "SOCIAL_MEDIA_REPORT", name: "ZZ QA Social Media Report", api: "social-media",
      day: (d) => (d.days || [])
        .filter((x) => x.date <= d.today && Object.values(x.platforms || {}).some((p) =>
          ["views", "likes", "comments", "shares", "posts"].some((k) => Number(p?.[k]) > 0)))
        .map((x) => x.date).sort().pop() || null },
  ];
  try {
    let projects = null;
    for (const k of kinds) {
      if (!wanted(k.key)) continue;
      const dayKey = `${k.key}Day`;
      let id = process.env[k.env] || null;
      try {
        if (!id) {
          projects ??= await get("/api/projects");
          const list = Array.isArray(projects) ? projects : projects.projects || [];
          const hit = list.find((p) => p.name === k.name && p.type === k.type)
            || list.find((p) => p.type === k.type && String(p.name || "").startsWith("ZZ QA"));
          id = hit?.id || null;
        }
      } catch (e) {
        values[k.key] = values[dayKey] = { skip: `projects not readable (${e.message})` };
        continue;
      }
      if (!id) {
        values[k.key] = values[dayKey] = { skip: `no ${k.type} project "${k.name}" for ${EMAIL} (set ${k.env})` };
        continue;
      }
      values[k.key] = { value: id };
      if (!wanted(dayKey)) continue;
      try {
        let month = null, day = null;
        for (let i = 0; i < 2 && !day; i++) {
          const data = await get(`/api/projects/${encodeURIComponent(id)}/${k.api}${month ? `?month=${month}` : ""}`);
          day = k.day(data);
          month = monthBefore(data.month);
        }
        values[dayKey] = day ? { value: day } : { skip: `no ${k.key === "outlet" ? "reported night or daily target" : "day with figures"} this month or last` };
      } catch (e) {
        values[dayKey] = { skip: `${k.api} not readable (${e.message})` };
      }
    }
  } finally {
    await ctx.close();
  }
  for (const [k, v] of Object.entries(values)) console.log(`dashboard ${k}: ${v.skip ? `skipped: ${v.skip}` : v.value}`);
  return values;
}

/**
 * The buttons a screen's `webTaps` names, pressed in order once it settled (a settings sheet, the template
 * gallery's Dashboards tab): "A|B" = the English or the Indonesian label, a leading "?" = only when the next
 * step's button is not on screen yet. nil when done, else what went wrong. Opening a sheet writes nothing.
 */
async function pressSteps(page, steps) {
  const find = (step) => {
    const names = step.replace(/^\?/, "").split("|");
    const re = new RegExp(`^(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);
    return page.getByRole("button", { name: re }).or(page.getByRole("tab", { name: re }))
      .filter({ visible: true }).first();
  };
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.startsWith("?")) {
      if (i + 1 < steps.length && (await find(steps[i + 1]).isVisible().catch(() => false))) continue;
      if (!(await find(step).isVisible().catch(() => false))) continue;
    }
    const target = find(step);
    if (!(await target.waitFor({ state: "visible", timeout: 10000 }).then(() => true, () => false))) {
      return `no "${step.replace(/^\?/, "").split("|")[0]}" button`;
    }
    await target.click({ timeout: 10000 });
    await settle(page);
    await page.waitForTimeout(600);
  }
  return null;
}

/** `s.web` with the run-time values filled in, or `{ skip }` when one of them is missing. */
function resolveWeb(s, legal) {
  let web = s.web;
  for (const key of Object.keys(legal)) {
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
    const legal = { ...(await legalValues(browser, state)), ...(await dashboardValues(browser, state)) };
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
            if (s.webVariants && !s.webVariants.includes(name)) continue;
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
              if (!status.startsWith("bounced") && s.webTaps?.length) {
                const problem = await pressSteps(page, s.webTaps);
                if (problem) status = `wrong-screen: ${s.id} (${problem})`;
              }
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
            // Undo what the screen changed for the ones after it (the collapsed sidebar is kept in a cookie).
            if (s.webAfterTaps?.length) {
              const problem = await pressSteps(page, s.webAfterTaps).catch((e) => String(e.message || e));
              if (problem) console.log(`${variant.dir} ${s.id}: after-steps: ${problem}`);
            }
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
