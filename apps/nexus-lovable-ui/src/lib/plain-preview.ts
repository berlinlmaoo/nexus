/**
 * A page's stored text (Doc.contentText) as a one-paragraph preview for cards and lists: Markdown syntax
 * stripped, so a card reads "Agenda · Launch plan" instead of "# Agenda" (audit 12 Oct 2026). Deliberately
 * a few regexes and no Markdown library: it runs for every card in a list.
 */
export function plainPreview(text: string | null | undefined, max = 280): string {
  if (!text) return "";
  const lines = text.slice(0, max * 4).split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    let l = raw.trim();
    if (!l || /^(```|~~~|---+|\*\*\*+|___+|\|?\s*:?-{3,})/.test(l)) continue; // fences, rules, table rules
    l = l
      .replace(/^#{1,6}\s+/, "") // headings
      .replace(/^>\s?/, "") // quotes
      .replace(/^[-*+]\s+\[[ xX]\]\s+/, "") // to-dos
      .replace(/^([-*+]|\d+[.)])\s+/, "") // bullets, numbers
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links
      .replace(/(\*\*|__|~~|`)(.+?)\1/g, "$2") // bold, strike, code
      .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, "$1$2") // italics
      .replace(/^\|(.*)\|$/, (_m, row: string) => row.split("|").map((c) => c.trim()).filter(Boolean).join(" · ")) // table rows
      .trim();
    if (l) out.push(l);
    if (out.join(" ").length >= max) break;
  }
  const s = out.join(" · ");
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
