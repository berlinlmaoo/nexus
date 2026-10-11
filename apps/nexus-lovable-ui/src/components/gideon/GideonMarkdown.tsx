import { Fragment, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/**
 * The Markdown GIDEON writes, drawn as React elements (12 Oct 2026). Deliberately a small subset and no
 * HTML: headings, paragraphs, bullet and numbered lists, quotes, fenced code, simple tables, **bold**,
 * *italic*, `code` and [links](…). Nothing the model writes is ever handed to innerHTML, so a reply cannot
 * inject markup. Links: http(s) open in a new tab; a NEXUS path (/tasks/…, or this site's own absolute
 * URL) navigates inside the app.
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
    if (m[1]) nodes.push(<code key={k++} className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]">{m[1].slice(1, -1)}</code>);
    else if (m[2] && m[3]) nodes.push(<Link key={k++} href={m[3]} onNavigate={onNavigate}>{m[2]}</Link>);
    else if (m[4]) nodes.push(<strong key={k++} className="font-semibold">{m[4].slice(2, -2)}</strong>);
    else if (m[5]) nodes.push(<em key={k++}>{m[5].slice(1, -1)}</em>);
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

export function GideonMarkdown({ text, className }: { text: string; className?: string }) {
  const router = useRouter();
  const go = (path: string) => { router.history.push(path); };
  const blocks = parseBlocks(text);
  return (
    <div className={cn("space-y-2 break-words", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h":
            return <div key={i} className={cn("font-semibold", b.level <= 2 ? "text-[0.95rem]" : "text-sm")}><Inline text={b.text} onNavigate={go} /></div>;
          case "p":
            return <p key={i} className="whitespace-pre-wrap"><Inline text={b.text} onNavigate={go} /></p>;
          case "ul":
            return <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">{b.items.map((it, j) => <li key={j}><Inline text={it} onNavigate={go} /></li>)}</ul>;
          case "ol":
            return <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">{b.items.map((it, j) => <li key={j}><Inline text={it} onNavigate={go} /></li>)}</ol>;
          case "quote":
            return <blockquote key={i} className="border-l-2 border-border pl-3 text-muted-foreground"><Inline text={b.text} onNavigate={go} /></blockquote>;
          case "code":
            return <pre key={i} className="overflow-x-auto rounded-lg bg-foreground/[0.06] p-2.5 font-mono text-xs leading-relaxed">{b.text}</pre>;
          case "hr":
            return <hr key={i} className="border-border" />;
          case "table":
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border text-left">{b.head.map((c, j) => <th key={j} className="px-2 py-1 font-semibold"><Inline text={c} onNavigate={go} /></th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => <tr key={j} className="border-b border-border/50 last:border-0">{r.map((c, x) => <td key={x} className="px-2 py-1 align-top"><Inline text={c} onNavigate={go} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
