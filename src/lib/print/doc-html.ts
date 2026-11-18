import type { BlockMark, BlockNode } from "@/lib/blockdoc"

/**
 * A Doc page as a printable HTML page (print to the office printer, 18 Nov 2026): the block document (lib/blockdoc.ts,
 * the format spec is there) walked the same way docToText walks it, but into HTML for Gotenberg's Chromium route.
 * A4, a readable serif-free body, the title on top. Pure: no I/O. Tested by src/__tests__/print-doc-html.test.ts.
 *
 * Safety: every text and attribute is escaped, and the page names NO outside resource (no <img src>, no link
 * stylesheet, no font URL): Chromium inside Gotenberg could otherwise be made to fetch internal URLs. Images print
 * as a captioned placeholder; links print as their text with the address after it.
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

function markWrap(html: string, marks: BlockMark[] | undefined): string {
  let out = html
  for (const m of marks ?? []) {
    switch (m.type) {
      case "bold": out = `<strong>${out}</strong>`; break
      case "italic": out = `<em>${out}</em>`; break
      case "underline": out = `<u>${out}</u>`; break
      case "strike": out = `<s>${out}</s>`; break
      case "code": out = `<code>${out}</code>`; break
      case "highlight": out = `<mark>${out}</mark>`; break
      default: break
    }
  }
  return out
}

function inlineHtml(nodes: BlockNode[] | undefined): string {
  if (!nodes) return ""
  let out = ""
  for (const n of nodes) {
    if (n.type === "text") {
      const text = n.text ?? ""
      let html = markWrap(escapeHtml(text), n.marks)
      const link = n.marks?.find((m) => m.type === "link")
      const href = typeof link?.attrs?.href === "string" ? link.attrs.href : ""
      if (href) html = `<span class="link">${html}</span>${href !== text ? ` <span class="href">(${escapeHtml(href)})</span>` : ""}`
      out += html
    } else if (n.type === "hardBreak") out += "<br>"
    else if (n.type === "mention") {
      const a = n.attrs ?? {}
      const label = String(a.label ?? a.id ?? "")
      out += `<span class="chip">${escapeHtml((a.kind ?? "user") === "user" ? `@${label}` : label)}</span>`
    } else if (n.type === "dateChip") {
      const a = n.attrs ?? {}
      out += `<span class="chip">${escapeHtml([a.date, a.time].filter(Boolean).join(" "))}</span>`
    } else out += inlineHtml(n.content)
  }
  return out
}

function level(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  return n === 2 || n === 3 ? n : 1
}

function blocks(nodes: BlockNode[] | undefined): string {
  return (nodes ?? []).map(blockHtml).join("\n")
}

function listItem(item: BlockNode, task?: boolean): string {
  const box = task ? `<span class="box">${item.attrs?.checked ? "&#9745;" : "&#9744;"}</span> ` : ""
  const kids = item.content ?? []
  const first = kids[0]
  if (first && (first.type === "paragraph" || first.type === "heading")) {
    return `<li${task ? ' class="task"' : ""}>${box}${inlineHtml(first.content)}${blocks(kids.slice(1))}</li>`
  }
  return `<li${task ? ' class="task"' : ""}>${box}${blocks(kids)}</li>`
}

/** One block as HTML. Unknown blocks print their text, never nothing (the format's rule). */
export function blockHtml(node: BlockNode): string {
  const a = node.attrs ?? {}
  switch (node.type) {
    case "paragraph": {
      const inner = inlineHtml(node.content)
      return inner ? `<p>${inner}</p>` : `<p class="empty">&nbsp;</p>`
    }
    case "heading": {
      const tag = `h${level(a.level) + 1}`
      return `<${tag}>${inlineHtml(node.content)}</${tag}>`
    }
    case "bulletList":
      return `<ul>${(node.content ?? []).map((it) => listItem(it)).join("")}</ul>`
    case "orderedList": {
      const start = typeof a.start === "number" && a.start !== 1 ? ` start="${Math.trunc(a.start)}"` : ""
      return `<ol${start}>${(node.content ?? []).map((it) => listItem(it)).join("")}</ol>`
    }
    case "taskList":
      return `<ul class="tasks">${(node.content ?? []).map((it) => listItem(it, true)).join("")}</ul>`
    case "listItem":
      return `<ul>${listItem(node)}</ul>`
    case "taskItem":
      return `<ul class="tasks">${listItem(node, true)}</ul>`
    case "blockquote":
      return `<blockquote>${blocks(node.content)}</blockquote>`
    case "callout": {
      const emoji = typeof a.emoji === "string" && a.emoji ? `<span class="emoji">${escapeHtml(a.emoji)}</span>` : ""
      return `<div class="callout">${emoji}<div>${blocks(node.content)}</div></div>`
    }
    case "details": {
      const kids = node.content ?? []
      const summary = kids.find((k) => k.type === "detailsSummary")
      const body = kids.find((k) => k.type === "detailsContent")
      return `<div class="details"><p class="summary">&#9662; ${inlineHtml(summary?.content)}</p><div class="details-body">${blocks(body?.content)}</div></div>`
    }
    case "detailsSummary":
      return `<p class="summary">${inlineHtml(node.content)}</p>`
    case "detailsContent":
      return blocks(node.content)
    case "codeBlock":
      return `<pre><code>${escapeHtml((node.content ?? []).map((c) => c.text ?? "").join(""))}</code></pre>`
    case "horizontalRule":
      return "<hr>"
    case "table": {
      const rows = (node.content ?? []).map((r) => {
        const cells = (r.content ?? []).map((c) => {
          const tag = c.type === "tableHeader" ? "th" : "td"
          const span = (k: string) => (typeof c.attrs?.[k] === "number" && (c.attrs[k] as number) > 1 ? ` ${k}="${Math.trunc(c.attrs[k] as number)}"` : "")
          return `<${tag}${span("colspan")}${span("rowspan")}>${blocks(c.content)}</${tag}>`
        })
        return `<tr>${cells.join("")}</tr>`
      })
      return rows.length ? `<table>${rows.join("")}</table>` : ""
    }
    case "image":
      return a.src ? `<p class="media">&#128444; ${escapeHtml(String(a.alt || "Image"))}</p>` : ""
    case "fileBlock":
      return a.url ? `<p class="media">&#128206; ${escapeHtml(String(a.name ?? "file"))}</p>` : ""
    case "bookmark":
      return a.url ? `<p class="media">&#128279; ${a.title ? `${escapeHtml(String(a.title))} ` : ""}<span class="href">(${escapeHtml(String(a.url))})</span></p>` : ""
    default:
      if (node.content?.some((c) => c.type === "text")) return `<p>${inlineHtml(node.content)}</p>`
      return blocks(node.content)
  }
}

const CSS = `
@page { size: A4; margin: 18mm 18mm 20mm 18mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #111; font-family: "Noto Sans", "DejaVu Sans", "Liberation Sans", Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.5; overflow-wrap: anywhere; }
header { border-bottom: 1px solid #bbb; padding-bottom: 8pt; margin-bottom: 14pt; }
header h1 { font-size: 20pt; line-height: 1.25; margin: 0 0 4pt 0; font-weight: 700; }
header .meta { font-size: 8.5pt; color: #555; }
h2 { font-size: 16pt; margin: 16pt 0 6pt; line-height: 1.3; }
h3 { font-size: 13.5pt; margin: 14pt 0 5pt; line-height: 1.3; }
h4 { font-size: 12pt; margin: 12pt 0 4pt; line-height: 1.3; }
h2, h3, h4 { page-break-after: avoid; break-after: avoid; }
p { margin: 0 0 6pt; orphans: 3; widows: 3; }
p.empty { margin: 0 0 6pt; }
ul, ol { margin: 0 0 6pt; padding-left: 20pt; }
li { margin: 0 0 2pt; }
li > p { margin: 0; }
ul.tasks { list-style: none; padding-left: 4pt; }
.box { font-size: 12pt; }
blockquote { margin: 0 0 8pt; padding: 0 0 0 10pt; border-left: 3px solid #999; color: #333; }
.callout { display: flex; gap: 8pt; border: 1px solid #ccc; border-radius: 4pt; padding: 8pt 10pt; margin: 0 0 8pt; break-inside: avoid; }
.callout .emoji { font-size: 13pt; line-height: 1.2; }
.callout > div > :last-child { margin-bottom: 0; }
.details { margin: 0 0 6pt; }
.details .summary { font-weight: 600; }
.details-body { padding-left: 14pt; }
pre { font-family: "DejaVu Sans Mono", "Liberation Mono", Menlo, monospace; font-size: 9.5pt; background: #f3f3f3; border: 1px solid #ddd; border-radius: 3pt; padding: 8pt; white-space: pre-wrap; margin: 0 0 8pt; }
code { font-family: "DejaVu Sans Mono", "Liberation Mono", Menlo, monospace; font-size: 0.92em; background: #f3f3f3; padding: 0 2pt; border-radius: 2pt; }
pre code { background: none; padding: 0; }
hr { border: 0; border-top: 1px solid #bbb; margin: 10pt 0; }
table { border-collapse: collapse; width: 100%; margin: 0 0 10pt; font-size: 10pt; }
th, td { border: 1px solid #999; padding: 4pt 6pt; vertical-align: top; text-align: left; }
th { background: #eee; font-weight: 600; }
th > :last-child, td > :last-child { margin-bottom: 0; }
tr { break-inside: avoid; }
mark { background: #fff2a8; }
.chip { font-weight: 600; }
.link { text-decoration: underline; }
.href { color: #555; font-size: 0.85em; }
.media { color: #555; font-style: italic; }
`

/** The whole printable page. `meta` is one small line under the title (project · date). */
export function docToPrintHtml(input: { title: string; content: unknown; meta?: string; lang?: string }): string {
  const content = input.content && typeof input.content === "object" && Array.isArray((input.content as { content?: unknown }).content)
    ? ((input.content as { content: BlockNode[] }).content)
    : []
  const title = input.title.trim() || "Untitled"
  return `<!doctype html>
<html lang="${input.lang === "id" ? "id" : "en"}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header><h1>${escapeHtml(title)}</h1>${input.meta ? `<div class="meta">${escapeHtml(input.meta)}</div>` : ""}</header>
<main>
${blocks(content)}
</main>
</body>
</html>
`
}
