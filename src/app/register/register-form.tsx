"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { toast } from "sonner"
import { Loader2, ArrowRight, RotateCcw, ShieldCheck } from "lucide-react"
import { OtpCodeInput } from "@/components/auth/otp-code-input"

const registerFormSchema = z.object({
  name: z.string().min(2, {
    message: "Designation must be at least 2 characters.",
  }),
  email: z.string().email({
    message: "A valid operative email is required.",
  }),
  password: z.string().min(8, {
    message: "Security protocol requires at least 8 characters.",
  }),
})

const otpFormSchema = z.object({
  code: z.string().regex(/^\d{6}$/, {
    message: "Enter the 6-digit verification code.",
  }),
})

type RegisterValues = z.infer<typeof registerFormSchema>
type OtpValues = z.infer<typeof otpFormSchema>
type RegisterStep = "request" | "verify"

function formatCooldown(seconds: number) {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
}

export function RegisterForm() {
  const router = useRouter()
  const [step, setStep] = useState<RegisterStep>("request")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [pendingEmail, setPendingEmail] = useState("")
  const [resendCooldown, setResendCooldown] = useState(0)

  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  })

  const otpForm = useForm<OtpValues>({
    resolver: zodResolver(otpFormSchema),
    defaultValues: {
      code: "",
    },
  })

  useEffect(() => {
    if (resendCooldown <= 0) return

    const timeout = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearTimeout(timeout)
  }, [resendCooldown])

  async function onRequestOtp(values: RegisterValues) {
    setIsSubmitting(true)
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })

      const contentType = response.headers.get("content-type") || ""
      const data = contentType.includes("application/json") ? await response.json() : null

      if (!response.ok) {
        toast.error("Provisioning Failed", {
          description:
            data?.error ||
            data?.message ||
            "An error occurred while sending the verification code.",
        })
        return
      }

      setPendingEmail(values.email)
      setResendCooldown(data?.resendCooldownSeconds ?? 60)
      setStep("verify")
      otpForm.reset({ code: "" })

      toast.success("Verification code sent", {
        description: `We sent a 6-digit verification code to ${values.email}.`,
      })
    } catch {
      toast.error("System Error", {
        description: "An unexpected error occurred during profile setup.",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function onVerifyOtp(values: OtpValues) {
    setIsVerifying(true)
    try {
      const response = await fetch("/api/auth/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: pendingEmail,
          code: values.code,
        }),
      })

      const contentType = response.headers.get("content-type") || ""
      const data = contentType.includes("application/json") ? await response.json() : null

      if (!response.ok) {
        toast.error("Verification Failed", {
          description:
            data?.error ||
            data?.message ||
            "The verification code could not be validated.",
        })
        return
      }

      toast.success("Identity Verified", {
        description: "Your operative profile is ready. Continue to login.",
      })
      router.push("/login?registered=true")
    } catch {
      toast.error("System Error", {
        description: "An unexpected error occurred during verification.",
      })
    } finally {
      setIsVerifying(false)
    }
  }

  async function onResendOtp() {
    if (!pendingEmail || resendCooldown > 0) return

    setIsResending(true)
    try {
      const response = await fetch("/api/auth/register/resend", {
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
            "We could not send another verification code right now.",
        })
        if (typeof data?.retryAfterSeconds === "number") {
          setResendCooldown(data.retryAfterSeconds)
        }
        return
      }

      setResendCooldown(data?.resendCooldownSeconds ?? 60)
      otpForm.reset({ code: "" })

      toast.success("Verification code resent", {
        description: `A new code has been sent to ${pendingEmail}.`,
      })
    } catch {
      toast.error("System Error", {
        description: "An unexpected error occurred while resending the code.",
      })
    } finally {
      setIsResending(false)
    }
  }

  function onChangeEmail() {
    setStep("request")
    setPendingEmail("")
    setResendCooldown(0)
    otpForm.reset({ code: "" })
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {step === "request" ? (
        <Form {...registerForm}>
          <form onSubmit={registerForm.handleSubmit(onRequestOtp)} className="space-y-6">
            <div className="space-y-4">
              <FormField
                control={registerForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
                      Full Designation
                    </FormLabel>
                    <FormControl>
                      <input
                        placeholder="Operative Name"
                        {...field}
                        className="h-12 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 transition-all focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/5"
                      />
                    </FormControl>
                    <FormMessage className="ml-1 text-[10px] font-bold text-error" />
                  </FormItem>
                )}
              />
              <FormField
                control={registerForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
                      Email Address
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
              <FormField
                control={registerForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
                      Secure Cipher
                    </FormLabel>
                    <FormControl>
                      <input
                        type="password"
                        placeholder="••••••••"
                        {...field}
                        className="h-12 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 transition-all focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/5"
                      />
                    </FormControl>
                    <FormMessage className="ml-1 text-[10px] font-bold text-error" />
                  </FormItem>
                )}
              />
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="group h-14 w-full rounded-2xl bg-primary text-xs font-black uppercase tracking-[0.2em] text-primary-foreground transition-all duration-300 hover:shadow-2xl hover:shadow-primary/20"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Send Verification Code
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
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-on-surface-variant/40">
                  Email Verification
                </p>
                <p className="text-sm font-bold text-primary">
                  Enter the 6-digit code sent to {pendingEmail}
                </p>
                <p className="text-xs font-medium leading-relaxed text-on-surface-variant/55">
                  Your account will only be created after the code is verified.
                </p>
              </div>
            </div>
          </div>

          <Form {...otpForm}>
            <form onSubmit={otpForm.handleSubmit(onVerifyOtp)} className="space-y-6">
              <FormField
                control={otpForm.control}
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

              <Button
                type="submit"
                disabled={isVerifying}
                className="group h-14 w-full rounded-2xl bg-primary text-xs font-black uppercase tracking-[0.2em] text-primary-foreground transition-all duration-300 hover:shadow-2xl hover:shadow-primary/20"
              >
                {isVerifying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Verify & Create Profile
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
              onClick={onResendOtp}
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
