// node --experimental-strip-types src/lib/project-templates.test.mjs
//
// The template registry (lib/project-templates.ts) is data that POST /api/projects turns into sections,
// fields, tabs and Table columns. These checks keep a new entry from shipping a broken project.
import assert from "node:assert/strict"
import { PROJECT_TEMPLATES, findProjectTemplate, planTemplate, publicTemplates, templateHiddenTabs, templateLang, validateTemplates } from "./project-templates.ts"

// The registry is sound.
assert.deepEqual(validateTemplates(), [])

// And the validator does catch the mistakes it is there for.
const bad = { ...PROJECT_TEMPLATES[0], id: "bad", tabs: ["table"], defaultTab: "board", tableColumns: ["cf:nope"], calendarBy: "cf:type" }
const problems = validateTemplates([bad])
assert.ok(problems.some((p) => p.includes("Board or List")), problems.join("\n"))
assert.ok(problems.some((p) => p.includes("defaultTab")))
assert.ok(problems.some((p) => p.includes("unknown field cf:nope")))
assert.ok(problems.some((p) => p.includes("calendarBy must be a DATE")))

// Every template the owner listed (12 Oct 2026) is there.
for (const id of ["content-plan", "social-media", "event", "meetings", "notes", "brainstorm", "tasks"]) {
  assert.ok(findProjectTemplate(id), `missing template ${id}`)
}
assert.equal(findProjectTemplate("nope"), null)
assert.equal(findProjectTemplate(42), null)

// Content Plan, as the owner specified it.
const cp = findProjectTemplate("content-plan")
const en = planTemplate(cp, "en")
assert.deepEqual(en.sections.map((s) => [s.name, s.taskStatus]), [["Idea", "TODO"], ["In progress", "IN_PROGRESS"], ["In review", "IN_REVIEW"], ["Published", "DONE"]])
assert.deepEqual(en.fields.map((f) => [f.name, f.type]), [["Type", "MULTI_SELECT"], ["Platform", "MULTI_SELECT"], ["Publication date", "DATE"], ["Link", "URL"], ["Media", "FILE"]])
assert.ok(en.fields[1].options.options.includes("Instagram"))
assert.equal(cp.calendarBy, "cf:publicationDate")
assert.deepEqual(templateHiddenTabs(cp), ["list", "sheet", "timeline", "automations", "forms"])
assert.ok(!en.hiddenTabs.includes("board") && !en.hiddenTabs.includes("calendar") && !en.hiddenTabs.includes("table"))
assert.equal(en.docs.length, 1)
assert.equal(en.docs[0].content.type, "doc")
assert.ok(en.docs[0].contentText.includes("☐ Caption checked"))

// Indonesian build, and starter pages off.
const id = planTemplate(cp, "id", false)
assert.equal(id.sections[3].name, "Terbit")
assert.equal(id.fields[2].name, "Tanggal tayang")
assert.equal(id.docs.length, 0)
assert.equal(templateLang("en"), "en")
assert.equal(templateLang(undefined), "id")
assert.equal(templateLang("fr"), "id")

// Field options are stored the way lib/custom-fields.ts normalizes them.
const ev = planTemplate(findProjectTemplate("event"), "en")
assert.deepEqual(ev.fields.find((f) => f.key === "budget").options, { format: "currency-idr", numberFormat: "IDR" })
assert.deepEqual(ev.fields.find((f) => f.key === "venue").options, { format: "name-and-map-link" })
assert.equal(ev.fields.find((f) => f.key === "eventDate").options, null)

// Meetings has its "My meetings" preset; Notes hides the board but keeps the list.
assert.equal(findProjectTemplate("meetings").myView.name.en, "My meetings")
assert.ok(templateHiddenTabs(findProjectTemplate("notes")).includes("board"))
assert.ok(!templateHiddenTabs(findProjectTemplate("notes")).includes("list"))

// What the gallery gets: both languages, no server-only detail.
const pub = publicTemplates()
assert.equal(pub.length, PROJECT_TEMPLATES.length)
assert.equal(pub[0].id, "content-plan")
assert.ok(pub.every((t) => t.name.en && t.name.id && t.blurb.en && t.blurb.id && Array.isArray(t.hiddenTabs)))
assert.ok(pub.every((t) => !("starterTasks" in t) || typeof t.starterTasks === "number"))

console.log(`project-templates: ${PROJECT_TEMPLATES.length} templates OK`)
