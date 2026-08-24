/**
 * Emits the tokenized PKS contract as plain text, for seeding the Google Docs master ONCE.
 *
 * The clause text comes from buildPksTemplate(), which shares composePks() with the live generator —
 * so the master and the code can't drift apart. Styling (letterhead, fonts, signature table) is done
 * by a human in Docs afterwards; the {{TOKENS}} survive formatting.
 *
 *   npx tsx scripts/seed-pks-master-doc.ts > /tmp/pks-template.txt
 */
import { buildPksTemplate, pksToPlainText } from "../src/lib/legal-templates/pks"

const doc = buildPksTemplate()
console.log(`${doc.kop}\n`)
console.log(pksToPlainText(doc))

const text = pksToPlainText(doc)
const tokens = [...new Set(text.match(/\{\{[A-Z0-9_]+\}\}/g) ?? [])].sort()
console.error(`[seed-pks-master-doc] ${doc.sections.length} sections, ${tokens.length} tokens: ${tokens.join(" ")}`)
