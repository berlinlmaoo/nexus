/** parseCsv / csvCell checks. `npx tsx scripts/test-csv.ts` */
import { csvCell, parseCsv, toCsv } from "../src/lib/csv"

let pass = 0, fail = 0
const check = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  ok ? (pass++, console.log(`  ok   ${name}`))
     : (fail++, console.log(`  FAIL ${name}\n         dapat    ${JSON.stringify(a)}\n         harusnya ${JSON.stringify(b)}`))
}

console.log("— penjaga formula injection —")
check("=cmd dinetralin", csvCell("=cmd|'/c calc'!A1"), "'=cmd|'/c calc'!A1")
check("+62 dinetralin", csvCell("+628123"), "'+628123")
check("angka negatif TIDAK dinetralin", csvCell(-250), "-250")
check("koma dikutip", csvCell("Jakarta, DKI"), '"Jakarta, DKI"')

console.log("\n— parse CSV —")
check("dasar", parseCsv("a,b\n1,2"), [["a","b"],["1","2"]])
check("kutip + koma di dalam", parseCsv('nama,kota\n"Budi, S.T.",Jakarta'), [["nama","kota"],["Budi, S.T.","Jakarta"]])
check("kutip di dalam kutip", parseCsv('a\n"dia bilang ""halo"""'), [["a"],['dia bilang "halo"']])
check("CRLF", parseCsv("a,b\r\n1,2\r\n"), [["a","b"],["1","2"]])
check("BOM dibuang", parseCsv("﻿a,b\n1,2"), [["a","b"],["1","2"]])
check("delimiter titik-koma (Excel lokal ID)", parseCsv("a;b\n1;2"), [["a","b"],["1","2"]])
check("baris kosong di ujung dibuang", parseCsv("a,b\n1,2\n\n"), [["a","b"],["1","2"]])
check("newline di dalam kutip", parseCsv('a,b\n"baris1\nbaris2",x'), [["a","b"],["baris1\nbaris2","x"]])

console.log("\n— pulang-pergi —")
const rows = [["nama","catatan","nilai"],["Budi","=SUM(A1)",1500],["Ani",'pakai "kutip"',-250]]
const back = parseCsv(toCsv(rows))
check("header utuh", back[0], ["nama","catatan","nilai"])
check("rumus jadi teks pas balik", back[1][1], "'=SUM(A1)")
check("kutip selamat", back[2][1], 'pakai "kutip"')

console.log(`\n${pass} lolos, ${fail} gagal`)
process.exit(fail ? 1 : 0)
