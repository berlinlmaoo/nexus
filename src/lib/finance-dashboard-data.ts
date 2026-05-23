import { google } from "googleapis"

export interface FinanceMonthlyRow {
  month: string
  revenue: number
  expense: number
  profit: number
  margin: number
  target: number
  vsTarget: number
  cashflow: number
}

export interface FinanceDashboardData {
  source: "google-sheets" | "csv" | "sample"
  sourceLabel: string
  lastUpdated: string
  currencyUnit: "Rp M"
  targetMargin: number
  totals: {
    revenue: number
    expense: number
    profit: number
    netMargin: number
    revenueGrowth: number | null
    expenseGrowth: number | null
    profitGrowth: number | null
  }
  monthly: FinanceMonthlyRow[]
}

const MONTH_ORDER = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Ags",
  "Sep",
  "Okt",
  "Nov",
  "Des",
]

const SAMPLE_MONTHLY: FinanceMonthlyRow[] = [
  { month: "Jan", revenue: 8.5, expense: 6.2, profit: 2.3, margin: 27.1, target: 9.0, vsTarget: -0.5, cashflow: 2.1 },
  { month: "Feb", revenue: 9.2, expense: 6.8, profit: 2.4, margin: 26.1, target: 9.5, vsTarget: -0.3, cashflow: 2.3 },
  { month: "Mar", revenue: 8.8, expense: 6.5, profit: 2.3, margin: 26.1, target: 9.5, vsTarget: -0.7, cashflow: -0.5 },
  { month: "Apr", revenue: 10.1, expense: 7.4, profit: 2.7, margin: 26.7, target: 10.0, vsTarget: 0.1, cashflow: 2.6 },
  { month: "Mei", revenue: 9.7, expense: 7.1, profit: 2.6, margin: 26.8, target: 10.0, vsTarget: -0.3, cashflow: 2.5 },
  { month: "Jun", revenue: 11.3, expense: 8.2, profit: 3.1, margin: 27.4, target: 11.0, vsTarget: 0.3, cashflow: 3.0 },
  { month: "Jul", revenue: 10.8, expense: 7.9, profit: 2.9, margin: 26.9, target: 11.0, vsTarget: -0.2, cashflow: 2.8 },
  { month: "Ags", revenue: 12.1, expense: 8.8, profit: 3.3, margin: 27.3, target: 12.0, vsTarget: 0.1, cashflow: 3.2 },
  { month: "Sep", revenue: 11.5, expense: 8.4, profit: 3.1, margin: 27.0, target: 12.0, vsTarget: -0.5, cashflow: -1.2 },
  { month: "Okt", revenue: 13.2, expense: 9.6, profit: 3.6, margin: 27.3, target: 13.0, vsTarget: 0.2, cashflow: 3.5 },
  { month: "Nov", revenue: 12.8, expense: 9.3, profit: 3.5, margin: 27.3, target: 13.0, vsTarget: -0.2, cashflow: 3.4 },
  { month: "Des", revenue: 14.5, expense: 10.5, profit: 4.0, margin: 27.6, target: 14.0, vsTarget: 0.5, cashflow: 3.9 },
]

const HEADER_ALIASES: Record<string, string[]> = {
  month: ["month", "bulan", "periode"],
  revenue: ["revenue", "pendapatan", "income", "actual", "aktual", "realisasi", "total pendapatan"],
  expense: ["expense", "beban", "cost", "biaya", "pengeluaran", "total beban"],
  profit: ["profit", "laba", "laba bersih", "net profit"],
  target: ["target", "target pendapatan", "revenue target"],
  cashflow: ["cashflow", "cash flow", "arus kas", "kas bersih"],
}

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[_-]/g, " ")
    .trim()
}

function findColumnIndex(headers: string[], key: keyof typeof HEADER_ALIASES) {
  const aliases = HEADER_ALIASES[key]
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)))
}

function parseNumber(value: unknown) {
  if (typeof value === "number") return value
  const raw = String(value ?? "").trim()
  if (!raw) return 0

  const hasMillionUnit = /\b(m|jt|juta)\b/i.test(raw)
  const normalized = raw
    .replace(/rp/gi, "")
    .replace(/\b(m|jt|juta)\b/gi, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "")

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return 0

  if (hasMillionUnit) return parsed
  if (Math.abs(parsed) >= 1_000_000) return parsed / 1_000_000
  return parsed
}

function parsePercent(value: unknown) {
  const parsed = parseNumber(value)
  if (Math.abs(parsed) <= 1) return parsed * 100
  return parsed
}

function formatMonth(value: string, index: number) {
  const trimmed = value.trim()
  if (!trimmed) return MONTH_ORDER[index] ?? `M${index + 1}`

  const normalized = trimmed.toLowerCase().slice(0, 3)
  const matched = MONTH_ORDER.find((month) =>
    month.toLowerCase().startsWith(normalized)
  )

  return matched ?? trimmed
}

function normalizeRows(rows: unknown[][]): FinanceMonthlyRow[] {
  if (!rows.length) return []

  const headers = rows[0].map((value) => String(value ?? ""))
  const monthIndex = findColumnIndex(headers, "month")
  const revenueIndex = findColumnIndex(headers, "revenue")
  const expenseIndex = findColumnIndex(headers, "expense")
  const profitIndex = findColumnIndex(headers, "profit")
  const targetIndex = findColumnIndex(headers, "target")
  const cashflowIndex = findColumnIndex(headers, "cashflow")

  if (monthIndex === -1 || revenueIndex === -1 || expenseIndex === -1) {
    throw new Error("Finance sheet must include Month/Bulan, Revenue/Pendapatan, and Expense/Beban columns")
  }

  return rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row, index) => {
      const revenue = parseNumber(row[revenueIndex])
      const expense = parseNumber(row[expenseIndex])
      const profit =
        profitIndex >= 0 ? parseNumber(row[profitIndex]) : revenue - expense
      const target = targetIndex >= 0 ? parseNumber(row[targetIndex]) : revenue
      const cashflow = cashflowIndex >= 0 ? parseNumber(row[cashflowIndex]) : profit

      return {
        month: formatMonth(String(row[monthIndex] ?? ""), index),
        revenue,
        expense,
        profit,
        target,
        cashflow,
        margin: revenue ? (profit / revenue) * 100 : 0,
        vsTarget: revenue - target,
      }
    })
    .sort((a, b) => {
      const aIndex = MONTH_ORDER.indexOf(a.month)
      const bIndex = MONTH_ORDER.indexOf(b.month)
      if (aIndex === -1 || bIndex === -1) return 0
      return aIndex - bIndex
    })
}

function buildDashboardData(
  monthly: FinanceMonthlyRow[],
  source: FinanceDashboardData["source"],
  sourceLabel: string,
  growth: Pick<FinanceDashboardData["totals"], "revenueGrowth" | "expenseGrowth" | "profitGrowth"> = {
    revenueGrowth: null,
    expenseGrowth: null,
    profitGrowth: null,
  }
): FinanceDashboardData {
  const revenue = monthly.reduce((sum, row) => sum + row.revenue, 0)
  const expense = monthly.reduce((sum, row) => sum + row.expense, 0)
  const profit = monthly.reduce((sum, row) => sum + row.profit, 0)

  return {
    source,
    sourceLabel,
    lastUpdated: new Date().toISOString(),
    currencyUnit: "Rp M",
    targetMargin: parsePercent(process.env.FINANCE_DASHBOARD_TARGET_MARGIN ?? "25"),
    totals: {
      revenue,
      expense,
      profit,
      netMargin: revenue ? (profit / revenue) * 100 : 0,
      ...growth,
    },
    monthly,
  }
}

function parseCsv(text: string) {
  const rows: string[][] = []
  let cell = ""
  let row: string[] = []
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === "," && !quoted) {
      row.push(cell)
      cell = ""
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1
      row.push(cell)
      rows.push(row)
      cell = ""
      row = []
    } else {
      cell += char
    }
  }

  row.push(cell)
  rows.push(row)

  return rows.filter((items) => items.some((item) => item.trim()))
}

async function fetchCsvRows() {
  const csvUrl = process.env.FINANCE_DASHBOARD_SHEET_CSV_URL
  if (!csvUrl) return null

  const response = await fetch(csvUrl, { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`Finance CSV fetch failed with status ${response.status}`)
  }

  return parseCsv(await response.text())
}

async function fetchGoogleSheetRows() {
  const spreadsheetId = process.env.FINANCE_DASHBOARD_SHEET_ID
  if (!spreadsheetId) return null

  const range = process.env.FINANCE_DASHBOARD_SHEET_RANGE || "PnL!A:F"
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY || process.env.GOOGLE_DRIVE_API_KEY
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const serviceAccountPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n")
  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const oauthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN

  const oauthClient =
    oauthClientId && oauthClientSecret && oauthRefreshToken
      ? new google.auth.OAuth2(oauthClientId, oauthClientSecret)
      : null

  if (oauthClient) {
    oauthClient.setCredentials({ refresh_token: oauthRefreshToken })
  }

  const auth = serviceAccountEmail && serviceAccountPrivateKey
    ? new google.auth.JWT({
        email: serviceAccountEmail,
        key: serviceAccountPrivateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      })
    : oauthClient || apiKey || undefined

  if (!auth) return null

  const sheets = google.sheets({ version: "v4", auth })
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  })

  return (response.data.values ?? []) as unknown[][]
}

export async function getFinanceDashboardData() {
  const csvRows = await fetchCsvRows()
  if (csvRows) {
    return buildDashboardData(
      normalizeRows(csvRows),
      "csv",
      "Google Sheets CSV"
    )
  }

  const sheetRows = await fetchGoogleSheetRows()
  if (sheetRows) {
    return buildDashboardData(
      normalizeRows(sheetRows),
      "google-sheets",
      "Google Sheets API"
    )
  }

  return buildDashboardData(SAMPLE_MONTHLY, "sample", "Sample from PDF", {
    revenueGrowth: 18,
    expenseGrowth: 14,
    profitGrowth: 31,
  })
}
