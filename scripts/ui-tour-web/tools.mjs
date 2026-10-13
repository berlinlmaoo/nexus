#!/usr/bin/env node
// Helpers for ../ui-tour.sh (docs/UI-TOUR.md). Node instead of bash because they all read JSON.
//
//   node tools.mjs pick-sim iphone|ipad          → "<udid>\t<name (runtime)>\t<note>"
//   node tools.mjs extract <exportDir> <destDir> [prefix] → copies <prefix><id>.png/.txt/.json (prefix
//                                                   "tour-" = app, "safari-" = Safari) out of an
//                                                   `xcresulttool export attachments` folder
//   node tools.mjs check-login                   → POSTs the QA account to the DEV server once
//   node tools.mjs index <outDir>                → writes <outDir>/index.html
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [cmd, ...rest] = process.argv.slice(2);
const BASE = (process.env.TOUR_WEB_BASE || "https://nexus-prod.tail765d02.ts.net:8443").replace(/\/$/, "");

// ---------------------------------------------------------------------------------------------- pick-sim
function pickSim(kind) {
  const list = JSON.parse(execFileSync("xcrun", ["simctl", "list", "-j"], { encoding: "utf8", maxBuffer: 64 << 20 }));
  const family = kind === "ipad" ? "iPad" : "iPhone";
  const preferred = kind === "ipad"
    ? ["iPad Pro 13-inch (M5)", "iPad Pro 13-inch (M4)", "iPad Pro (12.9-inch) (6th generation)"]
    : ["iPhone 17 Pro Max"];
  const version = (r) => (r.version || "0").split(".").map(Number);
  const newer = (a, b) => { const x = version(a), y = version(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; };
  const runtimes = (list.runtimes || [])
    .filter((r) => r.isAvailable !== false && (r.platform === "iOS" || /iOS/.test(r.identifier || "")))
    .sort(newer);
  if (runtimes.length === 0) throw new Error("no iOS simulator runtime installed (Xcode → Settings → Components)");
  const types = list.devicetypes || [];
  const typesFor = (r) => (r.supportedDeviceTypes && r.supportedDeviceTypes.length ? r.supportedDeviceTypes : types);
  const devicesFor = (r) => (list.devices?.[r.identifier] || []).filter((d) => d.isAvailable !== false);
  const use = (r, name, note) => {
    const existing = devicesFor(r).filter((d) => d.name === name).sort((a, b) => (b.state === "Booted") - (a.state === "Booted"))[0];
    if (existing) return `${existing.udid}\t${name} (${r.name})\t${note}`;
    const type = typesFor(r).find((t) => t.name === name);
    if (!type) return null;
    const udid = execFileSync("xcrun", ["simctl", "create", name, type.identifier, r.identifier], { encoding: "utf8" }).trim();
    return `${udid}\t${name} (${r.name})\t${note ? note + ", " : ""}created`;
  };
  for (const name of preferred) {
    for (const r of runtimes) {
      const hit = use(r, name, "");
      if (hit) return hit;
    }
  }
  // Fallback: the largest device of that family on the newest runtime.
  const score = (n) => {
    let s = 1;
    if (family === "iPhone") s = /Pro Max/.test(n) ? 5 : /Plus|Max/.test(n) ? 4 : /Air/.test(n) ? 3 : /Pro/.test(n) ? 2 : 1;
    else s = /iPad Pro/.test(n) && /13|12\.9/.test(n) ? 5 : /iPad Pro/.test(n) ? 4 : /Air/.test(n) && /13/.test(n) ? 3 : /Air/.test(n) ? 2 : 1;
    const num = Number((n.match(/(\d+)/) || [0, 0])[1]);
    return s * 1000 + num;
  };
  for (const r of runtimes) {
    const names = typesFor(r).map((t) => t.name).filter((n) => n.startsWith(family) && !/mini/i.test(n));
    names.sort((a, b) => score(b) - score(a));
    for (const n of names) {
      const hit = use(r, n, `FALLBACK: ${preferred[0]} not available`);
      if (hit) return hit;
    }
  }
  throw new Error(`no ${family} simulator could be found or created`);
}

// ----------------------------------------------------------------------------------------------- extract
function extract(exportDir, destDir, prefix = "tour-") {
  fs.mkdirSync(destDir, { recursive: true });
  const found = [];
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${esc}(.+?)(?:_\\d+_[0-9A-Fa-f-]{36})?\\.(png|jpe?g|heic|txt|json)$`);
  const take = (file, human) => {
    const m = (human || "").match(pattern) || path.basename(file).match(pattern);
    if (!m) return;
    const ext = m[2] === "jpeg" ? "jpg" : m[2];
    const target = path.join(destDir, `${m[1]}.${ext}`);
    fs.copyFileSync(file, target);
    found.push(path.basename(target));
  };
  const manifestPath = path.join(exportDir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    // The manifest's exact shape has moved between Xcode versions: walk it for anything that names a file.
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      if (node.exportedFileName) {
        const file = path.join(exportDir, node.exportedFileName);
        if (fs.existsSync(file)) take(file, node.suggestedHumanReadableName || node.name || "");
      }
      Object.values(node).forEach(walk);
    };
    walk(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  } else {
    for (const f of fs.readdirSync(exportDir)) take(path.join(exportDir, f), f);
  }
  console.log(`${found.filter((f) => f.endsWith(".png") || f.endsWith(".jpg")).length} screenshots`);
}

// ------------------------------------------------------------------------------------------- check-login
async function checkLogin() {
  const email = process.env.TOUR_EMAIL || "qa5@dev.invalid";
  const password = process.env.TOUR_PASSWORD || "";
  try {
    const r = await fetch(`${BASE}/api/auth/app-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(20000),
    });
    if (r.status === 200) { console.log(`ok: ${email} can sign in to ${BASE}`); return; }
    console.log(`refused: HTTP ${r.status} from ${BASE} (${r.status === 401 ? "wrong QA password? run: scripts/ui-tour.sh --set-password" : "server problem"})`);
    process.exit(3);
  } catch (e) {
    const cause = e.cause ? ` (${e.cause.code || ""} ${e.cause.message || ""})` : "";
    console.log(`unreachable: ${BASE} — ${e.name}: ${e.message}${cause}. Is Tailscale on?`);
    process.exit(4);
  }
}

// ------------------------------------------------------------------------------------------------- index
function index(outDir) {
  const config = JSON.parse(fs.readFileSync(new URL("../ui-tour-screens.json", import.meta.url), "utf8"));
  const columns = [
    ["web-desktop", "Web desktop 1440×900 (reference)"],
    ["web-mobile", "Web mobile"],
    ["iphone", "iPhone app"],
    ["ipad", "iPad app"],
    ["mac", "Mac app"],
  ].filter(([dir]) => fs.existsSync(path.join(outDir, dir)));
  const meta = {};
  const metaFile = path.join(outDir, "meta.txt");
  if (fs.existsSync(metaFile)) {
    for (const line of fs.readFileSync(metaFile, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) meta[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  const status = {};
  const note = (dir, id, s) => { if (s && s !== "ok") (status[`${dir}/${id}`] = s); };
  try { for (const r of JSON.parse(fs.readFileSync(path.join(outDir, "web-results.json"), "utf8"))) note(r.variant, r.id, r.status + (r.horizontalOverflowPx > 0 ? `; scrolls sideways ${r.horizontalOverflowPx}px` : "")); } catch {}
  for (const dir of ["web-mobile", "iphone", "ipad", "mac"]) {
    try { for (const r of JSON.parse(fs.readFileSync(path.join(outDir, dir, "results.json"), "utf8"))) note(dir, r.id, r.status); } catch {}
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const ids = config.screens.map((s) => [s.id, s.title]);
  const extra = [];
  for (const [dir] of columns) {
    if (fs.existsSync(path.join(outDir, dir, "login-error.png")) && !extra.length) extra.push(["login-error", "Login error"]);
  }
  const rows = [...extra, ...ids]
    .filter(([id]) => columns.some(([dir]) => fs.existsSync(path.join(outDir, dir, `${id}.png`))))
    .map(([id, title]) => {
      const cells = columns.map(([dir]) => {
        const file = `${dir}/${id}.png`;
        const txt = path.join(outDir, dir, `${id}.txt`);
        const s = status[`${dir}/${id}`];
        // Every page of the screen, top to bottom: <id>.png, then <id>-2.png, <id>-3.png … (scrolled shots).
        const pages = fs.existsSync(path.join(outDir, file)) ? [file] : [];
        const more = fs.existsSync(path.join(outDir, dir))
          ? fs.readdirSync(path.join(outDir, dir))
              .map((f) => [f, (f.match(new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.png$`)) || [])[1]])
              .filter(([, n]) => n)
              .sort((a, b) => Number(a[1]) - Number(b[1]))
              .map(([f]) => `${dir}/${f}`)
          : [];
        pages.push(...more);
        const body = pages.length
          ? pages.map((f, i) => `<a href="${f}" target="_blank"><img loading="lazy" src="${f}" alt="${esc(id)} ${dir} page ${i + 1}"></a>`).join("")
            + (pages.length > 1 ? `<small>${pages.length} pages</small>` : "")
          : `<div class="none">—</div>`;
        const extraText = fs.existsSync(txt) ? `<pre>${esc(fs.readFileSync(txt, "utf8"))}</pre>` : "";
        const cls = s && /^(wrong-screen|timeout|no-session|bounced|error)/.test(s) ? "bad" : "warn";
        return `<td>${s ? `<div class="${cls}">${esc(s)}</div>` : ""}${body}${extraText}</td>`;
      }).join("");
      return `<tr id="${esc(id)}"><th><a href="#${esc(id)}">${esc(title)}</a><small>${esc(id)}</small></th>${cells}</tr>`;
    }).join("\n");
  const head = columns.map(([dir, label]) => `<th>${esc(label)}${meta[dir] ? `<small>${esc(meta[dir])}</small>` : ""}</th>`).join("");
  const loginError = ["web-mobile", "iphone", "ipad", "mac"].map((d) => path.join(outDir, d, "login-error.txt")).filter((f) => fs.existsSync(f))
    .map((f) => `<div class="err"><b>${esc(path.basename(path.dirname(f)))} sign-in failed:</b> ${esc(fs.readFileSync(f, "utf8"))}</div>`).join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NEXUS UI Tour</title>
<style>
:root{--bg:#f8f9fb;--fg:#15171c;--muted:#6b7280;--line:#e5e7eb;--card:#fff;--warn:#b45309;--err:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#11141b;--fg:#e5e7eb;--muted:#9ca3af;--line:#262b36;--card:#181c25;--warn:#f59e0b;--err:#f87171}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{padding:20px 16px 8px}h1{margin:0 0 4px;font-size:22px}header p{margin:0;color:var(--muted)}
.wrap{overflow-x:auto;padding:8px 16px 40px}table{border-collapse:separate;border-spacing:0 12px;min-width:1400px}
thead th{position:sticky;top:0;background:var(--bg);text-align:left;padding:6px 10px;font-size:13px;z-index:1}
th small,td small{display:block;color:var(--muted);font-weight:400;font-size:12px}
tbody th{vertical-align:top;text-align:left;width:150px;padding:10px;font-size:14px}tbody th a{color:inherit;text-decoration:none}
td{vertical-align:top;padding:0 10px;background:var(--card);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
td img{display:block;max-width:100%;margin:10px 0;border:1px solid var(--line);border-radius:6px}
td img{max-height:none}td:nth-of-type(1) img{max-width:520px}td:nth-of-type(2) img,td:nth-of-type(3) img{max-width:260px}
.none{color:var(--muted);padding:20px 0}.bad{color:#fff;background:var(--err);font-weight:600;font-size:12px;padding:4px 8px;border-radius:6px;margin-top:10px}.warn{color:var(--warn);font-size:12px;margin-bottom:8px}
.err{margin:8px 16px;padding:10px 12px;border:1px solid var(--err);color:var(--err);border-radius:8px;background:var(--card)}
pre{white-space:pre-wrap;font-size:12px;color:var(--err)}
</style></head><body>
<header><h1>NEXUS UI tour</h1><p>${esc(meta.stamp || "")} · commit ${esc(meta.commit || "?")} · ${esc(meta.server || BASE)} · ${esc(meta.account || "")}</p></header>
${loginError}
<div class="wrap"><table><thead><tr><th>Screen</th>${head}</tr></thead><tbody>
${rows}
</tbody></table></div></body></html>
`;
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  console.log(path.join(outDir, "index.html"));
}

try {
  if (cmd === "pick-sim") console.log(pickSim(rest[0] || "iphone"));
  else if (cmd === "extract") extract(rest[0], rest[1], rest[2] || "tour-");
  else if (cmd === "check-login") await checkLogin();
  else if (cmd === "index") index(rest[0]);
  else { console.error("usage: tools.mjs pick-sim|extract|check-login|index …"); process.exit(2); }
} catch (e) {
  console.error(`tools ${cmd}: ${e.message || e}`);
  process.exit(1);
}
