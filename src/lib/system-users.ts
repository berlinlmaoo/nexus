import { GIDEON_EMAIL } from '@/lib/gideon-identity'
import { AUTOMATION_EMAIL } from '@/lib/automation-identity'

/**
 * Accounts that exist only to sign what the system writes (GIDEON, Automation). They have no membership,
 * but the few queries that read User directly (invite pickers, Control Room users, app installs) must
 * leave them out too.
 */
export const SYSTEM_USER_EMAILS = [GIDEON_EMAIL, AUTOMATION_EMAIL]

export function isSystemUserEmail(email: string | null | undefined): boolean {
  return !!email && SYSTEM_USER_EMAILS.includes(email.toLowerCase())
}
