/**
 * Project templates (owner, 12 Oct 2026, DEV item #8): the "New project" gallery, Notion style.
 *
 * Every template here is DATA. It builds an ordinary Task Project (Project.type "TASK") out of the
 * machinery that already exists: sections (TaskList, now with an optional taskStatus), custom fields,
 * the tabs it shows (Project.hiddenTabs), the Table tab's columns (Project.tableColumns) and optional
 * starter pages (Doc) and tasks. Adding a template = adding an entry to PROJECT_TEMPLATES; the web
 * gallery reads GET /api/project-templates and draws the card and its mini preview from this data, so
 * no UI code changes. POST /api/projects { templateId } builds it in one transaction
 * (lib/project-template-apply.ts).
 *
 * Property sets follow the Notion study of 12 Oct 2026 (scratchpad notion-stage4/schemas.txt, the
 * template picker in notion-stage4/b_more.*, notion-stage3/INVENTORY.md). How Notion maps to NEXUS:
 *  - Title → the task title. Text body → the task description.
 *  - Status (Notion "status" type) → the SECTIONS, one per option, in Notion's board order. Each section
 *    carries the NEXUS task status its group means (To-do → TODO, In progress → IN_PROGRESS, …), so a
 *    card moved to "Published" is DONE for reports, Overview and the apps (api/tasks PATCH).
 *  - Person (Owner, Assignee, Attendees, Event owner) → the task's assignees. NEXUS has no people field.
 *  - The main deadline date → the task's due date (reminders, Overview, calendar). Other dates → DATE fields.
 *  - Priority → the built-in priority. Upvote → the built-in like. Relation "Project" → "Also in projects".
 *  - Created by / Created time → one CREATED field. Formula, rollup and button are not carried over.
 * Every option list is Notion's own, so a project starts with the same vocabulary and no sample rows.
 *
 * Text is { en, id }: the gallery shows the reader's language and the project is built in the language
 * of the person creating it (POST body `lang`, default "id" like the web).
 *
 * Plain TypeScript with no imports so `node --experimental-strip-types` can load it in the unit test.
 */

export type TemplateLang = "en" | "id"
export type L = { en: string; id: string }
export type TemplateColor = "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red"
export type TemplateTaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"
export type TemplateFieldType = "TEXT" | "URL" | "FILE" | "NUMBER" | "SELECT" | "MULTI_SELECT" | "DATE" | "CREATED" | "PLACE"
/** Same keys as PROJECT_TAB_KEYS (lib/project-tabs.ts), minus the retired "sprints". */
export type TemplateTab = "overview" | "board" | "list" | "table" | "sheet" | "calendar" | "timeline" | "automations" | "pages" | "forms" | "chat"
/** A Table column: a built-in (ProjectTableView BUILTIN keys) or "cf:<field key>" of this template. */
export type TemplateColumn = "assignee" | "dueDate" | "priority" | "status" | "tags" | `cf:${string}`
export type TemplateCategory = "marketing" | "projects" | "docs" | "planning" | "operations"

export interface TemplateOption { label: L; color?: TemplateColor }
export interface TemplateField {
  /** Stable within the template; used by tableColumns, calendarBy and the preview. */
  key: string
  name: L
  type: TemplateFieldType
  options?: TemplateOption[]
  /** NUMBER only. */
  format?: "currency-idr"
}
export interface TemplateSection { name: L; status?: TemplateTaskStatus; color?: TemplateColor }
/** A Notion property that lands on a NEXUS built-in; shown on the card so people recognise it. */
export interface TemplateBuiltin { key: "assignee" | "dueDate" | "priority" | "tags" | "likes" | "projects" | "description"; name: L }
export type TemplateBlock =
  | { h: L }
  | { p: L }
  | { bullets: L[] }
  | { todo: L[] }
export interface TemplateDoc { title: L; icon?: string; blocks: TemplateBlock[] }
export interface TemplateTask { title: L; section?: number; description?: L }

export interface ProjectTemplate {
  id: string
  category: TemplateCategory
  name: L
  blurb: L
  /** lucide-react icon name (PascalCase); the web maps the ones it knows and falls back to a checklist. */
  icon: string
  tint: TemplateColor
  /** Project.color for the created project. */
  color: string
  sections: TemplateSection[]
  fields: TemplateField[]
  builtins: TemplateBuiltin[]
  /** Tabs shown; every other tab starts hidden (hiding never deletes; people change it later). */
  tabs: TemplateTab[]
  /** The tab the project opens on. */
  defaultTab: TemplateTab
  tableColumns: TemplateColumn[]
  /** What the Calendar tab plots: the due date (default) or a DATE field of this template. */
  calendarBy?: "dueDate" | `cf:${string}`
  /** A "mine" preset (Notion's "My meetings"): the header offers it, filtering on assignee = me. */
  myView?: { name: L; tab: "list" | "table" | "board" }
  preview: { layout: "board" | "table" | "calendar" | "list" | "gallery"; columns?: string[] }
  starterDocs?: TemplateDoc[]
  starterTasks?: TemplateTask[]
}

const l = (en: string, id: string): L => ({ en, id })
const o = (en: string, color?: TemplateColor, id = en): TemplateOption => ({ label: { en, id }, color })

// Shared vocabularies ---------------------------------------------------------------------------------

/** Notion's default three-step status (Tasks, Docs, Goals, Tasks Tracker). */
const NOT_STARTED_DONE: TemplateSection[] = [
  { name: l("Not started", "Belum mulai"), status: "TODO", color: "gray" },
  { name: l("In progress", "Sedang jalan"), status: "IN_PROGRESS", color: "blue" },
  { name: l("Done", "Selesai"), status: "DONE", color: "green" },
]

const ASSIGNEE = (en: string, id: string): TemplateBuiltin => ({ key: "assignee", name: l(en, id) })
const DUE = (en: string, id: string): TemplateBuiltin => ({ key: "dueDate", name: l(en, id) })
const PRIORITY: TemplateBuiltin = { key: "priority", name: l("Priority", "Prioritas") }

// The registry -----------------------------------------------------------------------------------------

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  // Owner's spec (12 Oct 2026), in place of the "Content Planner — coming soon" card. Vocabulary from
  // Notion's Content Calendar (Content type, Platform).
  {
    id: "content-plan",
    category: "marketing",
    name: l("Content Plan", "Content Plan"),
    blurb: l("Plan, make and publish content across your channels.", "Rencanakan, produksi, dan terbitkan konten di semua channel."),
    icon: "CalendarRange",
    tint: "purple",
    color: "#7B2FBE",
    sections: [
      { name: l("Idea", "Ide"), status: "TODO", color: "gray" },
      { name: l("In progress", "Sedang dikerjakan"), status: "IN_PROGRESS", color: "blue" },
      { name: l("In review", "Direview"), status: "IN_REVIEW", color: "purple" },
      { name: l("Published", "Terbit"), status: "DONE", color: "green" },
    ],
    fields: [
      {
        key: "type", name: l("Type", "Tipe"), type: "MULTI_SELECT",
        options: [o("Live stream", "gray"), o("Long form video", "purple", "Video panjang"), o("Story / short form video", "gray", "Story / video pendek"), o("Social post", "red", "Post sosmed"), o("Podcast (video)", "pink"), o("Podcast (audio)", "orange"), o("Blog article", "blue", "Artikel blog")],
      },
      {
        key: "platform", name: l("Platform", "Platform"), type: "MULTI_SELECT",
        options: [o("Instagram", "purple"), o("TikTok", "yellow"), o("YouTube", "gray"), o("X", "blue"), o("LinkedIn", "gray"), o("Spotify", "pink"), o("Email", "red"), o("Blog / website", "orange")],
      },
      { key: "publicationDate", name: l("Publication date", "Tanggal tayang"), type: "DATE" },
      { key: "link", name: l("Link", "Link"), type: "URL" },
      { key: "media", name: l("Media", "Media"), type: "FILE" },
    ],
    builtins: [ASSIGNEE("Assign", "Assign"), DUE("Deadline", "Deadline")],
    tabs: ["overview", "board", "table", "calendar", "pages", "chat"],
    defaultTab: "board",
    tableColumns: ["status", "assignee", "dueDate", "cf:publicationDate", "cf:type", "cf:platform", "cf:link", "cf:media"],
    calendarBy: "cf:publicationDate",
    preview: { layout: "board", columns: ["cf:platform"] },
    starterDocs: [
      {
        title: l("Content guidelines", "Panduan konten"), icon: "📝",
        blocks: [
          { p: l("Write down how this channel sounds, so every post reads like the same brand.", "Tulis gaya bahasa channel ini, supaya semua post terdengar dari brand yang sama.") },
          { h: l("Voice and tone", "Gaya bahasa") },
          { bullets: [l("", "")] },
          { h: l("Formats we post", "Format yang kita posting") },
          { bullets: [l("", "")] },
          { h: l("Before publishing", "Sebelum terbit") },
          { todo: [l("Caption checked", "Caption sudah dicek"), l("Visual approved", "Visual sudah di-approve"), l("Publication date set", "Tanggal tayang sudah diisi"), l("Link added after posting", "Link diisi setelah tayang")] },
        ],
      },
    ],
  },
  {
    id: "social-media",
    category: "marketing",
    name: l("Social Media Planner", "Social Media Planner"),
    blurb: l("Organize and schedule social posts.", "Atur dan jadwalkan post media sosial."),
    icon: "Megaphone",
    tint: "pink",
    color: "#DB2777",
    sections: [
      { name: l("Post idea", "Ide post"), status: "TODO", color: "gray" },
      { name: l("Draft", "Draft"), status: "IN_PROGRESS", color: "yellow" },
      { name: l("Ready for review", "Siap direview"), status: "IN_REVIEW", color: "purple" },
      { name: l("Scheduled", "Terjadwal"), status: "IN_PROGRESS", color: "blue" },
      { name: l("Published", "Terbit"), status: "DONE", color: "green" },
      { name: l("Cancelled", "Batal"), status: "CANCELLED", color: "red" },
    ],
    fields: [
      { key: "postDate", name: l("Post date", "Tanggal post"), type: "DATE" },
      {
        key: "platform", name: l("Platform", "Platform"), type: "MULTI_SELECT",
        options: [o("LinkedIn", "brown"), o("TikTok", "gray"), o("X", "blue"), o("YouTube", "red"), o("Instagram", "green")],
      },
      {
        key: "contentType", name: l("Content type", "Jenis konten"), type: "MULTI_SELECT",
        options: [o("Text", "yellow", "Teks"), o("Image / photo", "orange", "Gambar / foto"), o("Video", "blue"), o("Link", "purple"), o("Carousel", "red"), o("Poll", "brown", "Polling"), o("Story", "gray"), o("Live stream", "pink")],
      },
      { key: "postUrl", name: l("Post URL", "URL post"), type: "URL" },
    ],
    builtins: [ASSIGNEE("Owner", "Owner")],
    tabs: ["overview", "board", "table", "calendar", "chat"],
    defaultTab: "calendar",
    tableColumns: ["assignee", "status", "cf:postDate", "cf:platform", "cf:contentType", "cf:postUrl"],
    calendarBy: "cf:postDate",
    preview: { layout: "calendar" },
  },
  {
    id: "campaign",
    category: "marketing",
    name: l("Campaign Management", "Campaign Management"),
    blurb: l("Plan and deliver winning campaigns.", "Rencanakan dan jalankan campaign sampai tuntas."),
    icon: "Target",
    tint: "orange",
    color: "#EA580C",
    // Notion's board order. A campaign in flight is still running, so it counts as in progress
    // (Notion files it under Complete; changed 12 Oct 2026 so live work is not reported as finished).
    sections: [
      { name: l("Blocked", "Terhambat"), status: "TODO", color: "red" },
      { name: l("Not started", "Belum mulai"), status: "TODO", color: "gray" },
      { name: l("Planning", "Perencanaan"), status: "IN_PROGRESS", color: "yellow" },
      { name: l("On hold", "Ditahan"), status: "IN_PROGRESS", color: "orange" },
      { name: l("In production", "Produksi"), status: "IN_PROGRESS", color: "purple" },
      { name: l("In flight", "Sedang tayang"), status: "IN_PROGRESS", color: "blue" },
      { name: l("Complete", "Selesai"), status: "DONE", color: "green" },
    ],
    fields: [
      {
        key: "campaignType", name: l("Campaign type", "Jenis campaign"), type: "MULTI_SELECT",
        options: [o("Product launch", "gray"), o("Brand awareness", "brown"), o("Lead generation", "blue"), o("Sales promotion", "green"), o("Content marketing", "yellow"), o("Email marketing", "gray")],
      },
      {
        key: "audiences", name: l("Audiences targeted", "Target audiens"), type: "MULTI_SELECT",
        options: [o("Demographic 1", "yellow", "Demografi 1"), o("Demographic 2", "blue", "Demografi 2"), o("Demographic 3", "red", "Demografi 3")],
      },
      {
        key: "markets", name: l("Markets", "Pasar"), type: "MULTI_SELECT",
        options: [o("AMER", "orange"), o("EMEA", "gray"), o("APAC", "purple"), o("UK", "yellow"), o("FR", "brown"), o("LATAM", "green")],
      },
      {
        key: "channels", name: l("Channels", "Channel"), type: "MULTI_SELECT",
        options: [o("Blog", "green"), o("Email", "yellow"), o("Instagram", "purple"), o("X", "gray"), o("TikTok", "purple"), o("LinkedIn", "blue"), o("Google", "brown")],
      },
      { key: "budget", name: l("Budget", "Budget"), type: "NUMBER", format: "currency-idr" },
      { key: "startDate", name: l("Start date", "Tanggal mulai"), type: "DATE" },
      { key: "files", name: l("Files & media", "File & media"), type: "FILE" },
    ],
    builtins: [ASSIGNEE("Owner", "Owner"), DUE("Completion date", "Tanggal selesai")],
    tabs: ["overview", "board", "table", "calendar", "timeline", "chat"],
    defaultTab: "board",
    tableColumns: ["status", "assignee", "cf:audiences", "cf:campaignType", "cf:channels", "cf:markets", "cf:budget", "cf:startDate", "dueDate", "cf:files"],
    calendarBy: "dueDate",
    preview: { layout: "board", columns: ["cf:channels"] },
  },
  {
    id: "event",
    category: "operations",
    name: l("Event Management", "Event Management"),
    blurb: l("Plan and manage your events.", "Rencanakan dan kelola event kamu."),
    icon: "PartyPopper",
    tint: "yellow",
    color: "#CA8A04",
    sections: [
      { name: l("Not started", "Belum mulai"), status: "TODO", color: "gray" },
      { name: l("Planning", "Perencanaan"), status: "IN_PROGRESS", color: "blue" },
      { name: l("Pending review", "Menunggu review"), status: "IN_REVIEW", color: "pink" },
      { name: l("Registration open", "Pendaftaran dibuka"), status: "IN_PROGRESS", color: "yellow" },
      { name: l("Done", "Selesai"), status: "DONE", color: "green" },
      { name: l("Cancelled", "Batal"), status: "CANCELLED", color: "red" },
    ],
    fields: [
      { key: "eventDate", name: l("Event date", "Tanggal event"), type: "DATE" },
      { key: "format", name: l("Format", "Format"), type: "SELECT", options: [o("In person", "purple", "Tatap muka"), o("Virtual", "green", "Online")] },
      {
        key: "category", name: l("Category", "Kategori"), type: "SELECT",
        options: [o("Webinar", "green"), o("Conference", "gray", "Konferensi"), o("Tradeshow", "red", "Pameran"), o("Workshop", "gray"), o("Internal event", "blue", "Event internal"), o("Partner event", "yellow", "Event partner"), o("Community meetup", "orange", "Meetup komunitas"), o("Team building", "pink"), o("Retreat", "purple")],
      },
      // Notion: a Select with "Venue 1/2/3" placeholders. NEXUS has a place field (name + map link), which
      // is what a venue is; no placeholder options to delete.
      { key: "venue", name: l("Venue", "Venue"), type: "PLACE" },
      { key: "capacity", name: l("Capacity", "Kapasitas"), type: "NUMBER" },
      { key: "budget", name: l("Budget", "Budget"), type: "NUMBER", format: "currency-idr" },
      { key: "eventUrl", name: l("Event URL", "URL event"), type: "URL" },
    ],
    builtins: [ASSIGNEE("Event owner", "PIC event")],
    tabs: ["overview", "board", "table", "calendar", "pages", "forms", "chat"],
    defaultTab: "board",
    tableColumns: ["cf:eventDate", "status", "assignee", "cf:format", "cf:category", "cf:venue", "cf:capacity", "cf:budget", "cf:eventUrl"],
    calendarBy: "cf:eventDate",
    preview: { layout: "board", columns: ["cf:category"] },
    starterDocs: [
      {
        title: l("Run of show", "Rundown"), icon: "🎤",
        blocks: [
          { p: l("One page per event day: who does what, and when.", "Satu halaman per hari event: siapa mengerjakan apa, dan kapan.") },
          { h: l("Timeline", "Timeline") },
          { bullets: [l("", "")] },
          { h: l("Crew and contacts", "Crew dan kontak") },
          { bullets: [l("", "")] },
          { h: l("After the event", "Setelah event") },
          { todo: [l("Settle vendor payments", "Lunasi pembayaran vendor"), l("Collect photos and videos", "Kumpulkan foto dan video"), l("Write the post-event report", "Tulis laporan pasca-event")] },
        ],
      },
    ],
  },
  // Notion's core "Meetings" (Date, Attendees, Project; views All meetings + "My meetings"), with the
  // Category of its Meeting Notes template.
  {
    id: "meetings",
    category: "docs",
    name: l("Meetings", "Meetings"),
    blurb: l("Turn meetings into action.", "Ubah meeting jadi aksi."),
    icon: "Users",
    tint: "yellow",
    color: "#B45309",
    sections: [
      { name: l("Upcoming", "Akan datang"), status: "TODO", color: "blue" },
      { name: l("Done", "Selesai"), status: "DONE", color: "green" },
    ],
    fields: [
      // Not the due date: a meeting in the past is not "overdue".
      { key: "date", name: l("Date", "Tanggal"), type: "DATE" },
      {
        key: "category", name: l("Category", "Kategori"), type: "MULTI_SELECT",
        options: [o("Planning", "blue", "Perencanaan"), o("Standup", "red"), o("Presentation", "yellow", "Presentasi"), o("Retro", "green"), o("Customer call", "blue", "Call klien")],
      },
      { key: "created", name: l("Created by", "Dibuat oleh"), type: "CREATED" },
    ],
    builtins: [ASSIGNEE("Attendees", "Peserta"), { key: "projects", name: l("Project", "Project") }, { key: "description", name: l("Notes", "Catatan") }],
    tabs: ["list", "table", "calendar", "pages", "chat"],
    defaultTab: "list",
    tableColumns: ["cf:date", "assignee", "cf:category", "cf:created"],
    calendarBy: "cf:date",
    myView: { name: l("My meetings", "Meeting saya"), tab: "list" },
    preview: { layout: "table", columns: ["cf:date", "cf:category"] },
    starterDocs: [
      {
        title: l("Meeting notes template", "Template notulen"), icon: "🗒️",
        blocks: [
          { p: l("Copy this into a meeting's notes.", "Salin ini ke catatan meeting.") },
          { h: l("Agenda", "Agenda") },
          { bullets: [l("", "")] },
          { h: l("Decisions", "Keputusan") },
          { bullets: [l("", "")] },
          { h: l("Action items", "Tindak lanjut") },
          { todo: [l("", "")] },
        ],
      },
    ],
  },
  // Notion's core "Docs" (Type, Status) with Document Hub's Category and Created by/time.
  {
    id: "docs",
    category: "docs",
    name: l("Document Hub", "Document Hub"),
    blurb: l("Collaborate on docs in one hub.", "Kerjakan dokumen bareng di satu tempat."),
    icon: "FileText",
    tint: "red",
    color: "#DC2626",
    sections: NOT_STARTED_DONE,
    fields: [
      {
        key: "type", name: l("Type", "Tipe"), type: "SELECT",
        options: [o("PRD", "purple"), o("RFC", "blue"), o("Spec", "brown"), o("Design review", "pink"), o("Decision", "green", "Keputusan"), o("Postmortem", "red"), o("Runbook", "brown"), o("OKRs", "yellow"), o("Draft", "gray"), o("Strategy", "blue", "Strategi"), o("Guideline", "purple", "Panduan")],
      },
      {
        key: "category", name: l("Category", "Kategori"), type: "MULTI_SELECT",
        options: [o("Proposal", "yellow"), o("Customer research", "blue", "Riset klien"), o("Strategy doc", "orange", "Dokumen strategi"), o("Planning", "red", "Perencanaan")],
      },
      { key: "created", name: l("Created", "Dibuat"), type: "CREATED" },
    ],
    builtins: [ASSIGNEE("Owner", "Owner"), { key: "description", name: l("Document", "Dokumen") }],
    tabs: ["board", "table", "list", "pages", "chat"],
    defaultTab: "table",
    tableColumns: ["cf:type", "status", "cf:category", "assignee", "cf:created"],
    preview: { layout: "gallery", columns: ["cf:type"] },
  },
  {
    id: "notes",
    category: "docs",
    name: l("Notes", "Catatan"),
    blurb: l("Quick notes, one page each.", "Catatan cepat, satu halaman per catatan."),
    icon: "StickyNote",
    tint: "brown",
    color: "#92400E",
    sections: [{ name: l("Notes", "Catatan") }],
    fields: [],
    builtins: [{ key: "description", name: l("Note", "Catatan") }],
    tabs: ["list", "table", "chat"],
    defaultTab: "list",
    tableColumns: ["assignee", "tags"],
    preview: { layout: "list" },
  },
  {
    id: "goals",
    category: "planning",
    name: l("Goals Tracker", "Goals Tracker"),
    blurb: l("Set team goals, achieve together.", "Tetapkan target tim, capai bersama."),
    icon: "Flag",
    tint: "blue",
    color: "#2563EB",
    sections: NOT_STARTED_DONE,
    fields: [
      { key: "quarter", name: l("Quarter", "Kuartal"), type: "SELECT", options: [o("Q1", "blue"), o("Q2", "green"), o("Q3", "yellow"), o("Q4", "orange")] },
      {
        key: "team", name: l("Team", "Tim"), type: "MULTI_SELECT",
        options: [o("Account Management", "gray"), o("Business Development", "blue"), o("Product Design", "green"), o("Human Resources", "purple")],
      },
      { key: "startValue", name: l("Start value", "Nilai awal"), type: "NUMBER" },
      { key: "endValue", name: l("End value", "Nilai target"), type: "NUMBER" },
    ],
    builtins: [ASSIGNEE("Owner", "Owner"), DUE("Due date", "Tenggat"), PRIORITY],
    tabs: ["overview", "board", "table", "timeline", "chat"],
    defaultTab: "table",
    tableColumns: ["assignee", "status", "dueDate", "priority", "cf:quarter", "cf:team", "cf:startValue", "cf:endValue"],
    myView: { name: l("My goals", "Goal saya"), tab: "table" },
    preview: { layout: "table", columns: ["assignee", "status"] },
  },
  {
    id: "brainstorm",
    category: "planning",
    name: l("Brainstorm", "Brainstorm"),
    blurb: l("Spark new ideas together.", "Kumpulkan ide baru bareng tim."),
    icon: "Lightbulb",
    tint: "orange",
    color: "#F59E0B",
    // Notion's "By category" board: the categories are the columns. Ideas are not work, so no status.
    sections: [
      { name: l("Top of funnel", "Top of funnel"), color: "yellow" },
      { name: l("Activation", "Aktivasi"), color: "orange" },
      { name: l("Conversion", "Konversi"), color: "blue" },
    ],
    fields: [{ key: "created", name: l("Created by", "Dibuat oleh"), type: "CREATED" }],
    builtins: [PRIORITY, { key: "likes", name: l("Upvote", "Upvote") }],
    tabs: ["board", "table", "chat"],
    defaultTab: "board",
    tableColumns: ["cf:created", "priority", "tags"],
    preview: { layout: "table", columns: ["cf:created", "priority"] },
    starterDocs: [
      {
        title: l("How we brainstorm", "Cara kita brainstorm"), icon: "💡",
        blocks: [
          { bullets: [l("One idea per card. Put the detail in the card's description.", "Satu ide satu kartu. Detailnya taruh di deskripsi kartu."), l("Like a card to upvote it.", "Like kartu untuk upvote."), l("No judging until the session ends.", "Jangan menilai sebelum sesi selesai.")] },
        ],
      },
    ],
  },
  {
    id: "tasks",
    category: "projects",
    name: l("Tasks Tracker", "Tasks Tracker"),
    blurb: l("Stay organized with tasks, your way.", "Atur task dengan caramu sendiri."),
    icon: "ListChecks",
    tint: "green",
    color: "#16A34A",
    sections: NOT_STARTED_DONE,
    fields: [
      {
        key: "taskType", name: l("Task type", "Jenis task"), type: "MULTI_SELECT",
        options: [o("🐞 Bug", "orange"), o("💬 Feature request", "green"), o("💅 Polish", "pink")],
      },
      { key: "effort", name: l("Effort level", "Tingkat usaha"), type: "SELECT", options: [o("Small", "green", "Kecil"), o("Medium", "yellow", "Sedang"), o("Large", "red", "Besar")] },
      { key: "files", name: l("Attach file", "Lampiran"), type: "FILE" },
    ],
    builtins: [ASSIGNEE("Assignee", "Assignee"), DUE("Due date", "Tenggat"), PRIORITY, { key: "description", name: l("Description", "Deskripsi") }],
    tabs: ["overview", "board", "table", "list", "calendar", "chat"],
    defaultTab: "table",
    tableColumns: ["status", "assignee", "dueDate", "priority", "cf:taskType", "cf:files", "cf:effort"],
    myView: { name: l("My tasks", "Task saya"), tab: "table" },
    preview: { layout: "table", columns: ["status", "assignee"] },
  },
  // Not opened in the study beyond its picker card ("Backlog, Planned, In progress"); the rest follows
  // the same pattern and stays small.
  {
    id: "roadmap",
    category: "projects",
    name: l("Product Roadmap", "Product Roadmap"),
    blurb: l("Take products from idea to launch.", "Bawa produk dari ide sampai rilis."),
    icon: "Map",
    tint: "green",
    color: "#059669",
    sections: [
      { name: l("Backlog", "Backlog"), status: "TODO", color: "gray" },
      { name: l("Planned", "Direncanakan"), status: "TODO", color: "blue" },
      { name: l("In progress", "Sedang jalan"), status: "IN_PROGRESS", color: "yellow" },
      { name: l("Launched", "Rilis"), status: "DONE", color: "green" },
    ],
    fields: [
      { key: "type", name: l("Type", "Tipe"), type: "SELECT", options: [o("Epic", "purple"), o("Feature", "blue", "Fitur"), o("Improvement", "green", "Perbaikan")] },
      { key: "quarter", name: l("Quarter", "Kuartal"), type: "SELECT", options: [o("Q1", "blue"), o("Q2", "green"), o("Q3", "yellow"), o("Q4", "orange")] },
      { key: "spec", name: l("Spec", "Spec"), type: "URL" },
    ],
    builtins: [ASSIGNEE("Owner", "Owner"), DUE("Launch date", "Tanggal rilis"), PRIORITY],
    tabs: ["overview", "board", "table", "timeline", "pages", "chat"],
    defaultTab: "board",
    tableColumns: ["status", "cf:type", "assignee", "priority", "cf:quarter", "dueDate", "cf:spec"],
    preview: { layout: "board", columns: ["cf:type"] },
  },
  // Picker card: "Backlog, Open, In progress". Issues come in through the Forms tab (a NEXUS strength).
  {
    id: "issues",
    category: "projects",
    name: l("Issue Tracking", "Issue Tracking"),
    blurb: l("Resolve issues and feedback fast.", "Selesaikan isu dan masukan dengan cepat."),
    icon: "Bug",
    tint: "red",
    color: "#E11D48",
    sections: [
      { name: l("Backlog", "Backlog"), status: "TODO", color: "gray" },
      { name: l("Open", "Terbuka"), status: "TODO", color: "red" },
      { name: l("In progress", "Sedang dikerjakan"), status: "IN_PROGRESS", color: "yellow" },
      { name: l("Resolved", "Beres"), status: "DONE", color: "green" },
    ],
    fields: [
      { key: "type", name: l("Type", "Tipe"), type: "SELECT", options: [o("Bug", "red"), o("Feedback", "blue", "Masukan"), o("Request", "green", "Permintaan")] },
      { key: "reported", name: l("Reported", "Dilaporkan"), type: "CREATED" },
      { key: "attachments", name: l("Screenshots", "Screenshot"), type: "FILE" },
    ],
    builtins: [ASSIGNEE("Assignee", "Assignee"), PRIORITY, { key: "description", name: l("Description", "Deskripsi") }],
    tabs: ["overview", "board", "table", "list", "forms", "chat"],
    defaultTab: "board",
    tableColumns: ["status", "cf:type", "priority", "assignee", "cf:reported", "cf:attachments"],
    preview: { layout: "board", columns: ["cf:type"] },
  },
  // Picker card: "Name, ID, Category (Hardware, Accessories, Electronics)". Items are not work, so the
  // sections carry no status.
  {
    id: "inventory",
    category: "operations",
    name: l("Inventory", "Inventaris"),
    blurb: l("Keep track of what you have and where it is.", "Catat barang yang ada dan di mana posisinya."),
    icon: "Package",
    tint: "gray",
    color: "#475569",
    sections: [
      { name: l("In stock", "Tersedia"), color: "green" },
      { name: l("Low stock", "Stok menipis"), color: "yellow" },
      { name: l("Out of stock", "Habis"), color: "red" },
    ],
    fields: [
      { key: "itemId", name: l("ID", "ID"), type: "TEXT" },
      { key: "category", name: l("Category", "Kategori"), type: "SELECT", options: [o("Hardware", "blue"), o("Accessories", "purple", "Aksesori"), o("Electronics", "orange", "Elektronik")] },
      { key: "quantity", name: l("Quantity", "Jumlah"), type: "NUMBER" },
      { key: "unitPrice", name: l("Unit price", "Harga satuan"), type: "NUMBER", format: "currency-idr" },
      { key: "location", name: l("Location", "Lokasi"), type: "TEXT" },
      { key: "photo", name: l("Photo", "Foto"), type: "FILE" },
    ],
    builtins: [ASSIGNEE("Held by", "Dipegang")],
    tabs: ["table", "board", "sheet", "chat"],
    defaultTab: "table",
    tableColumns: ["cf:itemId", "cf:category", "cf:quantity", "cf:unitPrice", "cf:location", "assignee", "cf:photo"],
    preview: { layout: "table", columns: ["cf:itemId", "cf:category"] },
  },
  // Picker card only ("Create shared design assets").
  {
    id: "assets",
    category: "operations",
    name: l("Asset Library", "Asset Library"),
    blurb: l("Create shared design assets.", "Kumpulkan aset desain bersama."),
    icon: "Images",
    tint: "purple",
    color: "#9333EA",
    sections: [
      { name: l("In progress", "Sedang dibuat"), status: "IN_PROGRESS", color: "yellow" },
      { name: l("Approved", "Disetujui"), status: "DONE", color: "green" },
      { name: l("Archived", "Diarsipkan"), status: "CANCELLED", color: "gray" },
    ],
    fields: [
      { key: "type", name: l("Type", "Tipe"), type: "SELECT", options: [o("Logo", "purple"), o("Icon", "blue", "Ikon"), o("Illustration", "pink", "Ilustrasi"), o("Photo", "green", "Foto"), o("Video", "red"), o("Template", "yellow")] },
      { key: "file", name: l("File", "File"), type: "FILE" },
      { key: "source", name: l("Source link", "Link sumber"), type: "URL" },
    ],
    builtins: [ASSIGNEE("Owner", "Owner"), { key: "tags", name: l("Tags", "Tag") }],
    tabs: ["board", "table", "chat"],
    defaultTab: "board",
    tableColumns: ["cf:type", "cf:file", "status", "assignee", "tags", "cf:source"],
    preview: { layout: "gallery", columns: ["cf:type"] },
  },
]

// Lookup, localisation and validation ------------------------------------------------------------------

export function findProjectTemplate(id: unknown): ProjectTemplate | null {
  if (typeof id !== "string") return null
  return PROJECT_TEMPLATES.find((t) => t.id === id) ?? null
}

export function pick(text: L, lang: TemplateLang): string {
  return (lang === "en" ? text.en : text.id || text.en).trim()
}

export function templateLang(raw: unknown): TemplateLang {
  return raw === "en" ? "en" : "id"
}

/** Every tab a template may name, in tab-bar order (PROJECT_TAB_KEYS without the retired "sprints"). */
export const TEMPLATE_TAB_KEYS: readonly TemplateTab[] = ["overview", "board", "list", "table", "sheet", "calendar", "timeline", "automations", "pages", "forms", "chat"]

/** The hiddenTabs a template's project starts with: every tab it does not show. */
export function templateHiddenTabs(t: ProjectTemplate): TemplateTab[] {
  return TEMPLATE_TAB_KEYS.filter((k) => !t.tabs.includes(k))
}

/**
 * Checks the registry is internally consistent (run by the unit test and once at module load in dev):
 * unique ids and field keys, columns and calendarBy that name real fields, Board or List shown, option
 * fields with options, a DATE field behind calendarBy. Returns the problems, [] when sound.
 */
export function validateTemplates(list: readonly ProjectTemplate[] = PROJECT_TEMPLATES): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const t of list) {
    if (ids.has(t.id)) problems.push(`${t.id}: duplicate id`)
    ids.add(t.id)
    if (!/^[a-z][a-z0-9-]*$/.test(t.id)) problems.push(`${t.id}: id must be kebab-case`)
    if (t.sections.length === 0) problems.push(`${t.id}: needs at least one section`)
    if (!t.tabs.includes("board") && !t.tabs.includes("list")) problems.push(`${t.id}: Board or List must be shown`)
    if (!t.tabs.includes(t.defaultTab)) problems.push(`${t.id}: defaultTab ${t.defaultTab} is not shown`)
    if (t.myView && !t.tabs.includes(t.myView.tab)) problems.push(`${t.id}: myView tab ${t.myView.tab} is not shown`)
    for (const tab of t.tabs) if (!TEMPLATE_TAB_KEYS.includes(tab)) problems.push(`${t.id}: unknown tab ${tab}`)
    const keys = new Set<string>()
    const names = new Set<string>()
    for (const f of t.fields) {
      if (keys.has(f.key)) problems.push(`${t.id}: duplicate field key ${f.key}`)
      keys.add(f.key)
      for (const lang of ["en", "id"] as const) {
        const n = pick(f.name, lang).toLowerCase()
        if (names.has(`${lang}:${n}`)) problems.push(`${t.id}: duplicate field name ${n} (${lang})`)
        names.add(`${lang}:${n}`)
      }
      const optional = f.type === "SELECT" || f.type === "MULTI_SELECT"
      if (optional && !(f.options && f.options.length)) problems.push(`${t.id}.${f.key}: ${f.type} needs options`)
      if (!optional && f.options) problems.push(`${t.id}.${f.key}: ${f.type} takes no options`)
      if (f.format && f.type !== "NUMBER") problems.push(`${t.id}.${f.key}: format is for NUMBER only`)
      const opts = new Set<string>()
      for (const op of f.options ?? []) {
        for (const lang of ["en", "id"] as const) {
          const v = pick(op.label, lang)
          if (!v) problems.push(`${t.id}.${f.key}: empty option (${lang})`)
          if (opts.has(`${lang}:${v}`)) problems.push(`${t.id}.${f.key}: duplicate option ${v} (${lang})`)
          opts.add(`${lang}:${v}`)
        }
      }
    }
    const fieldRef = (ref: string, where: string) => {
      if (!ref.startsWith("cf:")) return
      if (!keys.has(ref.slice(3))) problems.push(`${t.id}: ${where} names unknown field ${ref}`)
    }
    const builtinCols = ["assignee", "dueDate", "priority", "status", "tags"]
    for (const c of t.tableColumns) {
      if (!c.startsWith("cf:") && !builtinCols.includes(c)) problems.push(`${t.id}: unknown table column ${c}`)
      fieldRef(c, "tableColumns")
    }
    if (new Set(t.tableColumns).size !== t.tableColumns.length) problems.push(`${t.id}: duplicate table column`)
    if (t.calendarBy && t.calendarBy !== "dueDate") {
      fieldRef(t.calendarBy, "calendarBy")
      const f = t.fields.find((x) => `cf:${x.key}` === t.calendarBy)
      if (f && f.type !== "DATE") problems.push(`${t.id}: calendarBy must be a DATE field`)
    }
    for (const c of t.preview.columns ?? []) fieldRef(c, "preview")
    const sectionNames = new Set<string>()
    for (const s of t.sections) {
      for (const lang of ["en", "id"] as const) {
        const n = pick(s.name, lang)
        if (!n) problems.push(`${t.id}: empty section name (${lang})`)
        if (sectionNames.has(`${lang}:${n}`)) problems.push(`${t.id}: duplicate section ${n} (${lang})`)
        sectionNames.add(`${lang}:${n}`)
      }
    }
    for (const task of t.starterTasks ?? []) {
      if (task.section !== undefined && (task.section < 0 || task.section >= t.sections.length)) problems.push(`${t.id}: starter task in a missing section`)
    }
    for (const lang of ["en", "id"] as const) {
      if (!pick(t.name, lang)) problems.push(`${t.id}: empty name (${lang})`)
      if (!pick(t.blurb, lang)) problems.push(`${t.id}: empty blurb (${lang})`)
    }
  }
  return problems
}

// What creating from a template writes ---------------------------------------------------------------

export interface TemplatePlan {
  sections: { name: string; position: number; taskStatus: TemplateTaskStatus | null }[]
  fields: { key: string; name: string; type: TemplateFieldType; position: number; options: Record<string, unknown> | null }[]
  hiddenTabs: TemplateTab[]
  /** Table columns with "cf:<key>"; the creator swaps keys for the new field ids. */
  tableColumns: TemplateColumn[]
  docs: { title: string; icon: string | null; content: unknown; contentText: string }[]
  tasks: { title: string; section: number; description: string | null }[]
}

function tiptap(blocks: TemplateBlock[], lang: TemplateLang): { content: unknown; text: string } {
  const text = (s: string) => (s ? [{ type: "text", text: s }] : [])
  const nodes: unknown[] = []
  const plain: string[] = []
  for (const b of blocks) {
    if ("h" in b) {
      nodes.push({ type: "heading", attrs: { level: 2 }, content: text(pick(b.h, lang)) })
      plain.push(pick(b.h, lang))
    } else if ("p" in b) {
      nodes.push({ type: "paragraph", content: text(pick(b.p, lang)) })
      plain.push(pick(b.p, lang))
    } else if ("bullets" in b) {
      nodes.push({ type: "bulletList", content: b.bullets.map((x) => ({ type: "listItem", content: [{ type: "paragraph", content: text(pick(x, lang)) }] })) })
      plain.push(b.bullets.map((x) => `• ${pick(x, lang)}`.trimEnd()).join("\n"))
    } else {
      nodes.push({ type: "taskList", content: b.todo.map((x) => ({ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: text(pick(x, lang)) }] })) })
      plain.push(b.todo.map((x) => `☐ ${pick(x, lang)}`.trimEnd()).join("\n"))
    }
  }
  // contentText is what the web's page editor edits (blocks split on blank lines), so it reads as text.
  return { content: { type: "doc", content: nodes }, text: plain.join("\n\n") }
}

/**
 * Everything a template creates, in one language, without ids. `starter` = the starter pages and tasks
 * (the create dialog's "Add starter pages" switch; on by default).
 */
export function planTemplate(t: ProjectTemplate, lang: TemplateLang, starter = true): TemplatePlan {
  return {
    sections: t.sections.map((s, i) => ({ name: pick(s.name, lang), position: i, taskStatus: s.status ?? null })),
    fields: t.fields.map((f, i) => ({
      key: f.key,
      name: pick(f.name, lang),
      type: f.type,
      position: i,
      // Stored the way lib/custom-fields.ts normalizeCustomFieldOptions stores them.
      options:
        f.type === "SELECT" || f.type === "MULTI_SELECT"
          ? { options: (f.options ?? []).map((op) => pick(op.label, lang)) }
          : f.type === "NUMBER" && f.format
            ? { format: f.format }
            : f.type === "CREATED"
              ? { defaultSource: "taskCreatedAt", editable: false }
              : f.type === "PLACE"
                ? { format: "name-and-map-link" }
                : null,
    })),
    hiddenTabs: templateHiddenTabs(t),
    tableColumns: [...t.tableColumns],
    docs: starter
      ? (t.starterDocs ?? []).map((d) => {
          const doc = tiptap(d.blocks, lang)
          return { title: pick(d.title, lang), icon: d.icon ?? null, content: doc.content, contentText: doc.text }
        })
      : [],
    tasks: starter
      ? (t.starterTasks ?? []).map((task) => ({ title: pick(task.title, lang), section: task.section ?? 0, description: task.description ? pick(task.description, lang) : null }))
      : [],
  }
}

/** GET /api/project-templates: the gallery's data, both languages. */
export function publicTemplates() {
  return PROJECT_TEMPLATES.map((t) => ({
    id: t.id,
    category: t.category,
    name: t.name,
    blurb: t.blurb,
    icon: t.icon,
    tint: t.tint,
    sections: t.sections,
    fields: t.fields.map((f) => ({ key: f.key, name: f.name, type: f.type, options: f.options ?? [] })),
    builtins: t.builtins,
    tabs: t.tabs,
    hiddenTabs: templateHiddenTabs(t),
    defaultTab: t.defaultTab,
    calendarBy: t.calendarBy ?? "dueDate",
    myView: t.myView ?? null,
    preview: t.preview,
    starterDocs: (t.starterDocs ?? []).map((d) => ({ title: d.title, icon: d.icon ?? null })),
    starterTasks: (t.starterTasks ?? []).length,
  }))
}
