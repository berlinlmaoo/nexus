/**
 * Plain-text Markdown pasted into a page becomes blocks, as in Notion (bughunt E-BUG-4): "# Title",
 * "- item", "1. step", "- [ ] todo", "> quote", ``` fences, "---", **bold**, *italic*, `code`,
 * ~~strike~~ and [links](url). Rich HTML paste is untouched (the browser's HTML wins); this runs only
 * when the clipboard has text alone and the text looks like Markdown.
 *
 * Pure (no imports) so it is unit-tested with node (markdown-paste.test.mjs).
 */

const BLOCK_RE = /^(\s{0,3}#{1,6}\s+\S|\s*[-*+]\s+\S|\s*\d{1,3}[.)]\s+\S|\s*>\s?\S|\s*```|\s*(?:-{3,}|\*{3,}|_{3,})\s*$|\s*[-*+]\s+\[[ xX]\]\s)/;
const INLINE_RE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/|mailto:|\/)[^)\s]+\))/;

/** True when the text uses Markdown syntax worth converting (one block marker or inline mark is enough). */
export function looksLikeMarkdown(text: string): boolean {
  if (!text || text.length > 200_000) return false;
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => BLOCK_RE.test(l))) return true;
  return INLINE_RE.test(text);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inline marks. Code spans are cut out first so their content is not formatted. */
export function inlineMd(src: string): string {
  const parts = src.split(/(`[^`\n]+`)/);
  return parts.map((p, i) => {
    if (i % 2 === 1) return `<code>${esc(p.slice(1, -1))}</code>`;
    let s = esc(p);
    s = s.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:|\/)[^)\s]+)\)/g, (_m, label: string, href: string) => `<a href="${href}">${label}</a>`);
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    s = s.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
    s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?![_\w])/g, "$1<em>$2</em>");
    return s;
  }).join("");
}

type ListKind = "ul" | "ol" | "task";

/** Markdown → HTML the editor's schema parses (task lists use Tiptap's data-type markup). */
export function markdownToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { kind: ListKind; items: string[] } | null = null;
  let quote: string[] | null = null;

  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inlineMd).join("<br>")}</p>`); para = []; } };
  const flushList = () => {
    if (!list) return;
    if (list.kind === "task") out.push(`<ul data-type="taskList">${list.items.join("")}</ul>`);
    else out.push(`<${list.kind}>${list.items.join("")}</${list.kind}>`);
    list = null;
  };
  const flushQuote = () => { if (quote) { out.push(`<blockquote>${quote.map((q) => `<p>${inlineMd(q)}</p>`).join("")}</blockquote>`); quote = null; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  const addItem = (kind: ListKind, html: string) => {
    flushPara(); flushQuote();
    if (!list || list.kind !== kind) { flushList(); list = { kind, items: [] }; }
    list.items.push(html);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flushAll();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      out.push(`<pre><code${fence[1] ? ` class="language-${esc(fence[1])}"` : ""}>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flushAll(); continue; }
    let m: RegExpExecArray | null;
    if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      flushAll();
      const level = Math.min(3, m[1].length);
      out.push(`<h${level}>${inlineMd(m[2])}</h${level}>`);
    } else if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll();
      out.push("<hr>");
    } else if ((m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line))) {
      const checked = m[1].toLowerCase() === "x";
      addItem("task", `<li data-type="taskItem" data-checked="${checked}"><p>${inlineMd(m[2])}</p></li>`);
    } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      addItem("ul", `<li><p>${inlineMd(m[1])}</p></li>`);
    } else if ((m = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line))) {
      addItem("ol", `<li><p>${inlineMd(m[1])}</p></li>`);
    } else if ((m = /^\s*>\s?(.*)$/.exec(line))) {
      flushPara(); flushList();
      (quote ??= []).push(m[1]);
    } else {
      flushList(); flushQuote();
      para.push(line.trim());
    }
  }
  flushAll();
  return out.join("");
}
