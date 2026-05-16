import bcrypt from 'bcryptjs'
import prisma from '@/lib/prisma'
import { canonicalEmail, normalizePasswordForMobileInput } from '@/lib/email-auth'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth')

export type VerifiedCredentialUser = {
  id: string
  name: string | null
  email: string
  image: string | null
}

export async function verifyCredentialUser(rawEmail: unknown, rawPassword: unknown) {
  const email =
    typeof rawEmail === 'string'
      ? canonicalEmail(rawEmail)
      : canonicalEmail(String(rawEmail ?? ''))
  const password =
    typeof rawPassword === 'string'
      ? rawPassword
      : String(rawPassword ?? '')

  if (!email || !password) {
    log.warn('credentials login: missing email or password', { email: email || '<empty>' })
    return null
  }

  log.info('credentials login attempt', { email })

  try {
    // Always read directly from PostgreSQL so password resets are immediately
    // respected even when a browser keeps old login-page state alive.
    let user = await prisma.user.findUnique({ where: { email } })

    if (!user) {
      try {
        user = await prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
        })
      } catch {
        /* case-insensitive mode unavailable or DB error; unique lookup already failed */
      }
    }

    if (!user) {
      log.warn('credentials login: user not found', { email })
      return null
    }

    if (!user.password) {
      log.warn('credentials login: user has no password set', { email, userId: user.id })
      return null
    }

    const passwordCandidates = [password]
    const mobileNormalizedPassword = normalizePasswordForMobileInput(password)

    if (mobileNormalizedPassword && mobileNormalizedPassword !== password) {
      passwordCandidates.push(mobileNormalizedPassword)
    }

    let isPasswordValid = false
    let usedMobileNormalizedPassword = false

    for (const candidate of passwordCandidates) {
      // eslint-disable-next-line no-await-in-loop
      isPasswordValid = await bcrypt.compare(candidate, user.password)
      if (isPasswordValid) {
        usedMobileNormalizedPassword = candidate !== password
        break
      }
    }

    if (!isPasswordValid) {
      log.warn('credentials login: invalid password', {
        email,
        userId: user.id,
        passwordLength: password.length,
        normalizedPasswordLength: mobileNormalizedPassword.length,
        normalizedPasswordDifferent: mobileNormalizedPassword !== password,
      })
      return null
    }

    log.info('credentials login: success', {
      email,
      userId: user.id,
      usedMobileNormalizedPassword,
    })

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.avatar,
      } satisfies VerifiedCredentialUser,
      usedMobileNormalizedPassword,
    }
  } catch (e) {
    log.error('credentials authorize failed', { email, error: String(e) })
    return null
  }
}
