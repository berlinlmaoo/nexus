#!/usr/bin/env node
// Web half of the NEXUS UI screenshot tour (../ui-tour.sh, docs/UI-TOUR.md).
//
// Photographs every screen in ../ui-tour-screens.json on the DEV web twice: desktop 1440x900 (the master
// reference) and mobile 440x956 @3x (iPhone 17 Pro Max). Signs in ONCE with the QA account and reuses
// that session for both. One Chromium, closed in `finally`.
//
// Read-only on purpose: every non-GET /api call except sign-in and realtime plumbing is answered 503 by
// this script, so opening a screen can never mark, save or send anything for the QA account.
//
//   TOUR_EMAIL / TOUR_PASSWORD   the QA account (ui-tour.sh reads them from the macOS Keychain)
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

const config = JSON.parse(fs.readFileSync(path.join(HERE, "..", "ui-tour-screens.json"), "utf8"));
const projectId = process.env.TOUR_PROJECT_ID || config.projectId;
const formId = process.env.TOUR_FORM_ID || config.formId;
const screens = config.screens
  .filter((s) => s.web && (ONLY.size === 0 || ONLY.has(s.id)))
  .map((s) => ({ ...s, web: s.web.replaceAll("{project}", projectId).replaceAll("{form}", formId) }));

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
  await page.waitForTimeout(800);
  return quiet >= 3;
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
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  try {
    const state = await signIn(browser);
    for (const [name, variant] of Object.entries(VARIANTS)) {
      if (!WANT.has(name)) continue;
      const dir = path.join(OUT, variant.dir);
      fs.mkdirSync(dir, { recursive: true });
      // Two contexts at most: the signed-in one, and a signed-out one only for the login screen.
      for (const signedOut of [true, false]) {
        const list = screens.filter((s) => (s.id === "login") === signedOut);
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
            try {
              await page.goto(BASE + s.web, { waitUntil: "domcontentloaded", timeout: 45000 });
              const quiet = await settle(page);
              if (!quiet) status = "ok, spinner still visible after 12 s";
              if (!signedOut && new URL(page.url()).pathname.startsWith("/login")) status = "bounced to /login (session lost)";
            } catch (e) {
              status = `error: ${String(e.message || e).split("\n")[0]}`;
            }
            await page.screenshot({ path: path.join(dir, `${s.id}.png`) }).catch((e) => { status = `no screenshot: ${e.message}`; });
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => null);
            results.push({ variant: variant.dir, id: s.id, status, seconds: (Date.now() - started) / 1000, horizontalOverflowPx: overflow, pageErrors: [...errors] });
            console.log(`${variant.dir} ${s.id}: ${status}`);
          }
        } finally {
          await ctx.close();
        }
      }
    }
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
