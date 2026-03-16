/**
 * Google Drive API client
 * Uses googleapis library with OAuth2 or API key authentication
 */

import { google, type drive_v3 } from "googleapis"

const CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID || ""
const CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET || ""
const REDIRECT_URI =
  process.env.GOOGLE_DRIVE_REDIRECT_URI ||
  "http://localhost:3000/api/drive/auth"
const API_KEY = process.env.GOOGLE_DRIVE_API_KEY || ""

// ── OAuth2 Client ────────────────────────────────────

export function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
}

export function getAuthUrl(state?: string): string {
  const oauth2Client = getOAuth2Client()
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
    state: state || "",
    prompt: "consent",
  })
}

export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = getOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)
  return tokens
}

// ── Drive Client ─────────────────────────────────────

function getDriveClient(accessToken?: string): drive_v3.Drive {
  if (accessToken) {
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({ access_token: accessToken })
    return google.drive({ version: "v3", auth: oauth2Client })
  }

  // Fall back to API key mode (read-only, public files)
  if (API_KEY) {
    return google.drive({ version: "v3", auth: API_KEY })
  }

  throw new DriveError("No authentication configured for Google Drive")
}

// ── File Operations ──────────────────────────────────

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size: number
  modifiedTime: string
  iconLink: string
  thumbnailLink: string | null
  webViewLink: string | null
  parents: string[]
}

export interface DriveListResult {
  files: DriveFile[]
  nextPageToken: string | null
}

export async function listFiles(
  accessToken: string,
  options: {
    folderId?: string
    query?: string
    pageToken?: string
    pageSize?: number
    orderBy?: string
  } = {}
): Promise<DriveListResult> {
  const drive = getDriveClient(accessToken)

  const {
    folderId,
    query,
    pageToken,
    pageSize = 50,
    orderBy = "folder,modifiedTime desc",
  } = options

  let q = "trashed = false"
  if (folderId) {
    q += ` and '${folderId}' in parents`
  }
  if (query) {
    q += ` and name contains '${query.replace(/'/g, "\\'")}'`
  }

  const res = await drive.files.list({
    q,
    pageSize,
    pageToken: pageToken || undefined,
    orderBy,
    fields:
      "nextPageToken, files(id, name, mimeType, size, modifiedTime, iconLink, thumbnailLink, webViewLink, parents)",
  })

  const files: DriveFile[] = (res.data.files || []).map((f) => ({
    id: f.id || "",
    name: f.name || "",
    mimeType: f.mimeType || "",
    size: parseInt(f.size || "0", 10),
    modifiedTime: f.modifiedTime || "",
    iconLink: f.iconLink || "",
    thumbnailLink: f.thumbnailLink || null,
    webViewLink: f.webViewLink || null,
    parents: (f.parents as string[]) || [],
  }))

  return {
    files,
    nextPageToken: res.data.nextPageToken || null,
  }
}

export async function searchFiles(
  accessToken: string,
  query: string,
  pageSize = 25
): Promise<DriveFile[]> {
  const result = await listFiles(accessToken, { query, pageSize })
  return result.files
}

export async function getFileMetadata(
  accessToken: string,
  fileId: string
): Promise<DriveFile> {
  const drive = getDriveClient(accessToken)

  const res = await drive.files.get({
    fileId,
    fields:
      "id, name, mimeType, size, modifiedTime, iconLink, thumbnailLink, webViewLink, parents",
  })

  return {
    id: res.data.id || "",
    name: res.data.name || "",
    mimeType: res.data.mimeType || "",
    size: parseInt(res.data.size || "0", 10),
    modifiedTime: res.data.modifiedTime || "",
    iconLink: res.data.iconLink || "",
    thumbnailLink: res.data.thumbnailLink || null,
    webViewLink: res.data.webViewLink || null,
    parents: (res.data.parents as string[]) || [],
  }
}

export async function downloadFile(
  accessToken: string,
  fileId: string
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string; name: string }> {
  const drive = getDriveClient(accessToken)

  // Get file metadata for name/type
  const meta = await drive.files.get({
    fileId,
    fields: "name, mimeType",
  })

  const mimeType = meta.data.mimeType || ""

  // For Google Workspace files, export as PDF
  const googleMimeTypes: Record<string, string> = {
    "application/vnd.google-apps.document": "application/pdf",
    "application/vnd.google-apps.spreadsheet":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.google-apps.presentation": "application/pdf",
  }

  let stream: NodeJS.ReadableStream

  if (googleMimeTypes[mimeType]) {
    const res = await drive.files.export(
      { fileId, mimeType: googleMimeTypes[mimeType] },
      { responseType: "stream" }
    )
    stream = res.data as unknown as NodeJS.ReadableStream
  } else {
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    )
    stream = res.data as unknown as NodeJS.ReadableStream
  }

  return {
    stream,
    mimeType: googleMimeTypes[mimeType] || mimeType,
    name: meta.data.name || "file",
  }
}

export async function uploadFile(
  accessToken: string,
  options: {
    name: string
    mimeType: string
    body: NodeJS.ReadableStream | Buffer
    folderId?: string
  }
): Promise<DriveFile> {
  const drive = getDriveClient(accessToken)

  const fileMetadata: drive_v3.Schema$File = {
    name: options.name,
  }

  if (options.folderId) {
    fileMetadata.parents = [options.folderId]
  }

  const res = await drive.files.create({
    requestBody: fileMetadata,
    media: {
      mimeType: options.mimeType,
      body: options.body,
    },
    fields:
      "id, name, mimeType, size, modifiedTime, iconLink, thumbnailLink, webViewLink, parents",
  })

  return {
    id: res.data.id || "",
    name: res.data.name || "",
    mimeType: res.data.mimeType || "",
    size: parseInt(res.data.size || "0", 10),
    modifiedTime: res.data.modifiedTime || "",
    iconLink: res.data.iconLink || "",
    thumbnailLink: res.data.thumbnailLink || null,
    webViewLink: res.data.webViewLink || null,
    parents: (res.data.parents as string[]) || [],
  }
}

export async function createFolder(
  accessToken: string,
  name: string,
  parentId?: string
): Promise<DriveFile> {
  const drive = getDriveClient(accessToken)

  const fileMetadata: drive_v3.Schema$File = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  }

  if (parentId) {
    fileMetadata.parents = [parentId]
  }

  const res = await drive.files.create({
    requestBody: fileMetadata,
    fields:
      "id, name, mimeType, size, modifiedTime, iconLink, thumbnailLink, webViewLink, parents",
  })

  return {
    id: res.data.id || "",
    name: res.data.name || "",
    mimeType: res.data.mimeType || "",
    size: 0,
    modifiedTime: res.data.modifiedTime || "",
    iconLink: res.data.iconLink || "",
    thumbnailLink: res.data.thumbnailLink || null,
    webViewLink: res.data.webViewLink || null,
    parents: (res.data.parents as string[]) || [],
  }
}

// ── Token Management ─────────────────────────────────

// In-memory token store (per user). In production, store encrypted in DB.
const tokenStore = new Map<
  string,
  { accessToken: string; refreshToken?: string; expiresAt: number }
>()

export function storeTokens(
  userId: string,
  tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null }
) {
  tokenStore.set(userId, {
    accessToken: tokens.access_token || "",
    refreshToken: tokens.refresh_token || undefined,
    expiresAt: tokens.expiry_date || Date.now() + 3600 * 1000,
  })
}

export async function getAccessToken(userId: string): Promise<string | null> {
  const stored = tokenStore.get(userId)
  if (!stored) return null

  // Check if token is expired
  if (stored.expiresAt < Date.now() && stored.refreshToken) {
    try {
      const oauth2Client = getOAuth2Client()
      oauth2Client.setCredentials({ refresh_token: stored.refreshToken })
      const { credentials } = await oauth2Client.refreshAccessToken()
      storeTokens(userId, credentials)
      return credentials.access_token || null
    } catch {
      tokenStore.delete(userId)
      return null
    }
  }

  return stored.accessToken || null
}

export function hasTokens(userId: string): boolean {
  return tokenStore.has(userId)
}

// ── Error class ──────────────────────────────────────

export class DriveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DriveError"
  }
}
