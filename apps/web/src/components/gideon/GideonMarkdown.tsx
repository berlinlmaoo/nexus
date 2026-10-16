import { Fragment, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { tidyGideonText, type CiteRef, type GideonEnum } from "@/lib/gideon-cite";

/**
 * The Markdown GIDEON writes, drawn as React elements (12 Oct 2026). Deliberately a small subset and no
 * HTML: headings, paragraphs, bullet and numbered lists, quotes, fenced code, simple tables, **bold**,
 * *italic*, `code` and [links](…). Nothing the model writes is ever handed to innerHTML, so a reply cannot
 * inject markup. Links: http(s) open in a new tab; a NEXUS path (/tasks/…, or this site's own absolute
 * URL) navigates inside the app.
 *
 * Safety net (audit 12 Oct 2026): ids the model should not have shown become links to the matching source
 * (or vanish), and bare enums (IN_PROGRESS, URGENT …) become the translated label — see lib/gideon-cite.ts.
 * Fenced code is left exactly as written.
 */

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "hr" };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push({ kind: "code", text: buf.join("\n") });
      continue;
    }
    const h = /^\s*(#{1,4})\s+(.*)$/.exec(line);
    if (h) { out.push({ kind: "h", level: h[1].length, text: h[2] }); i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { out.push({ kind: "hr" }); i++; continue; }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push({ kind: "table", head, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }
    if (/^\s*([-*•])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && (/^\s*([-*•])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^\s*([-*•])\s+/.test(lines[i])) items.push(lines[i].replace(/^\s*([-*•])\s+/, ""));
        else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      out.push({ kind: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && (/^\s*\d+[.)]\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      out.push({ kind: "ol", items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,4}\s|```|>|[-*•]\s|\d+[.)]\s)/.test(lines[i]) && !isTableRow(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    out.push({ kind: "p", text: buf.join("\n") });
  }
  return out;
}

/** Same-origin path for a link GIDEON wrote, or null when it leaves the app. */
function internalPath(href: string): string | null {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const u = new URL(href);
    if (typeof window !== "undefined" && u.origin === window.location.origin) return u.pathname + u.search + u.hash;
    // GIDEON's tools hand out the public NEXUS address; on this site that is the same page.
    if (u.hostname === "nexus.znetworks.id" && /^\/(tasks|projects|docs)\//.test(u.pathname)) return u.pathname;
  } catch { /* not a URL */ }
  return null;
}

function Inline({ text, onNavigate }: { text: string; onNavigate: (path: string) => void }) {
  const nodes: ReactNode[] = [];
  // Order matters: code first (its content is literal), then links, then bold, then italic.
  const re = /(`[^`\n]+`)|\[([^\]\n]+)\]\(([^)\s]+)\)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|(?<![\w])_[^_\n]+_(?![\w]))|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) nodes.push(<code key={k++} className="rounded-[4px] bg-muted px-[0.3em] py-[0.1em] font-mono text-[0.85em] text-[#c4554d] dark:text-[#ff8f86]">{m[1].slice(1, -1)}</code>);
    else if (m[2] && m[3]) nodes.push(<Link key={k++} href={m[3]} onNavigate={onNavigate}>{m[2]}</Link>);
    else if (m[4]) nodes.push(<strong key={k++} className="font-semibold"><Inline text={m[4].slice(2, -2)} onNavigate={onNavigate} /></strong>);
    else if (m[5]) nodes.push(<em key={k++}><Inline text={m[5].slice(1, -1)} onNavigate={onNavigate} /></em>);
    else if (m[6]) nodes.push(<Link key={k++} href={m[6]} onNavigate={onNavigate}>{m[6].replace(/^https?:\/\//, "").slice(0, 48)}</Link>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes.map((n, j) => (typeof n === "string" ? <Fragment key={`t${j}`}>{n}</Fragment> : n))}</>;
}

function Link({ href, children, onNavigate }: { href: string; children: ReactNode; onNavigate: (path: string) => void }) {
  const path = internalPath(href);
  if (path) {
    return (
      <a href={path} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); onNavigate(path); }} className="font-medium text-primary underline-offset-2 hover:underline">
        {children}
      </a>
    );
  }
  if (!/^https?:\/\//i.test(href)) return <>{children}</>;
  return <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-primary underline-offset-2 hover:underline">{children}</a>;
}

/** Each non-code block with ids and enums made human (code blocks stay literal). */
function tidyBlocks(blocks: Block[], fix: (s: string) => string): Block[] {
  return blocks.map((b) => {
    switch (b.kind) {
      case "h": case "p": case "quote": return { ...b, text: fix(b.text) };
      case "ul": case "ol": return { ...b, items: b.items.map(fix) };
      case "table": return { ...b, head: b.head.map(fix), rows: b.rows.map((r) => r.map(fix)) };
      default: return b;
    }
  });
}

export function GideonMarkdown({ text, className, sources }: { text: string; className?: string; sources?: readonly CiteRef[] }) {
  const router = useRouter();
  const { t } = useLang();
  const go = (path: string) => { router.history.push(path); };
  const labels: Record<GideonEnum, string> = {
    TODO: t("To do"), IN_PROGRESS: t("In progress"), IN_REVIEW: t("In review"), DONE: t("Done"), CANCELLED: t("Cancelled"),
    URGENT: t("Urgent"), HIGH: t("High"), MEDIUM: t("Medium"), LOW: t("Low"), NONE: t("None"),
  };
  // Inline `code` stays literal too: "status != DONE" is a filter to copy, not a sentence to translate.
  const tidy = (s: string) => s.split(/(`[^`\n]+`)/).map((part, i) => (i % 2 ? part : tidyGideonText(part, sources ?? [], labels))).join("");
  const blocks = tidyBlocks(parseBlocks(text), tidy);
  return (
    <div className={cn("space-y-2.5 break-words", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h":
            // Notion's heading scale, a step down for a chat column.
            return <div key={i} role="heading" aria-level={Math.min(6, b.level + 2)} className={cn("font-semibold leading-snug tracking-tight first:mt-0", b.level === 1 ? "mt-4 text-[1.3em]" : b.level === 2 ? "mt-3.5 text-[1.15em]" : "mt-3 text-[1.05em]")}><Inline text={b.text} onNavigate={go} /></div>;
          case "p":
            return <p key={i} className="whitespace-pre-wrap"><Inline text={b.text} onNavigate={go} /></p>;
          case "ul":
            return <ul key={i} className="list-disc space-y-1 pl-6 marker:text-foreground/70">{b.items.map((it, j) => <li key={j}><Inline text={it} onNavigate={go} /></li>)}</ul>;
          case "ol":
            return <ol key={i} className="list-decimal space-y-1 pl-6 marker:text-foreground/70">{b.items.map((it, j) => <li key={j}><Inline text={it} onNavigate={go} /></li>)}</ol>;
          case "quote":
            return <blockquote key={i} className="border-l-[3px] border-foreground pl-3.5"><Inline text={b.text} onNavigate={go} /></blockquote>;
          case "code":
            return <pre key={i} className="overflow-x-auto rounded-md bg-muted/70 px-4 py-3.5 font-mono text-[0.82em] leading-relaxed">{b.text}</pre>;
          case "hr":
            return <hr key={i} className="border-border" />;
          case "table":
            return (
              // Notion's simple table: a full grid of hairlines and a tinted header row.
              <div key={i} className="overflow-x-auto">
                <table className="w-full border-collapse text-[0.9em]">
                  <thead><tr className="bg-muted/50 text-left">{b.head.map((c, j) => <th key={j} className="border border-border px-2.5 py-1.5 font-medium"><Inline text={c} onNavigate={go} /></th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, x) => <td key={x} className="border border-border px-2.5 py-1.5 align-top"><Inline text={c} onNavigate={go} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
