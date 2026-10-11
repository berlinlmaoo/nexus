// Category sections → a "Kategori" / "Category" property; board columns = statuses (owner, 12 Oct 2026:
// "ikutin cara notion"). Companion of prisma/sql/2026-10-12-views-status-sections.sql (run that first: it
// binds every section to a status) and of lib/status-sections.ts (sections ARE the status options).
//
// Every task project is classified by its sections:
//   status    every section is a status word (To Do, In Progress, Review, Done ✅, Waiting for Approval…).
//             Untouched, except sections with no status yet get one from their name.
//   category  the sections are categories (PATS X / PATS BSD / ROSI, DIAGEO / PRIMARIA, LOGO / IP LOGO…),
//             plus at most a Done/Selesai. → a single-select field "Category" (English project) or
//             "Kategori" (Indonesian project) whose options are the old section names (with colours), every
//             task gets its old section as value, the board becomes To Do / In Progress / Done (tasks placed
//             by their own Task.status: TODO → To-do, IN_PROGRESS/IN_REVIEW → In progress, DONE/CANCELLED →
//             Complete, manual order kept), and a shared Board view "By category" grouped by the field opens
//             first, so the old look is one click away. An existing select field that already lists every
//             section name (e.g. "Task type": Content / Production / Event) is reused instead.
//   calendar  a category project whose name says calendar/schedule (Master Calendar: EVENT / Content /
//             Production…). Same as category.
//   single    a category project with ONE category section ("Event Calendar", "Intoo"…): nothing to group
//             by, so it only becomes To Do / In Progress / Done (no field, no extra view).
//   mixed     real status sections plus category sections (Legal, Finance PATS Entertainment, Social Media
//             Nightlife…): the category sections become field options as above, status sections stay
//             statuses (a status section still bound to the default To-do group takes its word's status:
//             "Acc" → Done, "Ready for Acc" → In review); missing groups are added; "By category" is added
//             after the built-in views, Board stays the default.
//   pipeline  the project name says "Pipeline": the sections are stages, kept as status columns in their
//             order. First stage → To-do, the completion stage → Complete, the rest → In progress (review /
//             approval stages → In review, still the In-progress group). The completion stage is the last
//             stage whose name says it (Archiving, Post-Mortem, Posted, Done…); when there is one, an empty
//             trailing Done/Selesai added by the status migration is removed. No task moves.
//   dashboard Pipeline / Outlet Sales project types: untouched.
//
// References that pointed at a removed category section are rewritten: form answers mapped to "Section /
// list" now fill the field; form routing "Move to section X" becomes "Set field = X"; automations "Move to
// section X" become "Set field = X", conditions / field triggers on the section become conditions on the
// field; saved-view filters on those sections become filters on the field. In a "single" project they are
// dropped (the answer stays in the task description). Task.status is never changed.
//
// DRY RUN by default, inside a READ ONLY transaction: prints the plan and writes nothing. --apply writes
// everything in ONE transaction and first writes a JSON backup of every row it touches (sections, tasks,
// task links, forms, automations, views, field values) to --backup <file>. --rollback <file> undoes a
// conversion from that backup (tasks created since then in the new sections move to the first restored
// section; nothing is ever cascade-deleted). Idempotent: a converted project reads as "status" next time.
//
// Runs inside the app container (its own `pg` and DATABASE_URL):
//   docker exec -i <app> node - < scripts/convert-category-sections.cjs                          # plan
//   docker exec -i <app> node - --apply --backup /tmp/cat-backup.json < scripts/convert-category-sections.cjs
//   docker cp <app>:/tmp/cat-backup.json ~/backups/                                              # keep it
//   docker exec -i <app> node - --rollback /tmp/cat-backup.json < scripts/convert-category-sections.cjs
// Options: --only "<project name>" (repeatable) limits the run; --json prints the plan as JSON.
// DEV was converted on 12 Oct 2026 (docs: scratchpad category-conversion-dev.md). PROD: not run yet.
"use strict"

const { createRequire } = require("node:module")
const crypto = require("node:crypto")
const fs = require("node:fs")
const appRequire = createRequire("/app/package.json")
const pg = appRequire("pg")

const argv = process.argv.slice(2)
const APPLY = argv.includes("--apply")
const JSON_OUT = argv.includes("--json")
const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const ONLY = argv.reduce((acc, a, i) => (a === "--only" && argv[i + 1] ? [...acc, argv[i + 1]] : acc), [])
const BACKUP = argVal("--backup") || `/tmp/category-conversion-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
const ROLLBACK = argVal("--rollback")

// ── vocabulary ─────────────────────────────────────────────────────────────────────────────────────

const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, " ").replace(/\s+/g, " ").trim()

const STATUS_WORDS = {
  TODO: ["to do", "todo", "not started", "backlog", "belum mulai", "belum dikerjakan", "belum"],
  IN_PROGRESS: ["in progress", "on progress", "progress", "doing", "ongoing", "wip", "sedang jalan", "sedang dikerjakan", "proses", "dalam proses", "upload"],
  IN_REVIEW: ["review", "in review", "revisi", "revision", "waiting for approval", "ready for acc", "approval", "menunggu persetujuan"],
  DONE: ["done", "selesai", "complete", "completed", "finished", "acc", "approved"],
  CANCELLED: ["cancelled", "canceled", "batal", "dibatalkan"],
}
/** The status a section NAME stands for when the whole name is a status word, else null. */
function statusWord(name) {
  const n = norm(name)
  for (const [st, words] of Object.entries(STATUS_WORDS)) if (words.includes(n)) return st
  return null
}
const GROUP = { TODO: "todo", IN_PROGRESS: "in_progress", IN_REVIEW: "in_progress", DONE: "complete", CANCELLED: "complete" }
const isGenericDone = (name) => ["done", "selesai"].includes(norm(name))
const COMPLETION_STAGE = /(archiv|post mortem|postmortem|\bposted\b|\bdone\b|selesai|complete|closed|wrap up|wrapup)/
const REVIEW_STAGE = /\b(review|revisi|revision|approval|approve)\b/
const CALENDARISH = /(calendar|schedule|jadwal|kalender)/i
const ID_WORDS = /\b(harga|tanggal|pengajuan|selesai|belum|sedang|nama|jenis|kontrak|pihak|nominal|jadwal|tugas|lokasi|kota|penerima|syarat|jatuh tempo|durasi|pelunasan|akomodasi|perusahaan|jabatan|alamat|rekening|divisi|kategori)\b/i

// Notion's option colours, in the order the web rotates them when an option has none (lib/project-views.ts).
const PALETTE = ["orange", "yellow", "green", "blue", "purple", "pink", "red"]

function newId() {
  // cuid-shaped: "c" + 24 base36 characters (same shape as the ids Prisma makes).
  let s = ""
  const bytes = crypto.randomBytes(24)
  for (const b of bytes) s += (b % 36).toString(36)
  return "c" + s
}

// ── reading ────────────────────────────────────────────────────────────────────────────────────────

async function load(db) {
  const projects = (await db.query(`SELECT id, name, type, "tableColumns", "templateId" FROM "Project" ORDER BY name`)).rows
  const sections = (await db.query(`SELECT * FROM "TaskList" ORDER BY "projectId", position, "createdAt", id`)).rows
  const tasks = (await db.query(`SELECT id, "taskListId", position, status::text AS status, "parentId", "createdAt" FROM "Task" ORDER BY "taskListId", position, "createdAt", id`)).rows
  const links = (await db.query(`SELECT tp.id, tp."taskId", tp."projectId", tp."taskListId", tp.position, t.status::text AS status FROM "TaskProject" tp JOIN "Task" t ON t.id = tp."taskId" ORDER BY tp.position, tp."createdAt"`)).rows
  const fields = (await db.query(`SELECT id, name, type::text AS type, options, position, "projectId" FROM "CustomField" ORDER BY position`)).rows
  const forms = (await db.query(`SELECT id, name, "projectId", fields FROM "Form"`)).rows
  const autos = (await db.query(`SELECT id, name, "projectId", trigger, action, actions, conditions FROM "Automation"`)).rows
  const views = (await db.query(`SELECT * FROM "ProjectView" ORDER BY position, "createdAt"`)).rows
  const by = (rows, key) => rows.reduce((m, r) => (m.get(r[key]) ? m.get(r[key]).push(r) : m.set(r[key], [r]), m), new Map())
  return {
    projects,
    sectionsBy: by(sections, "projectId"),
    tasksBy: by(tasks, "taskListId"),
    linksBy: by(links, "taskListId"),
    fieldsBy: by(fields, "projectId"),
    formsBy: by(forms, "projectId"),
    autosBy: by(autos, "projectId"),
    viewsBy: by(views, "projectId"),
  }
}

// ── classification and plan ────────────────────────────────────────────────────────────────────────

function projectLang(p, secs, fields, forms) {
  const words = [...secs.map((s) => s.name), ...fields.map((f) => f.name), ...forms.map((f) => f.name)]
  let hits = 0
  for (const w of words) if (ID_WORDS.test(w)) hits++
  return hits >= 2 ? "id" : "en"
}

function choiceList(options) {
  if (!options) return []
  if (Array.isArray(options)) return options.map(String)
  if (Array.isArray(options.options)) return options.options.map(String)
  if (Array.isArray(options.choices)) return options.choices.map(String)
  return []
}

function classify(p, d) {
  const secs = d.sectionsBy.get(p.id) || []
  if (p.type === "PIPELINE" || p.type === "OUTLET_SALES") return { cls: "dashboard", secs }
  if (secs.length === 0) return { cls: "empty", secs }
  if (/pipeline/i.test(p.name)) return { cls: "pipeline", secs }
  const cats = secs.filter((s) => !statusWord(s.name))
  if (cats.length === 0) return { cls: "status", secs }
  const realStatus = secs.filter((s) => statusWord(s.name) && !isGenericDone(s.name))
  if (realStatus.length > 0) return { cls: "mixed", secs, cats }
  if (cats.length === 1) return { cls: "single", secs, cats }
  return { cls: CALENDARISH.test(p.name) ? "calendar" : "category", secs, cats }
}

const countTasks = (d, s) => (d.tasksBy.get(s.id) || []).length
const countLinks = (d, s) => (d.linksBy.get(s.id) || []).length

function planProject(p, d) {
  const c = classify(p, d)
  const plan = { projectId: p.id, name: p.name, cls: c.cls, bind: [], create: [], remove: [], order: [], moves: [], linkMoves: [], field: null, values: [], view: null, forms: [], autos: [], viewEdits: [], notes: [] }
  const secs = c.secs

  if (c.cls === "dashboard" || c.cls === "empty") return plan

  if (c.cls === "status") {
    for (const s of secs) if (!s.taskStatus) plan.bind.push({ id: s.id, name: s.name, from: null, to: statusWord(s.name) || "TODO" })
    return plan
  }

  if (c.cls === "pipeline") {
    // Trailing empty Done/Selesai sections (the status migration adds one) are candidates to drop.
    const trailing = []
    for (let i = secs.length - 1; i >= 0; i--) {
      const s = secs[i]
      if (isGenericDone(s.name) && countTasks(d, s) === 0 && countLinks(d, s) === 0) trailing.unshift(s)
      else break
    }
    const real = secs.filter((s) => !trailing.includes(s))
    let completion = -1
    for (let i = real.length - 1; i >= 1; i--) if (COMPLETION_STAGE.test(norm(real[i].name))) { completion = i; break }
    const want = new Map()
    real.forEach((s, i) => {
      if (i === 0) want.set(s.id, "TODO")
      else if (i === completion) want.set(s.id, "DONE")
      else if (REVIEW_STAGE.test(norm(s.name))) want.set(s.id, "IN_REVIEW")
      else want.set(s.id, "IN_PROGRESS")
    })
    if (completion >= 0) {
      for (const s of trailing) plan.remove.push({ id: s.id, name: s.name, why: `empty; "${real[completion].name}" is the completion stage` })
    } else {
      trailing.forEach((s) => want.set(s.id, "DONE"))
      if (!trailing.length) plan.notes.push("no completion stage and no Done section: nothing is in the Complete group")
    }
    for (const s of secs) {
      const to = want.get(s.id)
      if (to && to !== s.taskStatus) plan.bind.push({ id: s.id, name: s.name, from: s.taskStatus, to })
    }
    const off = real.filter((s) => want.get(s.id) !== "DONE").reduce((n, s) => n + (d.tasksBy.get(s.id) || []).filter((t) => t.status === "DONE").length, 0)
    if (off) plan.notes.push(`${off} task(s) are DONE but sit in an earlier stage (left where they are)`)
    return plan
  }

  // category / calendar / single / mixed
  const fields = d.fieldsBy.get(p.id) || []
  const forms = d.formsBy.get(p.id) || []
  const lang = projectLang(p, secs, fields, forms)
  plan.lang = lang
  const cats = c.cats
  const catIds = new Set(cats.map((s) => s.id))
  const statusSecs = secs.filter((s) => !catIds.has(s.id))

  // Status sections keep their status; one still on the default To-do group takes its word's status.
  const statusOf = new Map()
  for (const s of statusSecs) {
    const word = statusWord(s.name)
    const to = !s.taskStatus || (s.taskStatus === "TODO" && word && word !== "TODO") ? word || "TODO" : s.taskStatus
    statusOf.set(s.id, to)
    if (to !== s.taskStatus) plan.bind.push({ id: s.id, name: s.name, from: s.taskStatus, to })
  }
  // Names of the sections to add, in the style of the ones that exist.
  const idNames = statusSecs.some((s) => /^(selesai|belum|sedang)/.test(norm(s.name)))
  const NAMES = idNames
    ? { todo: "Belum mulai", in_progress: "Sedang jalan", complete: "Selesai" }
    : { todo: "To Do", in_progress: "In Progress", complete: "Done" }
  const STATUS_FOR = { todo: "TODO", in_progress: "IN_PROGRESS", complete: "DONE" }
  const groups = { todo: [], in_progress: [], complete: [] }
  for (const s of statusSecs) groups[GROUP[statusOf.get(s.id)]].push({ id: s.id, name: s.name, taskStatus: statusOf.get(s.id), existing: true })
  for (const g of ["todo", "in_progress", "complete"]) {
    if (groups[g].length) continue
    const sec = { id: newId(), name: NAMES[g], taskStatus: STATUS_FOR[g], existing: false }
    plan.create.push(sec)
    groups[g].push(sec)
  }
  const finalSecs = [...groups.todo, ...groups.in_progress, ...groups.complete]
  plan.order = finalSecs.map((s, i) => ({ id: s.id, name: s.name, position: i, taskStatus: s.taskStatus, existing: s.existing }))
  for (const s of cats) plan.remove.push({ id: s.id, name: s.name, tasks: countTasks(d, s), links: countLinks(d, s) })

  const target = (status) => {
    const exact = finalSecs.find((s) => s.taskStatus === status)
    if (exact) return exact
    return finalSecs.find((s) => GROUP[s.taskStatus] === GROUP[status]) || finalSecs[0]
  }

  // Tasks: appended after what the target section already holds, in (old section, old position) order.
  const nextPos = new Map(finalSecs.map((s) => [s.id, s.existing ? Math.max(-1, ...(d.tasksBy.get(s.id) || []).map((t) => t.position)) + 1 : 0]))
  const nextLinkPos = new Map(finalSecs.map((s) => [s.id, s.existing ? Math.max(-1, ...(d.linksBy.get(s.id) || []).map((t) => t.position)) + 1 : 0]))
  for (const cat of cats) {
    for (const t of d.tasksBy.get(cat.id) || []) {
      const to = target(t.status)
      const pos = nextPos.get(to.id)
      nextPos.set(to.id, pos + 1)
      plan.moves.push({ taskId: t.id, from: cat.id, to: to.id, toName: to.name, position: pos, category: cat.name, status: t.status, subtask: !!t.parentId })
    }
    for (const l of d.linksBy.get(cat.id) || []) {
      const to = target(l.status)
      const pos = nextLinkPos.get(to.id)
      nextLinkPos.set(to.id, pos + 1)
      plan.linkMoves.push({ linkId: l.id, taskId: l.taskId, from: cat.id, to: to.id, toName: to.name, position: pos, category: cat.name, status: l.status })
    }
  }

  let fieldOption = (catName) => catName
  if (c.cls === "single") {
    plan.notes.push(`one category section ("${cats[0].name}"): only statuses, no field and no extra view`)
  } else {
    const catNames = cats.map((s) => s.name)
    const reuse = fields.find((f) => (f.type === "SELECT") && catNames.every((n) => choiceList(f.options).some((o) => o.toLowerCase() === n.toLowerCase())))
    if (reuse) {
      plan.field = { id: reuse.id, name: reuse.name, reused: true, options: choiceList(reuse.options) }
    } else {
      let name = lang === "id" ? "Kategori" : "Category"
      while (fields.some((f) => f.name.toLowerCase() === name.toLowerCase())) name += " 2"
      const optionColors = {}
      catNames.forEach((n, i) => { optionColors[n] = cats[i].color || PALETTE[i % PALETTE.length] })
      plan.field = { id: newId(), name, reused: false, options: catNames, optionColors, position: Math.max(-1, ...fields.map((f) => f.position)) + 1 }
    }
    fieldOption = (catName) => plan.field.options.find((o) => o.toLowerCase() === catName.toLowerCase()) || catName
    for (const m of plan.moves) plan.values.push({ taskId: m.taskId, value: fieldOption(m.category) })
    for (const l of plan.linkMoves) if (!plan.values.some((v) => v.taskId === l.taskId)) plan.values.push({ taskId: l.taskId, value: fieldOption(l.category) })
    const isDefault = c.cls !== "mixed"
    plan.view = { id: newId(), name: lang === "id" ? "Per kategori" : "By category", isDefault }
  }

  // References to the removed sections.
  const catById = new Map(cats.map((s) => [s.id, s]))
  const catByName = new Map(cats.map((s) => [s.name.toLowerCase(), s]))
  const fieldRef = plan.field ? `cf:${plan.field.id}` : null
  for (const f of forms) {
    const list = Array.isArray(f.fields) ? f.fields : []
    let changed = false
    const notes = []
    const next = list.map((fld) => {
      let out = fld
      if (fld && fld.mapping && fld.mapping.target === "task_list") {
        const opts = Array.isArray(fld.options) ? fld.options.map(String) : []
        if (!opts.length || opts.some((o) => catByName.has(o.toLowerCase())) || !opts.some((o) => statusSecs.some((s) => s.name.toLowerCase() === o.toLowerCase()))) {
          changed = true
          // Only a choice answer can be a category; a file / text field mapped here never matched a section.
          const choice = /^(dropdown|select|radio|single_select|choice)$/i.test(String(fld.type || ""))
          const label = String(fld.name || fld.label || "").trim()
          if (plan.field && choice) { out = { ...out, mapping: { target: "custom_field", customFieldId: plan.field.id } }; notes.push(`"${label}" answer → ${plan.field.name}`) }
          else { out = { ...out, mapping: { target: "none" } }; notes.push(`"${label}" (${fld.type || "field"}) no longer picks a section`) }
        }
      }
      if (fld && Array.isArray(fld.routingRules) && fld.routingRules.some((r) => r && r.action === "set_task_list" && catById.has(r.targetTaskListId))) {
        changed = true
        const rules = []
        for (const r of fld.routingRules) {
          if (!(r && r.action === "set_task_list" && catById.has(r.targetTaskListId))) { rules.push(r); continue }
          const cat = catById.get(r.targetTaskListId)
          if (plan.field) {
            const { targetTaskListId, ...rest } = r
            rules.push({ ...rest, action: "set_field", targetCustomFieldId: plan.field.id, targetValue: fieldOption(cat.name) })
            notes.push(`routing "move to ${cat.name}" → set ${plan.field.name} = ${fieldOption(cat.name)}`)
          } else notes.push(`routing "move to ${cat.name}" dropped`)
        }
        out = { ...out, routingRules: rules }
      }
      return out
    })
    if (changed) plan.forms.push({ id: f.id, name: f.name, before: f.fields, after: next, notes: [...new Set(notes)] })
  }
  for (const a of d.autosBy.get(p.id) || []) {
    const notes = []
    const fixRule = (r) => {
      if (!r || typeof r !== "object") return r
      const type = String(r.type || "").toUpperCase()
      if ((type === "MOVE_TO_SECTION" || type === "MOVE") && catById.has(r.value)) {
        const cat = catById.get(r.value)
        if (fieldRef) { notes.push(`"move to ${cat.name}" → set ${plan.field.name} = ${cat.name}`); return { type: "SET_FIELD", field: fieldRef, value: fieldOption(cat.name) } }
        notes.push(`"move to ${cat.name}" → move to ${target("TODO").name}`); return { ...r, value: target("TODO").id }
      }
      if (r.config && catById.has(r.config.sectionId)) {
        notes.push(`${type} section "${catById.get(r.config.sectionId).name}" → first section`)
        const { sectionId, ...cfg } = r.config
        return { ...r, config: cfg }
      }
      if (type === "FIELD_CHANGED" && r.field === "section" && catById.has(r.value) && fieldRef) {
        notes.push(`trigger "section becomes ${catById.get(r.value).name}" → ${plan.field.name}`)
        return { ...r, field: fieldRef, value: fieldOption(catById.get(r.value).name) }
      }
      return r
    }
    const trigger = fixRule(a.trigger)
    const action = fixRule(a.action)
    const actions = Array.isArray(a.actions) ? a.actions.map(fixRule) : a.actions
    let conditions = a.conditions
    if (conditions && Array.isArray(conditions.rules)) {
      conditions = { ...conditions, rules: conditions.rules.map((r) => {
        if (r && r.field === "section" && catById.has(r.value)) {
          if (fieldRef) { notes.push(`condition "section is ${catById.get(r.value).name}" → ${plan.field.name}`); return { ...r, field: fieldRef, value: fieldOption(catById.get(r.value).name) } }
          notes.push(`condition on section "${catById.get(r.value).name}" left (never matches)`)
        }
        return r
      }) }
    }
    if (notes.length) plan.autos.push({ id: a.id, name: a.name, before: { trigger: a.trigger, action: a.action, actions: a.actions, conditions: a.conditions }, after: { trigger, action, actions, conditions }, notes })
  }
  for (const v of d.viewsBy.get(p.id) || []) {
    const cfg = v.config || {}
    let touched = false
    const fixRules = (rules) => (Array.isArray(rules) ? rules.map((r) => {
      if (r && Array.isArray(r.rules)) return { ...r, rules: fixRules(r.rules) }
      if (r && r.prop === "section") {
        const vals = Array.isArray(r.value) ? r.value : typeof r.value === "string" ? [r.value] : []
        if (vals.some((x) => catById.has(x)) && fieldRef) {
          touched = true
          const mapped = vals.map((x) => (catById.has(x) ? fieldOption(catById.get(x).name) : null)).filter(Boolean)
          return { ...r, prop: fieldRef, value: Array.isArray(r.value) ? mapped : mapped[0] }
        }
      }
      return r
    }) : rules)
    if (cfg.filter) {
      const filter = { ...cfg.filter, simple: fixRules(cfg.filter.simple), advanced: cfg.filter.advanced ? { ...cfg.filter.advanced, rules: fixRules(cfg.filter.advanced.rules) } : cfg.filter.advanced }
      if (touched) plan.viewEdits.push({ id: v.id, before: cfg, after: { ...cfg, filter } })
    }
  }
  return plan
}

// ── printing ───────────────────────────────────────────────────────────────────────────────────────

function printPlan(plans) {
  const counts = {}
  for (const p of plans) counts[p.cls] = (counts[p.cls] || 0) + 1
  console.log(`Projects: ${plans.length}  ` + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  "))
  for (const p of plans) {
    const busy = p.bind.length + p.create.length + p.remove.length + p.moves.length + p.linkMoves.length + p.forms.length + p.autos.length + p.viewEdits.length
    if (!busy && (p.cls === "status" || p.cls === "dashboard" || p.cls === "empty")) continue
    console.log(`\n## ${p.name}  [${p.cls}${p.lang ? `, ${p.lang}` : ""}]`)
    if (p.order.length) console.log(`  columns: ${p.order.map((s) => `${s.name}${s.existing ? "" : " (new)"}→${s.taskStatus}`).join(" | ")}`)
    for (const b of p.bind) console.log(`  bind    ${b.name}: ${b.from ?? "-"} → ${b.to}`)
    for (const r of p.remove) console.log(`  remove  ${r.name}${r.tasks !== undefined ? ` (${r.tasks} task(s), ${r.links} link(s) moved)` : ""}${r.why ? ` — ${r.why}` : ""}`)
    if (p.field) console.log(`  field   ${p.field.reused ? "reuse" : "create"} "${p.field.name}" options: ${p.field.options.join(" / ")}`)
    if (p.moves.length) {
      const by = {}
      for (const m of p.moves) by[`${m.category} → ${m.toName}`] = (by[`${m.category} → ${m.toName}`] || 0) + 1
      console.log(`  tasks   ${p.moves.length}: ` + Object.entries(by).map(([k, v]) => `${k} ×${v}`).join("; "))
    }
    if (p.linkMoves.length) console.log(`  links   ${p.linkMoves.length} task(s) shown here from other projects re-placed by status`)
    if (p.view) console.log(`  view    "${p.view.name}" (Board grouped by ${p.field.name})${p.view.isDefault ? " — opens first" : ""}`)
    for (const f of p.forms) console.log(`  form    ${f.name}: ${f.notes.join("; ")}`)
    for (const a of p.autos) console.log(`  auto    ${a.name}: ${a.notes.join("; ")}`)
    for (const v of p.viewEdits) console.log(`  view    ${v.id}: filter on removed sections → field`)
    for (const n of p.notes) console.log(`  note    ${n}`)
  }
}

// ── applying ───────────────────────────────────────────────────────────────────────────────────────

const BUILTINS = ["board", "list", "table", "calendar", "timeline"]
function builtinSeed(key, tableColumns) {
  switch (key) {
    case "board": return { layout: "board", config: { groupBy: "section", showSubtasks: true } }
    case "list": return { layout: "list", config: { groupBy: "section", showSubtasks: true } }
    case "table": {
      const cols = Array.isArray(tableColumns) ? tableColumns.filter((c) => typeof c === "string") : []
      const visible = cols.map((c) => (c === "dueDate" ? "due" : c)).filter((c) => /^(title|section|status|priority|assignee|due|start|tags|created|updated|subtasks|comments|cf:[A-Za-z0-9_-]{1,64})$/.test(c))
      return { layout: "table", config: { groupBy: "section", ...(visible.length ? { visibleProps: visible } : {}) } }
    }
    case "calendar": return { layout: "calendar", config: { dateProp: "due" } }
    default: return { layout: "timeline", config: { groupBy: "section", startProp: "start", endProp: "due" } }
  }
}

async function snapshot(db, plans, d) {
  const out = { version: 1, kind: "category-conversion", createdAt: new Date().toISOString(), projects: [] }
  for (const p of plans) {
    if (!(p.bind.length || p.create.length || p.remove.length || p.moves.length || p.linkMoves.length || p.field || p.view || p.forms.length || p.autos.length || p.viewEdits.length)) continue
    const secIds = (d.sectionsBy.get(p.projectId) || []).map((s) => s.id)
    const sections = (await db.query(`SELECT * FROM "TaskList" WHERE "projectId" = $1`, [p.projectId])).rows
    const tasks = secIds.length ? (await db.query(`SELECT id, "taskListId", position FROM "Task" WHERE "taskListId" = ANY($1)`, [secIds])).rows : []
    const links = secIds.length ? (await db.query(`SELECT id, "taskListId", position FROM "TaskProject" WHERE "taskListId" = ANY($1)`, [secIds])).rows : []
    const views = (await db.query(`SELECT id, position, config FROM "ProjectView" WHERE "projectId" = $1`, [p.projectId])).rows
    let fieldValues = null
    if (p.field && p.field.reused) {
      fieldValues = (await db.query(`SELECT "taskId", value FROM "CustomFieldValue" WHERE "customFieldId" = $1`, [p.field.id])).rows
    }
    const fieldRow = p.field && p.field.reused ? (await db.query(`SELECT id, options FROM "CustomField" WHERE id = $1`, [p.field.id])).rows[0] : null
    out.projects.push({
      projectId: p.projectId, name: p.name, cls: p.cls,
      sections, tasks, links, views,
      forms: p.forms.map((f) => ({ id: f.id, fields: f.before })),
      automations: p.autos.map((a) => ({ id: a.id, ...a.before })),
      createdSectionIds: p.create.map((s) => s.id),
      createdFieldId: p.field && !p.field.reused ? p.field.id : null,
      reusedField: fieldRow ? { id: fieldRow.id, options: fieldRow.options, values: fieldValues } : null,
      createdViewIds: p.view ? [p.view.id] : [],
      createdBuiltinViews: [],
    })
  }
  return out
}

async function applyPlan(db, p, d, backupEntry) {
  const now = new Date()
  // 1. status bindings of sections that stay
  for (const b of p.bind) await db.query(`UPDATE "TaskList" SET "taskStatus" = $2::"TaskStatus", "updatedAt" = $3 WHERE id = $1`, [b.id, b.to, now])
  // 2. new status sections
  for (const s of p.create) {
    const pos = p.order.find((o) => o.id === s.id).position
    await db.query(`INSERT INTO "TaskList" (id, name, position, "projectId", "taskStatus", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5::"TaskStatus", $6, $6)`, [s.id, s.name, pos, p.projectId, s.taskStatus, now])
  }
  // 3. final column order of the sections that stay
  for (const o of p.order) if (o.existing) await db.query(`UPDATE "TaskList" SET position = $2, "updatedAt" = $3 WHERE id = $1`, [o.id, o.position, now])
  // 4. the field
  if (p.field && !p.field.reused) {
    await db.query(`INSERT INTO "CustomField" (id, name, type, options, position, "projectId") VALUES ($1, $2, 'SELECT', $3::jsonb, $4, $5)`,
      [p.field.id, p.field.name, JSON.stringify({ options: p.field.options, optionColors: p.field.optionColors }), p.field.position, p.projectId])
  }
  // 5. values (a reused field keeps a value it already has)
  for (const v of p.values) {
    await db.query(`INSERT INTO "CustomFieldValue" (id, value, "customFieldId", "taskId") VALUES ($1, $2, $3, $4) ON CONFLICT ("customFieldId", "taskId") DO UPDATE SET value = EXCLUDED.value WHERE "CustomFieldValue".value IS NULL OR "CustomFieldValue".value = ''`,
      [newId(), v.value, p.field.id, v.taskId])
  }
  // 6. tasks and task links out of the category sections
  for (const m of p.moves) await db.query(`UPDATE "Task" SET "taskListId" = $2, position = $3 WHERE id = $1`, [m.taskId, m.to, m.position])
  for (const l of p.linkMoves) await db.query(`UPDATE "TaskProject" SET "taskListId" = $2, position = $3 WHERE id = $1`, [l.linkId, l.to, l.position])
  // 7. forms, automations, views that named a removed section
  for (const f of p.forms) await db.query(`UPDATE "Form" SET fields = $2::jsonb, "updatedAt" = $3 WHERE id = $1`, [f.id, JSON.stringify(f.after), now])
  for (const a of p.autos) await db.query(`UPDATE "Automation" SET trigger = $2::jsonb, action = $3::jsonb, actions = $4::jsonb, conditions = $5::jsonb, "updatedAt" = $6 WHERE id = $1`,
    [a.id, JSON.stringify(a.after.trigger), JSON.stringify(a.after.action), a.after.actions == null ? null : JSON.stringify(a.after.actions), a.after.conditions == null ? null : JSON.stringify(a.after.conditions), now])
  for (const v of p.viewEdits) await db.query(`UPDATE "ProjectView" SET config = $2::jsonb, "updatedAt" = $3 WHERE id = $1`, [v.id, JSON.stringify(v.after), now])
  // 8. remove the old sections — only when nothing is left in them (a cascade would delete tasks)
  for (const r of p.remove) {
    const left = (await db.query(`SELECT (SELECT count(*) FROM "Task" WHERE "taskListId" = $1)::int AS t, (SELECT count(*) FROM "TaskProject" WHERE "taskListId" = $1)::int AS l`, [r.id])).rows[0]
    if (left.t || left.l) throw new Error(`${p.name}: section "${r.name}" still holds ${left.t} task(s) / ${left.l} link(s); nothing written`)
    await db.query(`DELETE FROM "TaskList" WHERE id = $1`, [r.id])
  }
  // 9. views: the built-ins (made here so the order is right) and "By category"
  if (p.view) {
    const views = d.viewsBy.get(p.projectId) || []
    const project = d.projects.find((x) => x.id === p.projectId)
    const have = new Set(views.filter((v) => v.builtin && v.ownerId === null).map((v) => v.builtin))
    const shift = p.view.isDefault && views.length === 0 ? 1 : 0
    for (const key of BUILTINS) {
      if (have.has(key)) continue
      const seed = builtinSeed(key, project.tableColumns)
      const id = newId()
      const r = await db.query(`INSERT INTO "ProjectView" (id, name, layout, builtin, position, config, "createdAt", "updatedAt", "projectId", "ownerId") VALUES ($1, NULL, $2, $3, $4, $5::jsonb, $6, $6, $7, NULL) ON CONFLICT ("projectId", builtin) WHERE builtin IS NOT NULL DO NOTHING RETURNING id`,
        [id, seed.layout, key, BUILTINS.indexOf(key) + shift, JSON.stringify(seed.config), now, p.projectId])
      if (r.rows.length) backupEntry.createdBuiltinViews.push(id)
    }
    const positions = views.map((v) => v.position)
    const pos = views.length === 0 ? (p.view.isDefault ? 0 : BUILTINS.length) : p.view.isDefault ? Math.min(...positions) - 1 : Math.max(...positions) + 1
    await db.query(`INSERT INTO "ProjectView" (id, name, layout, builtin, position, config, "createdAt", "updatedAt", "projectId", "ownerId") VALUES ($1, $2, 'board', 'category', $3, $4::jsonb, $5, $5, $6, NULL) ON CONFLICT ("projectId", builtin) WHERE builtin IS NOT NULL DO NOTHING`,
      [p.view.id, p.view.name, pos, JSON.stringify({ groupBy: `cf:${p.field.id}`, showSubtasks: true }), now, p.projectId])
  }
}

// ── rollback ───────────────────────────────────────────────────────────────────────────────────────

async function rollback(db, backup) {
  for (const p of backup.projects) {
    console.log(`rollback ${p.name} [${p.cls}]`)
    const cols = (row) => Object.keys(row)
    // sections back (re-created with their old ids when removed)
    for (const s of p.sections) {
      const exists = (await db.query(`SELECT 1 FROM "TaskList" WHERE id = $1`, [s.id])).rows.length
      if (exists) {
        await db.query(`UPDATE "TaskList" SET name = $2, position = $3, "taskStatus" = $4::"TaskStatus", color = $5, "updatedAt" = now() WHERE id = $1`, [s.id, s.name, s.position, s.taskStatus, s.color ?? null])
      } else {
        const keys = cols(s)
        await db.query(`INSERT INTO "TaskList" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map((k, i) => (k === "taskStatus" ? `$${i + 1}::"TaskStatus"` : `$${i + 1}`)).join(", ")})`, keys.map((k) => s[k]))
      }
    }
    for (const t of p.tasks) await db.query(`UPDATE "Task" SET "taskListId" = $2, position = $3 WHERE id = $1`, [t.id, t.taskListId, t.position])
    for (const l of p.links) await db.query(`UPDATE "TaskProject" SET "taskListId" = $2, position = $3 WHERE id = $1`, [l.id, l.taskListId, l.position])
    for (const f of p.forms) await db.query(`UPDATE "Form" SET fields = $2::jsonb WHERE id = $1`, [f.id, JSON.stringify(f.fields)])
    for (const a of p.automations) await db.query(`UPDATE "Automation" SET trigger = $2::jsonb, action = $3::jsonb, actions = $4::jsonb, conditions = $5::jsonb WHERE id = $1`,
      [a.id, JSON.stringify(a.trigger), JSON.stringify(a.action), a.actions == null ? null : JSON.stringify(a.actions), a.conditions == null ? null : JSON.stringify(a.conditions)])
    for (const v of p.views) await db.query(`UPDATE "ProjectView" SET position = $2, config = $3::jsonb WHERE id = $1`, [v.id, v.position, JSON.stringify(v.config)])
    const dropViews = [...p.createdViewIds, ...(p.createdBuiltinViews || [])]
    if (dropViews.length) await db.query(`DELETE FROM "ProjectView" WHERE id = ANY($1)`, [dropViews])
    if (p.createdFieldId) await db.query(`DELETE FROM "CustomField" WHERE id = $1`, [p.createdFieldId])
    if (p.reusedField) {
      const before = new Map((p.reusedField.values || []).map((v) => [v.taskId, v.value]))
      const now = (await db.query(`SELECT "taskId", value FROM "CustomFieldValue" WHERE "customFieldId" = $1`, [p.reusedField.id])).rows
      for (const v of now) {
        if (!before.has(v.taskId)) await db.query(`DELETE FROM "CustomFieldValue" WHERE "customFieldId" = $1 AND "taskId" = $2`, [p.reusedField.id, v.taskId])
        else if (before.get(v.taskId) !== v.value) await db.query(`UPDATE "CustomFieldValue" SET value = $3 WHERE "customFieldId" = $1 AND "taskId" = $2`, [p.reusedField.id, v.taskId, before.get(v.taskId)])
      }
    }
    // sections this conversion added: anything made in them since moves to the first restored section
    if (p.createdSectionIds.length) {
      const first = [...p.sections].sort((a, b) => a.position - b.position)[0]
      const moved = await db.query(`UPDATE "Task" SET "taskListId" = $2 WHERE "taskListId" = ANY($1) RETURNING id`, [p.createdSectionIds, first.id])
      await db.query(`UPDATE "TaskProject" SET "taskListId" = $2 WHERE "taskListId" = ANY($1)`, [p.createdSectionIds, first.id])
      if (moved.rows.length) console.log(`  ${moved.rows.length} task(s) made after the conversion moved to "${first.name}"`)
      await db.query(`DELETE FROM "TaskList" WHERE id = ANY($1)`, [p.createdSectionIds])
    }
  }
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try {
    if (ROLLBACK) {
      const backup = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"))
      if (backup.kind !== "category-conversion") throw new Error("not a category-conversion backup")
      await db.query("BEGIN")
      await rollback(db, backup)
      if (APPLY) { await db.query("COMMIT"); console.log("Rolled back.") } else { await db.query("ROLLBACK"); console.log("Rollback DRY RUN ok (add --apply to write).") }
      return
    }
    await db.query(APPLY ? "BEGIN" : "BEGIN READ ONLY")
    const d = await load(db)
    const projects = d.projects.filter((p) => !ONLY.length || ONLY.includes(p.name))
    const plans = projects.map((p) => planProject(p, d))
    if (JSON_OUT) console.log(JSON.stringify(plans.map((p) => ({ ...p, moves: p.moves.length, linkMoves: p.linkMoves.length, values: p.values.length, forms: p.forms.map((f) => ({ name: f.name, notes: f.notes })), autos: p.autos.map((a) => ({ name: a.name, notes: a.notes })) })), null, 2))
    else printPlan(plans)
    if (!APPLY) { await db.query("ROLLBACK"); console.log("\nDRY RUN — nothing written. Add --apply (and --backup <file>) to write."); return }
    const backup = await snapshot(db, plans, d)
    for (const p of plans) {
      const entry = backup.projects.find((b) => b.projectId === p.projectId)
      if (entry) await applyPlan(db, p, d, entry)
    }
    fs.writeFileSync(BACKUP, JSON.stringify(backup))
    await db.query("COMMIT")
    fs.writeFileSync(BACKUP, JSON.stringify(backup)) // again, now with the built-in views that were made
    console.log(`\nApplied to ${backup.projects.length} project(s). Backup: ${BACKUP}`)
  } catch (e) {
    try { await db.query("ROLLBACK") } catch { /* ignore */ }
    throw e
  } finally {
    await db.end()
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1) })
