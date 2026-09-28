import { google, type sheets_v4 } from "googleapis"
import prisma from "@/lib/prisma"
import {
  attendancePeriodKey,
  attendancePeriodRange,
  enumerateAttendanceDates,
  formatAttendanceDateKey,
  type AttendanceDayType,
} from "@/lib/attendance"
import { classifyAttendanceDays } from "@/lib/attendance-days"
import { dayOffQuotaByUser } from "@/lib/day-off-usage"
import { deleteAppSetting, getAppSetting, setAppSetting } from "@/lib/app-setting"
import {
  ATTENDANCE_EXPORT_COLORS,
  ATTENDANCE_EXPORT_SUMMARY_ROWS,
  ATTENDANCE_EXPORT_TIMEZONE,
  attendanceExportCode,
  attendanceExportFill,
  formatExportDateLabel,
  formatExportPeriod,
  exportWorkingDays,
} from "@/lib/attendance-export-format"
import { getPrimaryWorkspaceDefaults } from "@/lib/workspace-defaults"

/**
 * Live one-way copy of the monthly attendance sheet into Google Sheets.
 *
 * The BoD already lives in the xlsx from the crew board (GET /api/attendance/history?format=xlsx);
 * this is that same sheet, kept current every minute by POST /api/cron/attendance-sheet, one tab
 * per attendance period (28th → 27th). NEXUS is the source: every run rewrites the whole tab, so a
 * hand edit in Google lasts until the next minute — the title block says so, and the tab is
 * protected so only the owning account can edit at all.
 *
 * What a day IS comes from classifyAttendanceDays (src/lib/attendance-days.ts) — the documented
 * mirror of the export route's day rules — and what it LOOKS like (letter, colour, summary rows,
 * labels) from src/lib/attendance-export-format.ts, which the xlsx export now imports too. Nothing
 * here decides a status on its own.
 *
 * Google access is the OAuth refresh token of account@znetworks.id (GOOGLE_OAUTH_*; scopes
 * drive.file + spreadsheets — the same credentials finance-dashboard-data.ts reads with). drive.file
 * means the app only sees files it created, so the spreadsheet is created by this code on the first
 * run and its id kept in AppSetting["attendance-sheet"]. The GOOGLE_SERVICE_ACCOUNT_* (finance) and
 * GOOGLE_DIRECTORY_* (directory) credentials are deliberately not used.
 *
 * Quota: one spreadsheets.get + ONE spreadsheets.batchUpdate per run (both tabs in the same batch on
 * the first day of a period), plus a one-off create and one permissions.create per new reader.
 */

export const ATTENDANCE_SHEET_TITLE = "NEXUS · Absensi (live)"
export const ATTENDANCE_SHEET_OWNER = "account@znetworks.id"
export const ATTENDANCE_SHEET_NOTE = "Diisi otomatis dari NEXUS tiap menit — perubahan di sini akan ditimpa."
export const ATTENDANCE_SHEET_SETTING_KEY = "attendance-sheet"
const DEFAULT_SHARE = "bagas@znetworks.id"
const PROTECTION_DESCRIPTION = "NEXUS attendance sync — hanya akun pemilik yang bisa mengubah"
const SHARE_RETRY_MS = 60 * 60 * 1000
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Rows above the grid: title (2), spacer (1), header (1). Frozen with column A. */
const HEADER_ROWS = 4
const COLUMN_A_PX = 200 // ExcelJS width 28 ≈ 7·28+4 px
const COLUMN_PX = 104 // ExcelJS width 14

// ─────────────────────────────────────────────────────────────────────────────
// Grid — pure. Same shape as buildAttendanceWorkbook in the history route.
// ─────────────────────────────────────────────────────────────────────────────

export type SheetCell = {
  value: string | number | null
  /** Hex RGB, or null for "no formatting at all" (the spacer row, the gap before the summary). */
  fill: string | null
  bold?: boolean
  italic?: boolean
  fontSize?: number
  fontColor?: string
  hAlign?: "LEFT" | "CENTER"
  wrap?: boolean
}

export type SheetMerge = { startRow: number; endRow: number; startCol: number; endCol: number } // 0-based, end exclusive

export type AttendanceSheetGrid = {
  periodKey: string
  tabTitle: string
  /** Stable per period (e.g. 202609) so a batch can add a tab and write to it in the same request. */
  sheetId: number
  rowCount: number
  columnCount: number
  rows: SheetCell[][]
  merges: SheetMerge[]
  people: number
  days: number
  firstDataRow: number
}

export type SheetPerson = { id: string; name: string; dayOffQuota?: number }
export type SheetDay = { dateKey: string; dayType: AttendanceDayType }

const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/**
 * "2026-09" → "2026-September (28 Aug–27 Sep)" (owner, 28 Sep 2026: the month by name, not number).
 * English month names fixed here: ICU's en-GB now says "Sept". Tabs are found by sheetId, so renaming
 * is safe — the next write of a tab updates its title in place.
 */
export function attendanceSheetTabTitle(periodKey: string) {
  const { start, end } = attendancePeriodRange(periodKey)
  const d = (x: Date) => `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`
  const [y, m] = periodKey.split("-").map(Number)
  return `${y}-${MONTHS_FULL[m - 1]} (${d(start)}–${d(end)})`
}

export function attendanceSheetId(periodKey: string) {
  return Number(periodKey.replace("-", ""))
}

export function previousPeriodKey(periodKey: string) {
  const [y, m] = periodKey.split("-").map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`
}

export function columnLetters(index: number) {
  let n = index + 1
  let s = ""
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function stampLabel(now: Date) {
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: ATTENDANCE_EXPORT_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now)
  return `${parts} WIB`
}

/**
 * Layout, cell for cell, of the xlsx export, with two differences Google forces or the sync needs:
 *   • the "ABSENSI INTERNAL" title is merged over A1:A2, not A1:B2 — Sheets refuses a merge that
 *     straddles a frozen column, and column A is frozen in both;
 *   • the period line sits in row 1 and row 2 carries the "diisi otomatis" note plus the time of the
 *     last write (the export merges the period over both rows).
 */
export function buildAttendanceSheetGrid(input: {
  periodKey: string
  workspaceName: string
  people: SheetPerson[]
  days: Map<string, SheetDay[]>
  now: Date
}): AttendanceSheetGrid {
  const { periodKey, workspaceName, now } = input
  const { start, end } = attendancePeriodRange(periodKey)
  const dates = enumerateAttendanceDates(start, end)
  // Same roster rule as the export: whoever has at least one day, A→Z by name.
  const people = input.people
    .filter((p) => (input.days.get(p.id)?.length ?? 0) > 0)
    .sort((left, right) => left.name.localeCompare(right.name))
  const columnCount = Math.max(2, people.length + 1)
  const summaryStart = HEADER_ROWS + dates.length + 1
  const rowCount = summaryStart + ATTENDANCE_EXPORT_SUMMARY_ROWS.length

  const C = ATTENDANCE_EXPORT_COLORS
  const blankRow = (): SheetCell[] => Array.from({ length: columnCount }, () => ({ value: null, fill: null }))
  const rows: SheetCell[][] = Array.from({ length: rowCount }, blankRow)

  // Title block
  for (let r = 0; r < 2; r++) for (let c = 0; c < columnCount; c++) rows[r][c] = { value: null, fill: C.title }
  rows[0][0] = { value: "ABSENSI\nINTERNAL", fill: C.title, bold: true, fontSize: 18, hAlign: "CENTER", wrap: true }
  rows[0][1] = { value: `${workspaceName.toUpperCase()} • ${formatExportPeriod(start, end)}`, fill: C.title, bold: true, fontSize: 16, hAlign: "CENTER" }
  rows[1][1] = { value: `${ATTENDANCE_SHEET_NOTE} Terakhir: ${stampLabel(now)}.`, fill: C.title, italic: true, fontSize: 9, hAlign: "CENTER" }

  // Header
  rows[3][0] = { value: "DATE", fill: C.title, bold: true, fontSize: 10, hAlign: "CENTER" }
  for (let c = 1; c < columnCount; c++) {
    const person = people[c - 1]
    rows[3][c] = { value: person ? person.name.toUpperCase() : null, fill: C.header, bold: true, fontSize: 10, hAlign: "CENTER", wrap: true }
  }

  // Grid + counters
  const byKey = new Map<string, AttendanceDayType>()
  for (const person of people) for (const day of input.days.get(person.id) ?? []) byKey.set(`${person.id}:${day.dateKey}`, day.dayType)
  const counters = people.map(() => ({ H: 0, C: 0, S: 0, DO: 0, TK: 0, TOTAL: 0 }) as Record<string, number>)

  dates.forEach((date, i) => {
    const r = HEADER_ROWS + i
    rows[r][0] = { value: formatExportDateLabel(date), fill: C.dateFill, fontSize: 10, fontColor: C.dateFont }
    const dateKey = date.toISOString().slice(0, 10)
    for (let c = 1; c < columnCount; c++) {
      const person = people[c - 1]
      const code = person ? attendanceExportCode(byKey.get(`${person.id}:${dateKey}`)) : ""
      rows[r][c] = { value: code || null, fill: attendanceExportFill(code), bold: Boolean(code), fontSize: 10, fontColor: C.cellFont, hAlign: "CENTER" }
      if (code && person) {
        counters[c - 1][code] = (counters[c - 1][code] ?? 0) + 1
      }
    }
  })
  people.forEach((p, i) => { counters[i].TOTAL = exportWorkingDays(dates.length, p.dayOffQuota) })

  // Summary
  ATTENDANCE_EXPORT_SUMMARY_ROWS.forEach((summary, i) => {
    const r = summaryStart + i
    rows[r][0] = { value: summary.label, fill: summary.fill, bold: true, fontSize: 10, fontColor: C.summaryLabelFont }
    for (let c = 1; c < columnCount; c++) {
      rows[r][c] = { value: people[c - 1] ? counters[c - 1][summary.code] ?? 0 : null, fill: summary.fill, bold: true, fontSize: 10, hAlign: "CENTER" }
    }
  })

  const merges: SheetMerge[] = [{ startRow: 0, endRow: 2, startCol: 0, endCol: 1 }]
  if (columnCount > 2) {
    merges.push({ startRow: 0, endRow: 1, startCol: 1, endCol: columnCount })
    merges.push({ startRow: 1, endRow: 2, startCol: 1, endCol: columnCount })
  }

  return {
    periodKey,
    tabTitle: attendanceSheetTabTitle(periodKey),
    sheetId: attendanceSheetId(periodKey),
    rowCount,
    columnCount,
    rows,
    merges,
    people: people.length,
    days: dates.length,
    firstDataRow: HEADER_ROWS,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheets requests — pure.
// ─────────────────────────────────────────────────────────────────────────────

export type ExistingTab = {
  sheetId: number
  title: string
  rowCount: number
  columnCount: number
  hasProtection: boolean
}

function rgb(hex: string): sheets_v4.Schema$Color {
  return {
    red: parseInt(hex.slice(0, 2), 16) / 255,
    green: parseInt(hex.slice(2, 4), 16) / 255,
    blue: parseInt(hex.slice(4, 6), 16) / 255,
  }
}

const THIN: sheets_v4.Schema$Border = { style: "SOLID" }

export function toCellData(cell: SheetCell): sheets_v4.Schema$CellData {
  const out: sheets_v4.Schema$CellData = {}
  if (cell.value !== null && cell.value !== "") {
    out.userEnteredValue = typeof cell.value === "number" ? { numberValue: cell.value } : { stringValue: cell.value }
  }
  // Written with fields "userEnteredValue,userEnteredFormat": an omitted value clears the cell and an
  // empty format resets it, which is what wipes a hand edit or a stale colour on every run.
  if (cell.fill === null) {
    out.userEnteredFormat = {}
    return out
  }
  out.userEnteredFormat = {
    backgroundColor: rgb(cell.fill),
    borders: { top: THIN, bottom: THIN, left: THIN, right: THIN },
    verticalAlignment: "MIDDLE",
    ...(cell.hAlign ? { horizontalAlignment: cell.hAlign } : {}),
    ...(cell.wrap ? { wrapStrategy: "WRAP" } : {}),
    textFormat: {
      bold: Boolean(cell.bold),
      ...(cell.italic ? { italic: true } : {}),
      ...(cell.fontSize ? { fontSize: cell.fontSize } : {}),
      ...(cell.fontColor ? { foregroundColor: rgb(cell.fontColor) } : {}),
    },
  }
  return out
}

/**
 * Every request for one tab, in order. The tab ends up exactly rowCount × columnCount, so when the
 * roster shrinks the leftover columns are removed with the resize rather than left holding a name.
 */
export function buildTabRequests(
  grid: AttendanceSheetGrid,
  existing: ExistingTab | null,
  opts: { index?: number; ownerEmail?: string } = {},
): sheets_v4.Schema$Request[] {
  const sheetId = existing?.sheetId ?? grid.sheetId
  const gridProperties = { rowCount: grid.rowCount, columnCount: grid.columnCount, frozenRowCount: HEADER_ROWS, frozenColumnCount: 1 }
  const requests: sheets_v4.Schema$Request[] = []

  if (!existing) {
    requests.push({
      addSheet: { properties: { sheetId, title: grid.tabTitle, ...(opts.index !== undefined ? { index: opts.index } : {}), gridProperties } },
    })
  } else {
    requests.push({ unmergeCells: { range: { sheetId } } })
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, title: grid.tabTitle, ...(opts.index !== undefined ? { index: opts.index } : {}), gridProperties },
        fields: [
          "title",
          ...(opts.index !== undefined ? ["index"] : []),
          "gridProperties.rowCount",
          "gridProperties.columnCount",
          "gridProperties.frozenRowCount",
          "gridProperties.frozenColumnCount",
        ].join(","),
      },
    })
  }

  requests.push({
    updateCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: grid.rowCount, startColumnIndex: 0, endColumnIndex: grid.columnCount },
      rows: grid.rows.map((row) => ({ values: row.map(toCellData) })),
      fields: "userEnteredValue,userEnteredFormat",
    },
  })

  for (const m of grid.merges) {
    requests.push({
      mergeCells: {
        range: { sheetId, startRowIndex: m.startRow, endRowIndex: m.endRow, startColumnIndex: m.startCol, endColumnIndex: m.endCol },
        mergeType: "MERGE_ALL",
      },
    })
  }

  const dim = (dimension: "ROWS" | "COLUMNS", startIndex: number, endIndex: number, pixelSize: number): sheets_v4.Schema$Request => ({
    updateDimensionProperties: { range: { sheetId, dimension, startIndex, endIndex }, properties: { pixelSize }, fields: "pixelSize" },
  })
  requests.push(dim("COLUMNS", 0, 1, COLUMN_A_PX))
  if (grid.columnCount > 1) requests.push(dim("COLUMNS", 1, grid.columnCount, COLUMN_PX))
  requests.push(dim("ROWS", 0, 2, 30))
  requests.push(dim("ROWS", 2, 3, 11)) // the export's 8pt spacer

  if (!existing?.hasProtection) {
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId },
          description: PROTECTION_DESCRIPTION,
          warningOnly: false,
          editors: { users: [opts.ownerEmail ?? ATTENDANCE_SHEET_OWNER], domainUsersCanEdit: false },
        },
      },
    })
  }
  return requests
}

// ─────────────────────────────────────────────────────────────────────────────
// Google — a narrow interface so tests can swap it out.
// ─────────────────────────────────────────────────────────────────────────────

export type SpreadsheetRef = { id: string; url: string }

export interface AttendanceSheetApi {
  /** Oldest non-trashed spreadsheet this app created under that name (drive.file only sees ours). */
  findByTitle(title: string): Promise<SpreadsheetRef | null>
  create(title: string, firstTab: { sheetId: number; title: string }): Promise<SpreadsheetRef>
  /** null when the file is gone (404). */
  getTabs(spreadsheetId: string): Promise<ExistingTab[] | null>
  batchUpdate(spreadsheetId: string, requests: sheets_v4.Schema$Request[]): Promise<void>
  shareReader(spreadsheetId: string, email: string): Promise<void>
}

export function spreadsheetUrl(id: string) {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`
}

type OAuthClient = InstanceType<typeof google.auth.OAuth2>

/** The same OAuth path as finance-dashboard-data.ts. null when the env is not set. */
export function googleAttendanceSheetApi(opts: { rootUrl?: string; auth?: OAuthClient } = {}): AttendanceSheetApi | null {
  let auth = opts.auth
  if (!auth) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
    if (!clientId || !clientSecret || !refreshToken) return null
    auth = new google.auth.OAuth2(clientId, clientSecret)
    auth.setCredentials({ refresh_token: refreshToken })
  }
  const common = { auth, timeout: 30_000, ...(opts.rootUrl ? { rootUrl: opts.rootUrl } : {}) }
  const sheets = google.sheets({ version: "v4", ...common })
  const drive = google.drive({ version: "v3", ...common })

  return {
    async findByTitle(title) {
      const q = `name = '${title.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`
      const res = await drive.files.list({ q, fields: "files(id,createdTime)", orderBy: "createdTime", pageSize: 10, spaces: "drive" })
      const id = res.data.files?.[0]?.id
      return id ? { id, url: spreadsheetUrl(id) } : null
    },
    async create(title, firstTab) {
      const res = await sheets.spreadsheets.create({
        fields: "spreadsheetId",
        requestBody: {
          properties: { title, timeZone: ATTENDANCE_EXPORT_TIMEZONE },
          sheets: [{ properties: { sheetId: firstTab.sheetId, title: firstTab.title } }],
        },
      })
      const id = res.data.spreadsheetId
      if (!id) throw new Error("spreadsheets.create returned no spreadsheetId")
      return { id, url: spreadsheetUrl(id) }
    },
    async getTabs(spreadsheetId) {
      try {
        const res = await sheets.spreadsheets.get({
          spreadsheetId,
          fields: "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),protectedRanges(description))",
        })
        return (res.data.sheets ?? []).map((s) => ({
          sheetId: s.properties?.sheetId ?? 0,
          title: s.properties?.title ?? "",
          rowCount: s.properties?.gridProperties?.rowCount ?? 0,
          columnCount: s.properties?.gridProperties?.columnCount ?? 0,
          hasProtection: (s.protectedRanges ?? []).some((p) => p.description === PROTECTION_DESCRIPTION),
        }))
      } catch (err) {
        if (googleStatus(err) === 404) return null
        throw err
      }
    },
    async batchUpdate(spreadsheetId, requests) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests, includeSpreadsheetInResponse: false } })
    },
    async shareReader(spreadsheetId, email) {
      await drive.permissions.create({
        fileId: spreadsheetId,
        sendNotificationEmail: false,
        fields: "id",
        requestBody: { type: "user", role: "reader", emailAddress: email },
      })
    },
  }
}

function googleStatus(err: unknown): number | null {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } }
  const n = Number(e?.response?.status ?? e?.status ?? e?.code)
  return Number.isFinite(n) && n > 0 ? n : null
}

function describeGoogleError(err: unknown) {
  const e = err as { message?: string; response?: { data?: { error?: unknown; error_description?: string } } }
  const data = e?.response?.data
  const detail =
    typeof data?.error === "string"
      ? `${data.error}${data.error_description ? `: ${data.error_description}` : ""}`
      : (data?.error as { message?: string } | undefined)?.message
  const reason = String(detail || e?.message || err).slice(0, 300)
  return { reason, status: googleStatus(err), needsReauth: /invalid_grant|unauthorized_client|invalid_client/i.test(reason) }
}

// ─────────────────────────────────────────────────────────────────────────────
// State + data loading
// ─────────────────────────────────────────────────────────────────────────────

export type AttendanceSheetState = {
  spreadsheetId: string
  url: string
  workspaceId: string
  createdAt: string
  /** Readers already granted (drive.permissions.create is not repeated). */
  sharedWith: string[]
  /** email → ISO time of the last failed grant; retried at most hourly. */
  shareFailedAt?: Record<string, string>
  /** The last previous-period tab written after its period closed (see syncAttendanceSheet). */
  finalisedPeriod?: string | null
}

export interface AttendanceSheetStore {
  get(): Promise<AttendanceSheetState | null>
  set(state: AttendanceSheetState): Promise<void>
  clear(): Promise<void>
}

const dbStore: AttendanceSheetStore = {
  get: () => getAppSetting<AttendanceSheetState>(ATTENDANCE_SHEET_SETTING_KEY),
  set: (state) => setAppSetting(ATTENDANCE_SHEET_SETTING_KEY, state),
  clear: () => deleteAppSetting(ATTENDANCE_SHEET_SETTING_KEY),
}

/** For BoD screens: the sheet's link if the sync has created it for this workspace. Never throws. */
export async function getAttendanceSheetUrl(workspaceId: string): Promise<string | null> {
  try {
    const state = await dbStore.get()
    return state && state.workspaceId === workspaceId ? state.url : null
  } catch {
    return null
  }
}

export function attendanceSheetShareList(raw = process.env.NEXUS_ATTENDANCE_SHEET_SHARE) {
  const source = raw === undefined ? DEFAULT_SHARE : raw
  return [...new Set(source.split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+$/.test(s)))]
}

export type SheetWorkspace = { id: string; name: string }

/** The company workspace: NEXUS_ATTENDANCE_SHEET_WORKSPACE (a slug) or the primary one ("Z Networks"). */
async function resolveWorkspace(): Promise<SheetWorkspace | null> {
  const slug = process.env.NEXUS_ATTENDANCE_SHEET_WORKSPACE?.trim() || getPrimaryWorkspaceDefaults().slug
  return prisma.workspace.findUnique({ where: { slug }, select: { id: true, name: true } })
}

/**
 * The roster the xlsx export would have for a workspace-wide board: everyone with a record, an
 * approved request or membership in the period, minus BoD / One Above All (exempt from attendance),
 * each day classified by classifyAttendanceDays.
 */
export async function loadAttendanceSheetGrid(workspace: SheetWorkspace, periodKey: string, now: Date) {
  const { start, end } = attendancePeriodRange(periodKey)
  const [members, recordUsers, requestUsers] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { workspaceId: workspace.id }, select: { userId: true, role: true } }),
    prisma.attendanceRecord.findMany({
      where: { workspaceId: workspace.id, attendanceDate: { gte: start, lte: end } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.attendanceRequest.findMany({
      where: { workspaceId: workspace.id, status: "APPROVED", startDate: { lte: end }, endDate: { gte: start } },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ])
  const exempt = new Set(members.filter((m) => m.role === "BOD" || m.role === "ONE_ABOVE_ALL").map((m) => m.userId))
  const userIds = [...new Set([...members, ...recordUsers, ...requestUsers].map((x) => x.userId))].filter((id) => !exempt.has(id))

  const classified = await classifyAttendanceDays({ workspaceId: workspace.id, userIds, start, end })
  const withDays = userIds.filter((id) => (classified.get(id)?.length ?? 0) > 0)
  const [found, quotas] = withDays.length
    ? await Promise.all([
        prisma.user.findMany({ where: { id: { in: withDays } }, select: { id: true, name: true } }),
        // TOTAL HARI KERJA = period days − this period's allowance (base + extra days granted for it).
        dayOffQuotaByUser(workspace.id, withDays, periodKey),
      ])
    : [[], new Map<string, number>()]
  const users = found.map((u) => ({ ...u, dayOffQuota: quotas.get(u.id) }))
  const days = new Map<string, SheetDay[]>()
  for (const [userId, list] of classified) days.set(userId, list.map((d) => ({ dateKey: d.dateKey, dayType: d.dayType })))

  return buildAttendanceSheetGrid({ periodKey, workspaceName: workspace.name, people: users, days, now })
}

// ─────────────────────────────────────────────────────────────────────────────
// The sync
// ─────────────────────────────────────────────────────────────────────────────

export type AttendanceSheetSyncResult = {
  ok: boolean
  dryRun: boolean
  reason?: string
  stage?: string
  needsReauth?: boolean
  spreadsheetUrl: string | null
  spreadsheetExists: boolean
  created?: boolean
  tabs: Array<{ periodKey: string; title: string; rows: number; columns: number; people: number; newTab?: boolean }>
  requests?: number
  payloadBytes?: number
  sample?: Array<{ cell: string; value: string | number | null; fill: string | null }>
  sharedNow?: string[]
  shareErrors?: Array<{ email: string; reason: string }>
  ms: number
}

let running = false

function sampleCells(grid: AttendanceSheetGrid, n = 5) {
  const out: Array<{ cell: string; value: string | number | null; fill: string | null }> = []
  const push = (r: number, c: number) => out.push({ cell: `${columnLetters(c)}${r + 1}`, value: grid.rows[r][c].value, fill: grid.rows[r][c].fill })
  for (let r = grid.firstDataRow; r < grid.firstDataRow + grid.days && out.length < n; r++) {
    for (let c = 1; c < grid.columnCount && out.length < n; c++) if (grid.rows[r][c].value) push(r, c)
  }
  for (let c = 0; c < grid.columnCount && out.length < n; c++) push(grid.firstDataRow - 1, c)
  return out.slice(0, n)
}

/**
 * One run. Writes the current period's tab; on the first day of a period (and on the first run after
 * it, if that day was missed) the previous period's tab is written once more in the SAME batch, so
 * the absences of its last day — which only exist once that day is over — land on it.
 * Google failures come back as { ok: false, reason } rather than as exceptions.
 */
export async function syncAttendanceSheet(opts: {
  dryRun?: boolean
  /** Older periods to (re)write in this run, e.g. a one-off backfill. One per call keeps each batch small. */
  extraPeriods?: string[]
  now?: Date
  api?: AttendanceSheetApi | null
  store?: AttendanceSheetStore
  workspace?: SheetWorkspace | null
  loadGrid?: (workspace: SheetWorkspace, periodKey: string, now: Date) => Promise<AttendanceSheetGrid>
  shareList?: string[]
} = {}): Promise<AttendanceSheetSyncResult> {
  const t0 = Date.now()
  const dryRun = opts.dryRun === true
  const now = opts.now ?? new Date()
  const store = opts.store ?? dbStore
  const loadGrid = opts.loadGrid ?? loadAttendanceSheetGrid
  const base = { dryRun, spreadsheetUrl: null as string | null, spreadsheetExists: false, tabs: [] as AttendanceSheetSyncResult["tabs"] }
  const fail = (stage: string, reason: string, extra: Partial<AttendanceSheetSyncResult> = {}): AttendanceSheetSyncResult =>
    ({ ok: false, ...base, stage, reason, ...extra, ms: Date.now() - t0 })

  if (running && !dryRun) return fail("lock", "previous run still in progress")
  if (!dryRun) running = true
  try {
    const workspace = opts.workspace !== undefined ? opts.workspace : await resolveWorkspace()
    if (!workspace) return fail("workspace", "workspace not found (NEXUS_ATTENDANCE_SHEET_WORKSPACE / primary slug)")

    let state = await store.get()
    if (state && state.workspaceId !== workspace.id) {
      return fail("state", `the stored spreadsheet belongs to workspace ${state.workspaceId}, not ${workspace.id}; clear AppSetting "${ATTENDANCE_SHEET_SETTING_KEY}" to start a new one`)
    }
    base.spreadsheetUrl = state?.url ?? null
    base.spreadsheetExists = Boolean(state?.spreadsheetId)

    const todayKey = formatAttendanceDateKey(now)
    const currentKey = attendancePeriodKey(todayKey)
    const prevKey = previousPeriodKey(currentKey)
    const firstDay = todayKey === attendancePeriodRange(currentKey).start.toISOString().slice(0, 10)
    const includePrev = firstDay || state?.finalisedPeriod !== prevKey

    const current = await loadGrid(workspace, currentKey, now)
    const grids = includePrev ? [current, await loadGrid(workspace, prevKey, now)] : [current]
    for (const key of opts.extraPeriods ?? []) {
      if (key === currentKey || grids.some((g) => g.periodKey === key)) continue
      grids.push(await loadGrid(workspace, key, now))
    }
    base.tabs = grids.map((g) => ({ periodKey: g.periodKey, title: g.tabTitle, rows: g.rowCount, columns: g.columnCount, people: g.people }))

    if (dryRun) {
      // No Google call of any kind: "exists" is what the database remembers, and the request count
      // is for a spreadsheet that would get every tab new (the largest batch a run can send).
      const requests = grids.flatMap((g, i) => buildTabRequests(g, null, { index: i }))
      return { ok: true, ...base, requests: requests.length, payloadBytes: JSON.stringify({ requests }).length, sample: sampleCells(current), ms: Date.now() - t0 }
    }

    const api = opts.api !== undefined ? opts.api : googleAttendanceSheetApi()
    if (!api) return fail("config", "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN not set")

    let stage = "open"
    let created = false
    try {
      if (!state) {
        // Adopt one this app made before (state lost, or created but never saved), else create it.
        stage = "find"
        const found = await api.findByTitle(ATTENDANCE_SHEET_TITLE)
        stage = "create"
        const ref = found ?? (await api.create(ATTENDANCE_SHEET_TITLE, { sheetId: current.sheetId, title: current.tabTitle }))
        created = !found
        state = { spreadsheetId: ref.id, url: ref.url, workspaceId: workspace.id, createdAt: now.toISOString(), sharedWith: [], finalisedPeriod: null }
        // Saved before anything else can fail, so a later error never leads to a second spreadsheet.
        await store.set(state)
        base.spreadsheetUrl = state.url
        base.spreadsheetExists = true
      }

      stage = "read"
      const tabs = await api.getTabs(state.spreadsheetId)
      if (!tabs) {
        await store.clear()
        return fail("read", "spreadsheet not found (deleted?); state cleared — the next run creates a new one", { spreadsheetExists: false })
      }

      stage = "write"
      const requests: sheets_v4.Schema$Request[] = []
      grids.forEach((grid, index) => {
        const existing = tabs.find((t) => t.sheetId === grid.sheetId) ?? tabs.find((t) => t.title === grid.tabTitle) ?? null
        base.tabs[index].newTab = !existing
        requests.push(...buildTabRequests(grid, existing, { index }))
      })
      await api.batchUpdate(state.spreadsheetId, requests)

      let dirty = false
      if (includePrev && !firstDay && state.finalisedPeriod !== prevKey) {
        state = { ...state, finalisedPeriod: prevKey }
        dirty = true
      }

      stage = "share"
      const sharedNow: string[] = []
      const shareErrors: Array<{ email: string; reason: string }> = []
      const failedAt = { ...(state.shareFailedAt ?? {}) }
      for (const email of opts.shareList ?? attendanceSheetShareList()) {
        if (state.sharedWith.includes(email)) continue
        const last = failedAt[email] ? Date.parse(failedAt[email]) : 0
        if (last && now.getTime() - last < SHARE_RETRY_MS) continue
        try {
          await api.shareReader(state.spreadsheetId, email)
          sharedNow.push(email)
          delete failedAt[email]
        } catch (err) {
          const { reason } = describeGoogleError(err)
          console.error("attendance sheet: share failed", { email, reason })
          shareErrors.push({ email, reason })
          failedAt[email] = now.toISOString()
        }
      }
      if (sharedNow.length || shareErrors.length) {
        state = { ...state, sharedWith: [...state.sharedWith, ...sharedNow], shareFailedAt: failedAt }
        dirty = true
      }
      if (dirty) await store.set(state)

      return {
        ok: true,
        ...base,
        created,
        requests: requests.length,
        payloadBytes: JSON.stringify({ requests }).length,
        ...(sharedNow.length ? { sharedNow } : {}),
        ...(shareErrors.length ? { shareErrors } : {}),
        ms: Date.now() - t0,
      }
    } catch (err) {
      const { reason, status, needsReauth } = describeGoogleError(err)
      console.error("attendance sheet: google call failed", { stage, status, reason })
      return fail(stage, status ? `HTTP ${status}: ${reason}` : reason, { created, ...(needsReauth ? { needsReauth: true } : {}) })
    }
  } finally {
    if (!dryRun) running = false
  }
}
