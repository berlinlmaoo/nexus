import http from "node:http"
import fs from "node:fs/promises"
import { execFile } from "node:child_process"
import { google } from "googleapis"

const DEFAULT_CLIENT_SECRET_FILE =
  "/Users/jagainmacmini1/Library/Mobile Documents/com~apple~CloudDocs/Documents/client_secret_211593074958-d9tslthrgks0607djbquaa6pe1j6uuu4.apps.googleusercontent.com.json"

const CLIENT_SECRET_FILE =
  process.env.GOOGLE_CLIENT_SECRET_FILE || process.argv[2] || DEFAULT_CLIENT_SECRET_FILE
const ENV_FILE = process.env.ENV_FILE || "/Users/jagainmacmini1/Documents/nexus/.env.production"
const PORT = Number(process.env.GOOGLE_OAUTH_PORT || 53682)
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`

const rows = [
  ["Month", "Revenue", "Expense", "Target", "Cashflow", "Profit"],
  ["Jan", 8.5, 6.2, 9.0, 2.1, 2.3],
  ["Feb", 9.2, 6.8, 9.5, 2.3, 2.4],
  ["Mar", 8.8, 6.5, 9.5, -0.5, 2.3],
  ["Apr", 10.1, 7.4, 10.0, 2.6, 2.7],
  ["Mei", 9.7, 7.1, 10.0, 2.5, 2.6],
  ["Jun", 11.3, 8.2, 11.0, 3.0, 3.1],
  ["Jul", 10.8, 7.9, 11.0, 2.8, 2.9],
  ["Ags", 12.1, 8.8, 12.0, 3.2, 3.3],
  ["Sep", 11.5, 8.4, 12.0, -1.2, 3.1],
  ["Okt", 13.2, 9.6, 13.0, 3.5, 3.6],
  ["Nov", 12.8, 9.3, 13.0, 3.4, 3.5],
  ["Des", 14.5, 10.5, 14.0, 3.9, 4.0],
]

const instructions = [
  ["Nexus Finance Dashboard"],
  ["Dashboard reads data from the PnL tab, range A:F."],
  ["Keep headers as Month, Revenue, Expense, Target, Cashflow, Profit."],
  ["Values are in Rp Miliar. Example: 8.5 = Rp 8.5 M."],
  ["Edit rows in PnL, then Nexus refreshes dashboard data automatically."],
]

function getInstalledCredentials(secret) {
  const installed = secret.installed || secret.web
  if (!installed?.client_id || !installed?.client_secret) {
    throw new Error("Client secret file must include installed.client_id and installed.client_secret")
  }
  return installed
}

function waitForOAuthCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url || "/", REDIRECT_URI)
      const code = url.searchParams.get("code")
      const error = url.searchParams.get("error")

      response.setHeader("Content-Type", "text/html; charset=utf-8")

      if (error) {
        response.end("<h1>Nexus Google authorization failed</h1><p>You can close this tab.</p>")
        server.close()
        reject(new Error(`Google OAuth failed: ${error}`))
        return
      }

      if (!code) {
        response.statusCode = 404
        response.end("Missing OAuth code")
        return
      }

      response.end("<h1>Nexus Finance Sheet connected</h1><p>You can close this tab and go back to Terminal.</p>")
      server.close()
      resolve(code)
    })

    server.listen(PORT, "localhost", () => {
      console.log(`Waiting for Google OAuth callback on ${REDIRECT_URI}`)
    })

    server.on("error", reject)
  })
}

async function upsertEnvValue(filePath, updates) {
  let text = ""
  try {
    text = await fs.readFile(filePath, "utf8")
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }

  for (const [key, value] of Object.entries(updates)) {
    const escaped = String(value ?? "").replace(/\n/g, "\\n")
    const line = `${key}=${escaped}`
    const pattern = new RegExp(`^${key}=.*$`, "m")
    text = pattern.test(text)
      ? text.replace(pattern, line)
      : `${text.trimEnd()}\n${line}\n`
  }

  await fs.writeFile(filePath, text)
}

async function main() {
  const secret = JSON.parse(await fs.readFile(CLIENT_SECRET_FILE, "utf8"))
  const credentials = getInstalledCredentials(secret)
  const oauth = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    REDIRECT_URI
  )

  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  })

  const codePromise = waitForOAuthCode()
  console.log("\nOpen this URL, approve Google access, then return here:\n")
  console.log(authUrl)
  execFile("open", [authUrl], () => {})

  const code = await codePromise
  const { tokens } = await oauth.getToken(code)
  oauth.setCredentials(tokens)

  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token. Re-run with prompt=consent or remove previous app access in Google Account security settings.")
  }

  const sheets = google.sheets({ version: "v4", auth: oauth })
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: "Nexus Finance Dashboard - PnL 2025",
        timeZone: "Asia/Jakarta",
      },
      sheets: [
        {
          properties: {
            title: "PnL",
            gridProperties: { frozenRowCount: 1, rowCount: 100, columnCount: 8 },
          },
        },
        {
          properties: {
            title: "Instructions",
            gridProperties: { rowCount: 20, columnCount: 6 },
          },
        },
      ],
    },
  })

  const spreadsheetId = created.data.spreadsheetId
  const spreadsheetUrl = created.data.spreadsheetUrl

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: "PnL!A1:F13", values: rows },
        { range: "Instructions!A1:A5", values: instructions },
      ],
    },
  })

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: created.data.sheets?.[0]?.properties?.sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 6,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.06, green: 0.09, blue: 0.16 },
                textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: created.data.sheets?.[0]?.properties?.sheetId,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: 6,
            },
          },
        },
      ],
    },
  })

  await upsertEnvValue(ENV_FILE, {
    GOOGLE_OAUTH_CLIENT_ID: credentials.client_id,
    GOOGLE_OAUTH_CLIENT_SECRET: credentials.client_secret,
    GOOGLE_OAUTH_REFRESH_TOKEN: tokens.refresh_token,
    FINANCE_DASHBOARD_SHEET_ID: spreadsheetId,
    FINANCE_DASHBOARD_SHEET_RANGE: "PnL!A:F",
  })

  console.log("\nCreated and connected Nexus Finance Dashboard sheet.")
  console.log(`Spreadsheet URL: ${spreadsheetUrl}`)
  console.log(`Updated env file: ${ENV_FILE}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
