import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'

export const dynamic = "force-dynamic"

export default async function Home() {
  const session = await auth().catch((err) => {
    console.warn('[auth] session read failed, treating as signed out:', err)
    return null
  })

  if (session?.user) {
    redirect('/dashboard')
  } else {
    redirect('/login')
  }
}
