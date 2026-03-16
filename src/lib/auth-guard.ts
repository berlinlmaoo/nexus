import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'

export async function getServerAuth() {
  const session = await auth()

  if (!session || !session.user) {
    redirect('/login')
  }

  return session
}
