"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { OtpCodeInput } from "@/components/auth/otp-code-input"
import { toast } from "sonner"
import { ArrowRight, Eye, EyeOff, Loader2, RotateCcw, ShieldAlert } from "lucide-react"

const requestFormSchema = z.object({
  email: z.string().email({
    message: "A valid operative email is required.",
  }),
})

const resetFormSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/, {
      message: "Enter the 6-digit verification code.",
    }),
    password: z.string().min(8, {
      message: "Security protocol requires at least 8 characters.",
    }),
    confirmPassword: z.string().min(8, {
      message: "Please repeat the new password.",
    }),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "New password confirmation does not match.",
    path: ["confirmPassword"],
  })

type RequestValues = z.infer<typeof requestFormSchema>
type ResetValues = z.infer<typeof resetFormSchema>
type ResetStep = "request" | "verify"

function formatCooldown(seconds: number) {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
}

function getPasswordStrengthLabel(password: string) {
  if (!password) return "Use at least 8 characters with mixed case, numbers, or symbols."

  let score = 0
  if (password.length >= 8) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1

  if (score <= 1) return "Weak password. Add uppercase, numbers, or symbols."
  if (score <= 3) return "Decent password. One more variation will make it stronger."
  return "Strong password. Good to go."
}

export function ResetPasswordForm() {
  const router = useRouter()
  const [step, setStep] = useState<ResetStep>("request")
  const [pendingEmail, setPendingEmail] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  const requestForm = useForm<RequestValues>({
    resolver: zodResolver(requestFormSchema),
    defaultValues: {
      email: "",
    },
  })

  const resetForm = useForm<ResetValues>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: {
      code: "",
      password: "",
      confirmPassword: "",
    },
  })

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timeout = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearTimeout(timeout)
  }, [resendCooldown])

  async function onRequestCode(values: RequestValues) {
    setIsSubmitting(true)
    try {
      const response = await fetch("/api/auth/password/reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })

      const contentType = response.headers.get("content-type") || ""
      const data = contentType.includes("application/json") ? await response.json() : null

      if (!response.ok) {
        toast.error("Reset Request Failed", {
          description:
            data?.error ||
            data?.message ||
            "We could not start the password reset protocol right now.",
        })
        return
      }

      setPendingEmail(values.email)
      setResendCooldown(data?.resendCooldownSeconds ?? 60)
      setStep("verify")
      resetForm.reset({
        code: "",
        password: "",
        confirmPassword: "",
      })

      toast.success("Verification code dispatched", {
        description: "If the operative account exists, a 6-digit reset code is on its way.",
      })
    } catch {
      toast.error("System Error", {
        description: "An unexpected error occurred while starting the reset flow.",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function onVerify(values: ResetValues) {
    setIsVerifying(true)
    try {
      const response = await fetch("/api/auth/password/reset/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: pendingEmail,
          code: values.code,
          password: values.password,
        }),
      })

      const contentType = response.headers.get("content-type") || ""
      const data = contentType.includes("application/json") ? await response.json() : null

      if (!response.ok) {
        toast.error("Reset Failed", {
          description:
            data?.error ||
            data?.message ||
            "The password reset code could not be validated.",
        })
        return
      }

      toast.success("Password Updated", {
        description: "Your access cipher has been reset. Continue to login.",
      })
      router.push("/login?passwordReset=true")
    } catch {
      toast.error("System Error", {
        description: "An unexpected error occurred during password reset.",
      })
    } finally {
      setIsVerifying(false)
    }
  }

  async function onResend() {
    if (!pendingEmail || resendCooldown > 0) return

    setIsResending(true)
    try {
      const response = await fetch("/api/auth/password/reset/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail }),
      })

      const contentType = response.headers.get("content-type") || ""
      const data = contentType.includes("application/json") ? await response.json() : null

      if (!response.ok) {
        toast.error("Unable to resend code", {
          description:
            data?.error ||
            data?.message ||
            "We could not send another reset code right now.",
        })
        if (typeof data?.retryAfterSeconds === "number") {
          setResendCooldown(data.retryAfterSeconds)
        }
        return
      }

      setResendCooldown(data?.resendCooldownSeconds ?? 60)
      resetForm.setValue("code", "")

      toast.success("Reset code resent", {
        description: "If the operative account exists, a fresh code has been dispatched.",
      })
    } catch {
      toast.error("System Error", {
        description: "An unexpected error occurred while resending the reset code.",
      })
    } finally {
      setIsResending(false)
    }
  }

  function onChangeEmail() {
    setStep("request")
    setPendingEmail("")
    setResendCooldown(0)
    requestForm.reset({ email: "" })
    resetForm.reset({
      code: "",
      password: "",
      confirmPassword: "",
    })
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {step === "request" ? (
        <Form {...requestForm}>
          <form onSubmit={requestForm.handleSubmit(onRequestCode)} className="space-y-6">
            <FormField
              control={requestForm.control}
              name="email"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
                    Operative Email
                  </FormLabel>
                  <FormControl>
                    <input
                      placeholder="name@agency.com"
                      {...field}
                      className="h-12 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 transition-all focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/5"
                    />
                  </FormControl>
                  <FormMessage className="ml-1 text-[10px] font-bold text-error" />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              disabled={isSubmitting}
              className="group h-14 w-full rounded-2xl bg-primary text-xs font-black uppercase tracking-[0.2em] text-primary-foreground transition-all duration-300 hover:shadow-2xl hover:shadow-primary/20"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Send Reset Code
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </Button>
          </form>
        </Form>
      ) : (
        <div className="space-y-6">
          <div className="rounded-[28px] border border-on-surface-variant/5 bg-surface-container-low p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl bg-primary/10 p-2 text-primary">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-on-surface-variant/40">
                  Password Reset
                </p>
                <p className="text-sm font-bold text-primary">
                  Enter the code sent to {pendingEmail}
                </p>
                <p className="text-xs font-medium leading-relaxed text-on-surface-variant/55">
                  We will unlock a new access cipher after the code is verified.
                </p>
              </div>
            </div>
          </div>

          <Form {...resetForm}>
            <form onSubmit={resetForm.handleSubmit(onVerify)} className="space-y-6">
              <FormField
                control={resetForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
                      Verification Code
                    </FormLabel>
                    <FormControl>
                      <OtpCodeInput
                        value={field.value}
                        onChange={field.onChange}
                        disabled={isVerifying}
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage className="ml-1 text-[10px] font-bold text-error" />
                  </FormItem>
                )}
              />

              <FormField
                control={resetForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
                      New Access Cipher
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          {...field}
                          className="h-12 w-full rounded-2xl border-none bg-surface-container-low px-4 pr-12 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 transition-all focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/5"
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
                    </FormControl>
                    <p className="ml-1 text-[10px] font-bold text-on-surface-variant/45">
                      {getPasswordStrengthLabel(field.value)}
                    </p>
                    <FormMessage className="ml-1 text-[10px] font-bold text-error" />
                  </FormItem>
                )}
              />

              <FormField
                control={resetForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
                      Confirm New Cipher
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="••••••••"
                          {...field}
                          className="h-12 w-full rounded-2xl border-none bg-surface-container-low px-4 pr-12 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 transition-all focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/5"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword((current) => !current)}
                          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-on-surface-variant/40 transition-colors hover:text-on-surface"
                          aria-label={showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"}
                        >
                          {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage className="ml-1 text-[10px] font-bold text-error" />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={isVerifying}
                className="group h-14 w-full rounded-2xl bg-primary text-xs font-black uppercase tracking-[0.2em] text-primary-foreground transition-all duration-300 hover:shadow-2xl hover:shadow-primary/20"
              >
                {isVerifying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Reset Password
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            </form>
          </Form>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={onResend}
              disabled={isResending || resendCooldown > 0}
              className="h-12 flex-1 rounded-2xl border-on-surface-variant/10 bg-transparent text-[11px] font-black uppercase tracking-[0.18em]"
            >
              {isResending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : resendCooldown > 0 ? (
                `Resend in ${formatCooldown(resendCooldown)}`
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Resend Code
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={onChangeEmail}
              className="h-12 rounded-2xl text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant/55"
            >
              Change Email
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
