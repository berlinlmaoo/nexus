'use server'

import { signIn } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createLogger } from '@/lib/logger'

const log = createLogger('login')

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
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) {
    redirect('/login?error=missing')
  }

  try {
    await signIn('credentials', {
      email,
      password,
      redirectTo: '/dashboard',
    })
  } catch (e) {
    if (isNextRedirectError(e)) {
      throw e
    }
    log.error('signIn failed', { error: String(e) })
    redirect('/login?error=Configuration')
  }
}
