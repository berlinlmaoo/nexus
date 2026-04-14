"use client"

import { useState } from "react"
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
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { Loader2, ArrowRight } from "lucide-react"

const formSchema = z.object({
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

export function RegisterForm() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true)
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })

      if (response.ok) {
        toast.success("Identity Provisioned", {
          description: "Your operative profile has been created successfully.",
        })
        router.push("/login")
      } else {
        const contentType = response.headers.get("content-type") || ""
        const data = contentType.includes("application/json")
          ? await response.json()
          : null
        toast.error("Provisioning Failed", {
          description:
            data?.error ||
            data?.message ||
            "An error occurred during identity setup.",
        })
      }
    } catch (error) {
      toast.error("System Error", {
        description: "An unexpected error occurred during profile setup.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }: { field: any }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Full Designation</FormLabel>
                  <FormControl>
                    <input
                      placeholder="Operative Name"
                      {...field}
                      className="w-full h-12 bg-surface-container-low border-none rounded-2xl px-4 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 focus:ring-2 focus:ring-primary/5 focus:bg-surface-container-lowest transition-all"
                    />
                  </FormControl>
                  <FormMessage className="text-[10px] font-bold text-error ml-1" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }: { field: any }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Email Address</FormLabel>
                  <FormControl>
                    <input
                      placeholder="name@agency.com"
                      {...field}
                      className="w-full h-12 bg-surface-container-low border-none rounded-2xl px-4 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 focus:ring-2 focus:ring-primary/5 focus:bg-surface-container-lowest transition-all"
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
                  <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Secure Cipher</FormLabel>
                  <FormControl>
                    <input
                      type="password"
                      placeholder="••••••••"
                      {...field}
                      className="w-full h-12 bg-surface-container-low border-none rounded-2xl px-4 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 focus:ring-2 focus:ring-primary/5 focus:bg-surface-container-lowest transition-all"
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
            className="w-full h-14 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:shadow-2xl hover:shadow-primary/20 transition-all duration-300 group"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Create Operative Profile
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </Button>
        </form>
      </Form>
    </div>
  )
}
