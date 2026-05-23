import crypto from "crypto"
import bcrypt from "bcryptjs"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"

export const FINANCE_DASHBOARD_COOKIE = "nexus_finance_dashboard_v2"
const SESSION_MAX_AGE_SECONDS = 30 * 60

interface FinanceDashboardToken {
  projectId: string
  userId: string
  exp: number
}

function getAuthSecret() {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? ""
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url")
}

function signPayload(payload: string) {
  return crypto
    .createHmac("sha256", getAuthSecret())
    .update(payload)
    .digest("base64url")
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export function isFinanceDashboardPasswordConfigured() {
  return Boolean(
    process.env.FINANCE_DASHBOARD_PASSWORD_HASH ||
      process.env.FINANCE_DASHBOARD_PASSWORD
  )
}

export async function verifyFinanceDashboardPassword(password: string) {
  const hash = process.env.FINANCE_DASHBOARD_PASSWORD_HASH
  const plainPassword = process.env.FINANCE_DASHBOARD_PASSWORD

  if (!password || !isFinanceDashboardPasswordConfigured()) return false

  if (hash) {
    return bcrypt.compare(password, hash)
  }

  return safeEqual(password, plainPassword ?? "")
}

export function createFinanceDashboardToken(userId: string, projectId: string) {
  if (!getAuthSecret()) {
    throw new Error("Missing AUTH_SECRET/NEXTAUTH_SECRET")
  }

  const payload: FinanceDashboardToken = {
    userId,
    projectId,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  }
  const encodedPayload = base64Url(JSON.stringify(payload))
  const signature = signPayload(encodedPayload)

  return `${encodedPayload}.${signature}`
}

export function verifyFinanceDashboardToken(
  token: string | undefined,
  userId: string,
  projectId: string
) {
  if (!token || !getAuthSecret()) return false

  const [encodedPayload, signature] = token.split(".")
  if (!encodedPayload || !signature) return false
  if (!safeEqual(signPayload(encodedPayload), signature)) return false

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as FinanceDashboardToken

    return (
      payload.userId === userId &&
      payload.projectId === projectId &&
      payload.exp > Math.floor(Date.now() / 1000)
    )
  } catch {
    return false
  }
}

export function financeDashboardCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure:
      process.env.NODE_ENV === "production" ||
      (process.env.NEXTAUTH_URL?.startsWith("https://") ?? false),
    path: "/api/finance-dashboard",
    maxAge: SESSION_MAX_AGE_SECONDS,
  }
}

export function isFinanceProjectName(name: string) {
  return name.toLowerCase().includes("finance")
}

export async function getAccessibleFinanceProject(
  userId: string,
  projectId: string
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      color: true,
      icon: true,
      description: true,
    },
  })

  if (!project || !isFinanceProjectName(project.name)) return null

  const { allowed } = await checkProjectAccess(userId, projectId, ["MEMBER"])
  if (!allowed) return null

  return project
}
