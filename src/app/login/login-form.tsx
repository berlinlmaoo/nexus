"use client"

import Link from "next/link"
import { FormEvent, useEffect, useId, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { Loader2, ArrowRight, Eye, EyeOff } from "lucide-react"
import * as z from "zod"

const formSchema = z.object({
  email: z.string().email({
    message: "A valid operative email is required.",
  }),
  password: z.string().min(8, {
    message: "Security protocol requires at least 8 characters.",
  }),
})

const DASHBOARD_HOSTS = new Set([
  "dashboard.nexus.patsgroup.id",
  "dashboard-nexus.patsgroup.id",
])

function isDashboardHost() {
  if (typeof window === "undefined") return false
  return DASHBOARD_HOSTS.has(window.location.hostname.toLowerCase())
}

function getCallbackUrl(requestedCallbackUrl: string | null | undefined) {
  const fallback = isDashboardHost() ? "/ops-dashboard" : "/dashboard"

  if (!requestedCallbackUrl) return fallback
  if (!requestedCallbackUrl.startsWith("/") || requestedCallbackUrl.startsWith("//")) return fallback
  if (isDashboardHost() && requestedCallbackUrl === "/dashboard") return "/ops-dashboard"

  return requestedCallbackUrl
}

export function LoginForm() {
  const searchParams = useSearchParams()
  const callbackUrl = getCallbackUrl(searchParams?.get("callbackUrl"))
  const registered = searchParams?.get("registered")
  const passwordReset = searchParams?.get("passwordReset")
  const loginError = searchParams?.get("error")
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [hasShownStatusToast, setHasShownStatusToast] = useState(false)
  const fieldNonce = useId().replace(/:/g, "")

  // ── Field-level error state (replaces react-hook-form error display) ──
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // ── Direct DOM refs — immune to autofill / RHF state drift ──
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const userTouchedFieldRef = useRef(false)

  const markUserTouchedField = () => {
    userTouchedFieldRef.current = true
  }

  const clearLoginFields = () => {
    if (userTouchedFieldRef.current) return
    if (emailRef.current) emailRef.current.value = ""
    if (passwordRef.current) passwordRef.current.value = ""
  }

  const submitNavigationLogin = (email: string, password: string) => {
    const form = document.createElement("form")
    form.method = "POST"
    form.action = "/api/auth/callback/credentials"
    form.style.display = "none"

    const fields = {
      email,
      password,
      callbackUrl,
    }

    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement("input")
      input.type = "hidden"
      input.name = name
      input.value = value
      form.appendChild(input)
    }

    document.body.appendChild(form)
    form.submit()
  }

  // Reload on bfcache restore so stale React state is never reused.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload()
      }
    }

    window.addEventListener("pageshow", handlePageShow)
    return () => window.removeEventListener("pageshow", handlePageShow)
  }, [])

  // Safari can restore or autofill stale saved credentials after password reset
  // without dispatching input/change events. Keep the real credential fields
  // empty until the user actively types in them.
  useEffect(() => {
    clearLoginFields()
    const timers = [100, 400, 900].map((delay) => window.setTimeout(clearLoginFields, delay))

    return () => {
      timers.forEach(window.clearTimeout)
    }
  }, [passwordReset])

  // Status toasts for registration / password-reset redirects.
  useEffect(() => {
    if (hasShownStatusToast) return

    if (loginError) {
      toast.error("Access Denied", {
        description:
          loginError === "missing"
            ? "Email and password are required."
            : "Verification failed. Please check your credentials.",
      })
      setHasShownStatusToast(true)
      return
    }

    if (registered === "true") {
      toast.success("Identity Verified", {
        description: "Your operative profile is ready. Continue with login.",
      })
      setHasShownStatusToast(true)
      return
    }

    if (passwordReset === "true") {
      toast.success("Password Reset Complete", {
        description: "Your new access cipher is active. Continue with login.",
      })
      setHasShownStatusToast(true)
    }
  }, [registered, passwordReset, loginError, hasShownStatusToast])

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setEmailError(null)
    setPasswordError(null)

    // ── 1. Read values directly from the DOM at submit time ──
    // This is the authoritative source — never rely on React/RHF state which
    // can diverge from what the user sees when a password manager silently
    // injects saved credentials without triggering onChange.
    const emailValue = (emailRef.current?.value ?? "").trim()
    const passwordValue = passwordRef.current?.value ?? ""

    // ── 2. Validate ──
    const parsed = formSchema.safeParse({
      email: emailValue,
      password: passwordValue,
    })

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors
      if (fieldErrors.email?.[0]) {
        setEmailError(fieldErrors.email[0])
      }
      if (fieldErrors.password?.[0]) {
        setPasswordError(fieldErrors.password[0])
      }
      return
    }

    setIsLoading(true)
    try {
      // Classic form navigation is intentionally boring, and that's the point:
      // older Safari/iOS reliably persists Set-Cookie from navigation responses,
      // while fetch-based credential callbacks can silently drop the session.
      submitNavigationLogin(parsed.data.email, parsed.data.password)
    } catch {
      toast.error("System Error", {
        description: "An unexpected error occurred during protocol initiation.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/*
        Using a plain <form> with uncontrolled inputs + refs.
        This guarantees the submit handler always reads whatever the user
        actually typed/sees — not what react-hook-form thinks the value is.
      */}
      <form
        action="/api/auth/callback/credentials"
        method="POST"
        autoComplete="off"
        data-form-type="other"
        onSubmit={handleLoginSubmit}
        className="space-y-6"
      >
        {/* Offscreen decoy fields absorb Safari/password-manager autofill. */}
        <div className="pointer-events-none absolute -left-[9999px] top-auto h-px w-px overflow-hidden opacity-0" aria-hidden="true">
          <input type="text" name="email" autoComplete="username" tabIndex={-1} />
          <input type="password" name="password" autoComplete="current-password" tabIndex={-1} />
        </div>

        <div className="space-y-4">
          {/* Email */}
          <div className="space-y-1.5">
            <label
              htmlFor="login-email"
              className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1"
            >
              Operative Email
            </label>
            <input
              ref={emailRef}
              id="login-email"
              name={`nexus-email-${fieldNonce}`}
              type="email"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              data-form-type="other"
              data-lpignore="true"
              data-1p-ignore="true"
              placeholder="name@agency.com"
              spellCheck={false}
              onInput={markUserTouchedField}
              onFocus={markUserTouchedField}
              className="w-full h-12 bg-surface-container-low border-none rounded-2xl px-4 text-sm font-bold text-on-surface placeholder:text-on-surface-variant/20 focus:ring-2 focus:ring-primary/5 focus:bg-surface-container-lowest transition-all outline-none"
            />
            {emailError && (
              <p className="text-[10px] font-bold text-error ml-1">{emailError}</p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label
              htmlFor="login-password"
              className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1"
            >
              Access Cipher
            </label>
            <div className="relative">
              <input
                ref={passwordRef}
                id="login-password"
                name={`nexus-password-${fieldNonce}`}
                type={showPassword ? "text" : "password"}
                autoCapitalize="none"
                autoComplete="new-password"
                autoCorrect="off"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                placeholder="••••••••"
                spellCheck={false}
                onInput={markUserTouchedField}
                onFocus={markUserTouchedField}
                className="w-full h-12 bg-surface-container-low border-none rounded-2xl pl-4 pr-12 text-sm font-bold text-on-surface placeholder:text-on-surface-variant/20 focus:ring-2 focus:ring-primary/5 focus:bg-surface-container-lowest transition-all outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-on-surface-variant/40 transition-colors hover:text-on-surface"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {passwordError && (
              <p className="text-[10px] font-bold text-error ml-1">{passwordError}</p>
            )}
          </div>

          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/70 transition-colors hover:text-primary"
            >
              Reset Password
            </Link>
          </div>
        </div>

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-14 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:shadow-2xl hover:shadow-primary/20 transition-all duration-300 group shadow-lg"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Synchronize Identity
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </Button>
      </form>
    </div>
  )
}
