"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { Loader2, ArrowRight, Github } from "lucide-react"

const formSchema = z.object({
  email: z.string().email({
    message: "A valid operative email is required.",
  }),
  password: z.string().min(8, {
    message: "Security protocol requires at least 8 characters.",
  }),
})

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams?.get("callbackUrl") || "/dashboard"
  const [isLoading, setIsLoading] = useState(false)
  const [isGithubLoading, setIsGithubLoading] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true)
    try {
      const result = await signIn("credentials", {
        email: values.email,
        password: values.password,
        redirect: false,
      })

      if (result?.error) {
        toast.error("Access Denied", {
          description: "Verification failed. Please check your credentials.",
        })
      } else {
        toast.success("Identity Verified", {
          description: "Welcome back to the Nexus sanctuary.",
        })
        router.push(callbackUrl)
        router.refresh()
      }
    } catch (error) {
      toast.error("System Error", {
        description: "An unexpected error occurred during protocol initiation.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleGithubSignIn = async () => {
    setIsGithubLoading(true)
    signIn("github", { callbackUrl })
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }: { field: any }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Operative Email</FormLabel>
                  <FormControl>
                    <input
                      placeholder="name@agency.com"
                      {...field}
                      className="w-full h-12 bg-surface-container-low border-none rounded-2xl px-4 text-sm font-bold text-on-surface placeholder:text-on-surface-variant/20 focus:ring-2 focus:ring-primary/5 focus:bg-surface-container-lowest transition-all outline-none"
                    />
                  </FormControl>
                  <FormMessage className="text-[10px] font-bold text-error ml-1" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }: { field: any }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Access Cipher</FormLabel>
                  <FormControl>
                    <input
                      type="password"
                      placeholder="••••••••"
                      {...field}
                      className="w-full h-12 bg-surface-container-low border-none rounded-2xl px-4 text-sm font-bold text-on-surface placeholder:text-on-surface-variant/20 focus:ring-2 focus:ring-primary/5 focus:bg-surface-container-lowest transition-all outline-none"
                    />
                  </FormControl>
                  <FormMessage className="text-[10px] font-bold text-error ml-1" />
                </FormItem>
              )}
            />
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
      </Form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-on-surface-variant/5" />
        </div>
        <div className="relative flex justify-center text-[10px] font-black uppercase tracking-widest">
          <span className="bg-surface px-4 text-on-surface-variant/30">Alternative Access</span>
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        onClick={handleGithubSignIn}
        disabled={isGithubLoading}
        className="w-full h-14 bg-surface-container-low text-primary rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-surface-container transition-all"
      >
        {isGithubLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Github className="mr-2 h-4 w-4" />
            Github Gateway
          </>
        )}
      </Button>
    </div>
  )
}
