import { Fragment } from "react";
import { cn } from "@/lib/utils";

// Only http(s):// and www. runs become links. Anything else — javascript:, data:, a bare "foo.com" —
// stays plain text, so a message can never smuggle a script URL behind a tap.
const URL_RUN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
// Punctuation that ends a sentence rather than the address: "see https://x.id/a." links /a, not /a.
const TRAILING = /[.,;:!?'"’”)\]}>]+$/;

/** The link target for a matched run, or null when it doesn't parse as an http(s) URL. */
export function safeHref(raw: string): string | null {
  const href = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Splits a run into the address and the punctuation after it, keeping a ")" that closes a "(" inside. */
function trimRun(run: string): [string, string] {
  const m = TRAILING.exec(run);
  if (!m) return [run, ""];
  let url = run.slice(0, m.index);
  let tail = m[0];
  // Wikipedia-style "…/Foo_(bar)": give back closing parens that the address itself opened.
  while (tail.startsWith(")") && (url.match(/\(/g)?.length ?? 0) > (url.match(/\)/g)?.length ?? 0)) {
    url += ")";
    tail = tail.slice(1);
  }
  return [url, tail];
}

/** Message body with its web addresses clickable (new tab, no opener, no referrer). */
export function MessageText({ text, mine }: { text: string; mine?: boolean }) {
  const parts: Array<string | { href: string; label: string }> = [];
  let last = 0;
  for (const m of text.matchAll(URL_RUN)) {
    const start = m.index ?? 0;
    const [label, tail] = trimRun(m[0]);
    const href = safeHref(label);
    if (!href) continue;
    if (start > last) parts.push(text.slice(last, start));
    parts.push({ href, label });
    if (tail) parts.push(tail);
    last = start + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <span className="whitespace-pre-wrap break-words leading-relaxed">
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn("break-all underline underline-offset-2", mine ? "decoration-primary-foreground/60 hover:decoration-primary-foreground" : "text-primary decoration-primary/40 hover:decoration-primary")}
          >
            {p.label}
          </a>
        ),
      )}
    </span>
  );
}
