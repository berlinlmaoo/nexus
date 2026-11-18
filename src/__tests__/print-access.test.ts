// @vitest-environment node
import { describe, expect, it } from "vitest"
import { canPrint, canSeeJob, logScope, type PrintAccessDeps } from "@/lib/print/access"
import { docToPrintHtml, escapeHtml } from "@/lib/print/doc-html"

// Print to the office printer (owner, 18 Nov 2026): whoever can open the item can print it — Legal stays
// invitation-only, a Doc page follows its project's access — and the print log shows your own rows unless you are
// BoD / One Above All. The deciding functions are the item screens' own (lib/print/service.ts wires them); here
// they are faked so every branch is visible.

function deps(o: { legal?: string[]; legalDocs?: string[]; docs?: Record<string, string[]> } = {}): PrintAccessDeps {
  return {
    hasLegal: async (u) => (o.legal ?? []).includes(u),
    legalDocExists: async (id) => (o.legalDocs ?? []).includes(id),
    docAccess: async (u, id) => ({ exists: id in (o.docs ?? {}), read: (o.docs?.[id] ?? []).includes(u) }),
  }
}

describe("who may print", () => {
  it("Legal: only invited people, and only documents that exist", async () => {
    const d = deps({ legal: ["inv"], legalDocs: ["L1"] })
    expect(await canPrint("inv", "legal", "L1", d)).toEqual({ ok: true })
    expect(await canPrint("stranger", "legal", "L1", d)).toMatchObject({ ok: false, status: 403, code: "LEGAL_NOT_INVITED" })
    // Not invited is answered before the lookup: an outsider learns nothing about which ids exist.
    expect(await canPrint("stranger", "legal", "nope", d)).toMatchObject({ ok: false, status: 403 })
    expect(await canPrint("inv", "legal", "nope", d)).toMatchObject({ ok: false, status: 404 })
  })

  it("Doc: whoever can read the page (its project access), 404 for an unknown page", async () => {
    const d = deps({ docs: { D1: ["member"] } })
    expect(await canPrint("member", "doc", "D1", d)).toEqual({ ok: true })
    expect(await canPrint("outsider", "doc", "D1", d)).toMatchObject({ ok: false, status: 403 })
    expect(await canPrint("member", "doc", "D404", d)).toMatchObject({ ok: false, status: 404 })
  })

  it("Legal access does not open a Doc, nor the other way round", async () => {
    const d = deps({ legal: ["lawyer"], legalDocs: ["L1"], docs: { D1: ["writer"] } })
    expect(await canPrint("lawyer", "doc", "D1", d)).toMatchObject({ ok: false, status: 403 })
    expect(await canPrint("writer", "legal", "L1", d)).toMatchObject({ ok: false, status: 403 })
  })
})

describe("who sees the print log", () => {
  it("staff and managers see only their own rows", () => {
    expect(logScope("me", false, null)).toEqual({ userId: "me" })
    expect(logScope("me", false, "me")).toEqual({ userId: "me" })
    expect(logScope("me", false, "someone")).toBeNull()
    expect(canSeeJob("me", false, { userId: "me" })).toBe(true)
    expect(canSeeJob("me", false, { userId: "someone" })).toBe(false)
  })

  it("BoD / One Above All see everyone's, or one person's", () => {
    expect(logScope("boss", true, null)).toEqual({})
    expect(logScope("boss", true, "someone")).toEqual({ userId: "someone" })
    expect(canSeeJob("boss", true, { userId: "someone" })).toBe(true)
  })
})

describe("Doc page → printable HTML", () => {
  it("escapes text and puts the title on top", () => {
    const html = docToPrintHtml({
      title: "Plan <Q4> & co",
      meta: "Project · Printed by A",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>" }] }] },
    })
    expect(html).toContain("<h1>Plan &lt;Q4&gt; &amp; co</h1>")
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("@page { size: A4;")
  })

  it("renders headings, lists, tasks, tables and marks; unknown blocks keep their text", () => {
    const html = docToPrintHtml({
      title: "T",
      content: { type: "doc", content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one", marks: [{ type: "bold" }] }] }] }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H" }] }] }] }] },
        { type: "mystery", content: [{ type: "text", text: "kept" }] },
      ] },
    })
    expect(html).toContain("<h3>Section</h3>")
    expect(html).toContain("<li><strong>one</strong></li>")
    expect(html).toContain("&#9745;")
    expect(html).toContain("<th><p>H</p></th>")
    expect(html).toContain("<p>kept</p>")
  })

  it("names no outside resource: images and links print as text", () => {
    const html = docToPrintHtml({
      title: "T",
      content: { type: "doc", content: [
        { type: "image", attrs: { src: "http://10.0.0.1/secret.png", alt: "Chart" } },
        { type: "paragraph", content: [{ type: "text", text: "site", marks: [{ type: "link", attrs: { href: "http://internal/x" } }] }] },
      ] },
    })
    expect(html).not.toMatch(/<img|<link|src=|href=|url\(/)
    expect(html).toContain("Chart")
    expect(html).toContain("(http://internal/x)")
    expect(escapeHtml(`"'`)).toBe("&quot;&#39;")
  })
})
