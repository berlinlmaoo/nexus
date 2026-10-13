// What a GIDEON answer may show (audit 12 Oct 2026). Pure functions, no React, so the node test can run them.
//
//  - citedSources: the Sources row lists only what the answer actually names (by title, or by id), not every
//    record a search touched. The server filters the same way (gideon-runs.ts citedRefs); this is the
//    safety net for turns saved before it did.
//  - tidyGideonText: a safety net for the reply text. The model is told never to show ids or enum values,
//    but when it does anyway: an id (cuid / uuid, in backticks or bare) becomes a link to the matching
//    source — or, when its title is already in the same line, that title becomes the link — and an id
//    nobody can name is dropped. Bare enum tokens (IN_PROGRESS, URGENT …) become the label passed in.

/** The shape the panel holds; same as GideonRef in lib/gideon.ts. Kept structural so this file imports nothing. */
export type CiteRef = { kind: string; id: string; title: string; url: string };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The refs an answer names: by its title (first 60 characters, at least 3) or by its id. Order kept, no duplicates. */
export function citedSources<T extends CiteRef>(reply: string, refs: readonly T[]): T[] {
  const said = norm(reply || "");
  if (!said) return [];
  const out: T[] = [];
  for (const r of refs) {
    if (!r || out.some((x) => x.kind === r.kind && x.id === r.id)) continue;
    const title = norm(r.title || "").slice(0, 60);
    if ((r.id && reply.includes(r.id)) || (title.length >= 3 && said.includes(title))) out.push(r);
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A NEXUS record id: a cuid (c + 20–31 lowercase letters and digits, with digits in it) or a uuid. */
export function looksLikeId(s: string): boolean {
  if (UUID.test(s)) return true;
  return /^c[a-z0-9]{20,31}$/.test(s) && (s.match(/\d/g)?.length ?? 0) >= 3 && /[a-z].*[a-z].*[a-z]/.test(s.slice(1));
}

export const GIDEON_ENUMS = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED", "URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const;
export type GideonEnum = (typeof GIDEON_ENUMS)[number];

// An id, optionally in backticks, optionally after "id:", optionally in ( ) or [ ].
// Not preceded by a letter, digit, "/" or "-" — an id inside a link's URL (/tasks/<id>) stays.
const ID_RE = /(\s*[([]\s*)?(\bid\b\s*[:=#]?\s*)?`?(?<![\w/-])(c[a-z0-9]{20,31}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![\w-])`?(\s*[)\]])?/gi;
const ENUM_RE = new RegExp("`?\\b(" + GIDEON_ENUMS.join("|") + ")\\b`?", "g");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One chunk of reply text (a paragraph, a list item, a table cell) with ids and enums made human. */
export function tidyGideonText(text: string, refs: readonly CiteRef[], labels: Partial<Record<GideonEnum, string>>): string {
  if (!text) return text;
  const byId = new Map(refs.map((r) => [r.id, r]));
  const linkTitles: CiteRef[] = [];
  let out = text.replace(ID_RE, (whole: string, open: string | undefined, _prefix: string | undefined, id: string, close: string | undefined) => {
    if (!looksLikeId(id)) return whole;
    const wrapped = Boolean(open && close);
    const keepOpen = wrapped ? "" : open ?? "";
    const keepClose = wrapped ? "" : close ?? "";
    const ref = byId.get(id);
    if (ref && ref.title && !/[[\]]/.test(ref.title)) {
      // Its title is already in this chunk: link that instead of repeating it.
      if (norm(text).includes(norm(ref.title))) {
        if (!linkTitles.includes(ref)) linkTitles.push(ref);
        return keepOpen + keepClose;
      }
      const link = `[${ref.title}](${ref.url})`;
      return wrapped ? ` (${link})` : `${keepOpen}${link}${keepClose}`;
    }
    return keepOpen + keepClose;
  });
  for (const ref of linkTitles) {
    // The first mention that is not already a link label.
    const re = new RegExp(`(^|[^\\[\\w])(${escapeRe(ref.title).replace(/\s+/g, "\\s+")})(?!\\]\\()`, "i");
    out = out.replace(re, (_m, before: string, title: string) => `${before}[${title}](${ref.url})`);
  }
  out = out.replace(ENUM_RE, (whole: string, word: GideonEnum) => labels[word] ?? whole);
  // What a dropped id leaves behind: "()", "( , due", "  ", " ."
  return out
    .replace(/\(\s*[,;]?\s*\)|\[\s*\]/g, "")
    .replace(/\(\s*[,;]\s*/g, "(")
    .replace(/\s*[,;]\s*\)/g, ")")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]+$/gm, "");
}
