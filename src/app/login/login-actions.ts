'use server'

import { signIn } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createLogger } from '@/lib/logger'
import { canonicalEmail } from '@/lib/email-auth'

const log = createLogger('login')
const FALLBACK_REDIRECT = '/dashboard'

function isNextRedirectError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'digest' in e &&
    typeof (e as { digest: unknown }).digest === 'string' &&
    String((e as { digest: string }).digest).startsWith('NEXT_REDIRECT')
  )
}

export async function loginAction(formData: FormData) {
  const email = canonicalEmail(String(formData.get('email') ?? ''))
  const password = String(formData.get('password') ?? '')
  const requestedCallbackUrl = String(formData.get('callbackUrl') ?? FALLBACK_REDIRECT)
  const redirectTo = requestedCallbackUrl.startsWith('/') && !requestedCallbackUrl.startsWith('//')
    ? requestedCallbackUrl
    : FALLBACK_REDIRECT

  if (!email || !password) {
    redirect('/login?error=missing')
  }

  try {
    await signIn('credentials', {
      email,
      password,
      redirectTo,
    })
  } catch (e) {
    if (isNextRedirectError(e)) {
      throw e
    }
    log.error('signIn failed', { error: String(e) })
    redirect('/login?error=CredentialsSignin')
  }
}
