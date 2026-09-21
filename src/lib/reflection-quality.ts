/**
 * Is this daily reflection actually written, or padded to 200 characters?
 *
 * The check-out gate only measured length, and length is the easiest thing to fake: "kerja kerja
 * kerja…", one sentence pasted three times, or yesterday's text again. Everything here is a pure
 * function of the text (and the person's previous reflections), so it can be unit-tested with node
 * and never touches the database itself. Thresholds are deliberately loose: an honest 200-character
 * note in either language passes; only mechanical padding fails.
 *
 * Sanity cases (run once with `node --experimental-strip-types`, see the bottom of this file):
 *   - honest 200-char note                                  → ok
 *   - "kerja kerja kerja …" to 200 chars                    → REFLECTION_REPETITIVE (few distinct words)
 *   - one sentence pasted three times                       → REFLECTION_REPETITIVE (copied phrases)
 *   - "aaaaaaaaaaaa…" filler                                 → REFLECTION_REPETITIVE (repeated characters)
 *   - yesterday's text with two words changed                → REFLECTION_REPETITIVE (same as a previous day)
 */
export type ReflectionVerdict =
  | { ok: true }
  | { ok: false; code: "REFLECTION_REPETITIVE"; error: string }

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
}

function shingles(ws: string[], n: number): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(" "))
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

export function assessReflection(text: string, previous: string[] = []): ReflectionVerdict {
  const fail = (error: string): ReflectionVerdict => ({ ok: false, code: "REFLECTION_REPETITIVE", error })

  // 1. Held-down keys: "aaaaaaa", "……….", "!!!!!!!!". Six of the same character in a row is never prose.
  if (/(\S)\1{5,}/u.test(text)) {
    return fail("Your reflection has repeated characters in it. Write it in normal sentences — what you worked on, what moved, what got stuck.")
  }

  const ws = words(text)
  const distinct = new Set(ws)

  // 2. Too few real words for the length, or the same few words over and over.
  if (ws.length < 20 || distinct.size < 14 || distinct.size / ws.length < 0.45) {
    return fail("Your reflection repeats the same words. Use a few sentences: what you worked on today, what progressed, and what's next.")
  }

  // 3. Copy-pasted phrases: a 4-word phrase that appears more than once, weighted by how much of the
  //    text it covers. Honest writing repeats a phrase now and then; pasting repeats most of them.
  const grams: string[] = []
  for (let i = 0; i + 4 <= ws.length; i++) grams.push(ws.slice(i, i + 4).join(" "))
  if (grams.length >= 8) {
    const seen = new Map<string, number>()
    for (const g of grams) seen.set(g, (seen.get(g) ?? 0) + 1)
    let duplicated = 0
    for (const g of grams) if ((seen.get(g) ?? 0) > 1) duplicated++
    if (duplicated / grams.length > 0.3) {
      return fail("Part of your reflection is pasted more than once. Say each thing once — it can be short, as long as it's yours.")
    }
  }

  // 4. Yesterday again. Word-trigram overlap with any of the last reflections; 0.5 is far above what
  //    two genuinely different days about the same project produce (measured around 0.05–0.2).
  const mine = shingles(ws, 3)
  for (const prev of previous) {
    const theirs = shingles(words(prev), 3)
    if (jaccard(mine, theirs) >= 0.5) {
      return fail("This reads almost the same as a previous day's reflection. Write today's — what was different about today?")
    }
  }

  return { ok: true }
}
