'use client'

import Link from 'next/link'
import { useFormStatus } from 'react-dom'
import { loginAction } from './login-actions'

type Props = {
  /** Rendered on the server from ?registered= / ?error= so it shows even if the client bundle fails to load. */
  serverSuccess: string | null
  serverError: string | null
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-2.5 px-4 mt-1 bg-white text-black text-sm font-semibold rounded-lg hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#0A0A0C] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
    >
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Signing in...
        </span>
      ) : (
        'Sign in'
      )}
    </button>
  )
}

export function LoginForm({ serverSuccess, serverError }: Props) {
  return (
    <>
      {serverSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-sm text-emerald-400 transition-all duration-200 mb-5">
          {serverSuccess}
        </div>
      )}
      {serverError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400 transition-all duration-200 mb-5">
          {serverError}
        </div>
      )}

      <form action={loginAction} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-medium text-gray-400">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            required
            autoComplete="email"
            className="w-full px-4 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all duration-200"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-gray-400">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="Enter your password"
            required
            autoComplete="current-password"
            className="w-full px-4 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all duration-200"
          />
        </div>

        <SubmitButton />
      </form>

      <div className="mt-6 text-center">
        <p className="text-sm text-gray-400">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-white hover:text-gray-300 font-medium transition-colors duration-200">
            Create one
          </Link>
        </p>
      </div>
    </>
  )
}
