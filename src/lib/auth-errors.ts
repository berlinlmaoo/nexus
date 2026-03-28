/** Maps NextAuth `?error=` query values to user-facing copy (server or client). */
export function bannersFromAuthSearchParams(
  registered: string | undefined,
  error: string | undefined
): { success: string | null; error: string | null } {
  let success: string | null = null
  let errorMsg: string | null = null

  if (error) {
    switch (error) {
      case 'AccessDenied':
        errorMsg = 'Access denied. Please try again or use a different sign-in method.'
        break
      case 'CredentialsSignin':
      case 'credentials':
        errorMsg = 'Invalid email or password.'
        break
      case 'missing':
        errorMsg = 'Email and password are required.'
        break
      case 'Configuration':
        errorMsg =
          'Sign-in could not complete (auth configuration). Set AUTH_SECRET in .env, set NEXTAUTH_URL to this app’s exact URL (including port, e.g. http://localhost:3001), restart the dev server, then try again.'
        break
      default:
        errorMsg = 'Something went wrong. Please try again.'
    }
  } else if (registered === 'true') {
    success = 'Account created successfully! Please sign in.'
  }

  return { success, error: errorMsg }
}

export function firstSearchParam(
  v: string | string[] | undefined
): string | undefined {
  if (v === undefined) return undefined
  return Array.isArray(v) ? v[0] : v
}
