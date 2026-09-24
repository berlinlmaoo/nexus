// node src/lib/permit-reason-guard.test.mjs
//
// Plain node, no test runner. Loads permit-reason-guard.ts directly when this node can strip types
// (23.6+, or 22 with --experimental-strip-types), otherwise transpiles it with the repo's own
// `typescript` package — so it runs on the host, in the app container and on a laptop alike.
//
// The cases come from the 348 real izin in production up to 24 Sep 2026. Positives are the ones that
// were a day off or a missed check-in in disguise; negatives are the work izin the owner wants kept,
// chosen for being the ones a careless pattern would catch.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"

const here = path.dirname(fileURLToPath(import.meta.url))
const tsPath = path.join(here, "permit-reason-guard.ts")

async function load() {
  try {
    return await import(pathToFileURL(tsPath).href)
  } catch {
    const require = createRequire(import.meta.url)
    const ts = require("typescript")
    const src = await readFile(tsPath, "utf8")
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    return await import("data:text/javascript;base64," + Buffer.from(out).toString("base64"))
  }
}

const { classifyPermitReason, normalizePermitReason } = await load()

const cases = [
  // ── day off in disguise ──
  ["Ambil day off izin", "dayoff"],
  ["Izin ambil day off karena di system day off nya sdh terpotong 🙏", "dayoff"],
  ["Tuker do tgl 24", "dayoff"],
  ["Seharusnya do, tp krn sistemnya error jd gabisa request do, udh lapor bagas juga tp blm.di benerin", "dayoff"],
  ["Seharusnya, do, tp gabisa do krn sistemnya error huhu", "dayoff"],
  ["permit ambil DO, jatah do nya belum dirubah dari tang pas sakit🙏🏼", "dayoff"],
  ["mau ambil day off tapi gabisa karna yg kemarin sakit belum dirubah jadi sick", "dayoff"],
  ["Weekend, udh gabisa nganbil day-off karena kepotong mulu pas gua kuliah", "dayoff"],
  ["gantiin day off yg kepotong ya, itu telat absen soalnya", "dayoff"],
  ["day off", "dayoff"],
  ["DAYOFF", "dayoff"],
  ["Dayy off twizzound", "dayoff"],
  ["libur ya bang udah ijin sama dava dan mimiw", "dayoff"],
  ["cuti dulu ya", "dayoff"],
  ["off dulu hari ini", "dayoff"],
  ["jatah day off aku udah abis", "dayoff"],
  ["d.o tanggal 3", "dayoff"],
  ["ganti DO kemarin", "dayoff"],
  ["mau istirahat di rumah", "dayoff"],
  // ── missed check-in ──
  ["lupa absen sir", "forgot_checkin"],
  ["gua lupa absen sir", "forgot_checkin"],
  ["ngurus bola lupa absen kink", "forgot_checkin"],
  ["sumpah lupa absen sir", "forgot_checkin"],
  ["lupa absen sumpah. hari ini masuk jam 15.30", "forgot_checkin"],
  ["LUPAAA CHECK-IN", "forgot_checkin"],
  ["lupa checkin tadi pagi", "forgot_checkin"],
  ["lupa clock in", "forgot_checkin"],
  ["lupa ci", "forgot_checkin"],
  ["gak sempet absen tadi", "forgot_checkin"],
  ["nggak sempat check in", "forgot_checkin"],
  ["lupa presensi", "forgot_checkin"],
  // ── work izin that must keep working ──
  ["PESPOR", null],
  ["pesporrrrr", null],
  ["PESTAPORAAAA 19-24 Loading Barang 25-27 Event Day 28-30 Loding Out", null],
  ["assist support technical check pestapora", null],
  ["Ke kotabumi doain ya", null],
  ["masuk sore, karena nanti malemnya dokumentasi latihan pespor di bablas kemang", null],
  ["izin telat, karena kehabisan bensin jadinya dorong motor dulu", null],
  ["Latihan Pesta Pora DWNTWN", null],
  ["latihan di downtown", null],
  ["ayo dong", null],
  ["Maap lupa permit, after event suwara kmrn jd permit masuk telat", null],
  ["lupa permit, masuk sore ke kantor - latihan pestapora malamnya", null],
  ["LUPA BANGET PERMIT, INI DI KOPI KINA JADI TALENT CARA DISTORSI SUWARAAA😭🙏🏻", null],
  ["istirahat karena sakit", null],
  ["istirahat di rumah, demam dari semalam", null],
  ["izin wfh karena badan drop, tapi tetep on", null],
  ["ngurusin kampus dulu bentar, nanti langsung ke kantor jam 3 (kalo absen nanti keitung day off) 🥲", null],
  ["mengurus wisuda dulu (tp tetep masuk jam 3) (biar ga di do-in sm nexus) (makasih bagas)", null],
  ["mau face off dan presscon di JBO (masuk sore selesai acara)", null],
  ["Latihan Pespor lagi sampe malem, masuk jam 2 weekly ke kantor dulu tapi kalo clock in nanti saya tidak bisa clock out", null],
  ["Permit izin check in dr luar karena stand by divenue event Distorsi Suwara Vol 2 Dubside Jam", null],
  ["[SISTEM-DOWN] Listrik Kantor Mati dari jam 11 siang — di-excuse (tidak potong XP & jatah).", null],
  ["masuk telat biar jatah ga kepotong, shooting pagi", null],
  ["Day 1", null],
  ["demo", null],
  ["DO rejected, acc wfh sama head big will", null],
  ["", null],
]

let failed = 0
for (const [reason, want] of cases) {
  const got = classifyPermitReason(reason)
  if ((got.kind ?? null) !== want) {
    failed++
    console.log(`FAIL  want=${want} got=${got.kind} matched=${JSON.stringify(got.matched)}  «${reason}» → «${normalizePermitReason(reason)}»`)
  }
}
const norm = [["pesporrrrr", "pespor"], ["Seharusnya, do,", "seharusnya do"], ["d.o", "do"], ["day-off🙏", "day off"]]
for (const [input, want] of norm) {
  const got = normalizePermitReason(input)
  if (got !== want) { failed++; console.log(`FAIL  normalize «${input}» → «${got}», want «${want}»`) }
}
console.log(failed ? `${failed} failed of ${cases.length + norm.length}` : `ok — ${cases.length + norm.length} cases`)
process.exit(failed ? 1 : 0)
