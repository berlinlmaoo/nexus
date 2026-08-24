/**
 * Emits the tokenized MOU Event text, for seeding the Google Docs master ONCE.
 *
 *   npx tsx scripts/seed-mou-master-doc.ts > /tmp/mou-template.txt
 */
import { MOU_TEMPLATE_TEXT } from "../src/lib/legal-templates/mou"

process.stdout.write(MOU_TEMPLATE_TEXT)

const tokens = [...new Set(MOU_TEMPLATE_TEXT.match(/\{\{[A-Z0-9_]+\}\}/g) ?? [])].sort()
const pasal = (MOU_TEMPLATE_TEXT.match(/^PASAL \d+/gm) ?? []).length
console.error(`[seed-mou-master-doc] ${pasal} pasal, ${tokens.length} tokens: ${tokens.join(" ")}`)
