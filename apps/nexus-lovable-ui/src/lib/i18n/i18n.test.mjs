// node --experimental-strip-types src/lib/i18n/i18n.test.mjs
// The Indonesian tables are plain objects merged into one: the same English key in two files would
// silently pick one translation. This fails on any key that appears twice (in one file or across files),
// and on a placeholder that the translation drops or renames.
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const seen = new Map()
let n = 0
for (const f of readdirSync(here).filter((x) => /^id-.*\.ts$/.test(x))) {
  const src = readFileSync(path.join(here, f), "utf8")
  for (const m of src.matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/gm)) {
    const key = JSON.parse(m[1])
    const val = JSON.parse(m[2])
    assert.ok(!seen.has(key), `duplicate key ${JSON.stringify(key)} in ${f} and ${seen.get(key)}`)
    seen.set(key, f)
    const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",")
    assert.equal(ph(val), ph(key), `placeholders differ for ${JSON.stringify(key)} in ${f}`)
    n++
  }
}
console.log(`i18n: ${n} Indonesian entries, no duplicates, placeholders match`)
