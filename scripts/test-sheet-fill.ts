/** fillValues checks. `npx tsx scripts/test-sheet-fill.ts` */
import { fillValues } from "../apps/nexus-lovable-ui/src/components/sheets/sheet-types"

let pass = 0, fail = 0
const check = (n: string, a: unknown, b: unknown) => {
  JSON.stringify(a) === JSON.stringify(b)
    ? (pass++, console.log(`  ok   ${n}`))
    : (fail++, console.log(`  FAIL ${n}\n         dapat    ${JSON.stringify(a)}\n         harusnya ${JSON.stringify(b)}`))
}
check("deret 1,2 -> 3,4,5", fillValues([1, 2], 3), [3, 4, 5])
check("deret 10,20 -> 30,40", fillValues([10, 20], 2), [30, 40])
check("angka tunggal disalin", fillValues([7], 3), [7, 7, 7])
check("angka acak disalin", fillValues([3, 11], 2), [19, 27])
check("teks berangka", fillValues(["Hari 1"], 3), ["Hari 2", "Hari 3", "Hari 4"])
check("teks berangka lompat 2", fillValues(["Sesi 2", "Sesi 4"], 2), ["Sesi 6", "Sesi 8"])
check("teks biasa disalin", fillValues(["Talent"], 2), ["Talent", "Talent"])
check("blok berulang", fillValues(["a", "b"], 4), ["a", "b", "a", "b"])
// Satu sel isinya angka-sebagai-teks = disalin, bukan deret (nyamain Sheets).
check("teks \"100\" tunggal disalin", fillValues(["100"], 3), ["100", "100", "100"])
check("teks \"0\" tunggal disalin", fillValues(["0"], 2), ["0", "0"])
check("teks angka 2 sel tetep deret", fillValues(["1", "2"], 3), ["3", "4", "5"])
check("prefix tetep naik dari 1 sel", fillValues(["Sesi 9"], 2), ["Sesi 10", "Sesi 11"])
check("prefix spasi doang tetep naik", fillValues(["No 7"], 1), ["No 8"])
console.log(`\n${pass} lolos, ${fail} gagal`)
process.exit(fail ? 1 : 0)
