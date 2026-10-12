// node --experimental-strip-types src/lib/competition-rank.test.mjs
import assert from "node:assert/strict"
import { competitionRank } from "./competition-rank.ts"
const rows = [
  { n: "Zaki", xp: 1000 }, { n: "andi", xp: 1000 }, { n: "Bima", xp: 1200 }, { n: "Citra", xp: 1000 }, { n: "Dewi", xp: 900 }, { n: "Eka", xp: 900 }, { n: "Fajar", xp: 100 },
]
const r = competitionRank(rows, (x) => x.xp, (x) => x.n)
assert.deepEqual(r.map((x) => `${x.rank}:${x.n}`), ["1:Bima", "2:andi", "2:Citra", "2:Zaki", "5:Dewi", "5:Eka", "7:Fajar"])
assert.deepEqual(competitionRank([], (x) => x, (x) => ""), [])
assert.deepEqual(competitionRank([{ n: "a", xp: 5 }, { n: "b", xp: 5 }], (x) => x.xp, (x) => x.n).map((x) => x.rank), [1, 1])
console.log("competition-rank: ok")
