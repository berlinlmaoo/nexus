import { Metadata } from "next"
import Link from "next/link"
import { LoginForm } from "./login-form"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { Loader2 } from "lucide-react"
import Image from "next/image"

export const metadata: Metadata = {
  title: "Protocol Access | NEXUS",
  description: "Secure gateway to the Nexus ecosystem.",
}

export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

export default async function LoginPage() {
  const session = await auth()
  if (session) redirect("/dashboard")

  return (
    <div className="relative min-h-screen flex items-stretch bg-surface overflow-hidden">
      {/* Left Branding Side (Desktop) */}
      <div className="hidden lg:flex w-1/2 bg-primary relative flex-col justify-between p-16 overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-white/10 blur-[120px] animate-pulse" />
          <div className="absolute bottom-[-5%] left-[-5%] w-[40%] h-[40%] rounded-full bg-white/5 blur-[100px]" />
        </div>
        
        <div className="relative z-10">
          <Link href="/" className="flex items-center group">
            <Image 
              src="/logos/nexus-logo-login.png" 
              alt="NEXUS" 
              width={180} 
              height={60} 
              className="object-contain transition-transform duration-500 group-hover:scale-105"
              priority
            />
          </Link>
        </div>

        <div className="relative z-10 space-y-8">
          <h2 className="text-7xl font-headline font-black text-primary-foreground tracking-tighter leading-[0.9]">
            The Digital <br />
            <span className="opacity-40">Atheneum.</span>
          </h2>
          <p className="max-w-md text-xl text-primary-foreground/60 font-medium leading-relaxed">
            Transition from the noise of traditional project management into a sanctuary of strategy and execution.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-8 text-primary-foreground">
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest opacity-30">System Version</p>
            <p className="text-xs font-bold opacity-60">V2.4.0 Codename: D41V4</p>
          </div>
          <div className="h-8 w-[1px] bg-primary-foreground/10" />
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest opacity-30">Engineered By</p>
            <Link
              href="https://www.instagram.com/jagain.networks/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-xs font-bold opacity-60 transition-opacity hover:opacity-100"
            >
              Jagain Networks
            </Link>
          </div>
        </div>
      </div>

      {/* Right Login Side */}
      <div className="relative flex flex-1 flex-col justify-center bg-surface px-5 py-8 sm:px-10 sm:py-12 lg:px-24 xl:px-32">
        <div className="absolute left-5 top-6 lg:hidden sm:left-10 sm:top-10">
          <Image 
            src="/logos/nexus-logo-mono.png" 
            alt="NEXUS" 
            width={120} 
            height={40} 
            className="object-contain"
          />
        </div>

        <div className="mx-auto w-full max-w-md space-y-8 animate-fade-in pt-14 sm:space-y-10 sm:pt-10 lg:pt-0">
          <div className="space-y-2">
            <h3 className="text-3xl font-headline font-black text-on-surface tracking-tight sm:text-4xl">Initiate Protocol</h3>
            <p className="text-sm font-medium text-on-surface-variant/60 sm:text-base">Verify your credentials to access the workspace.</p>
          </div>

          <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary/20" /></div>}>
            <LoginForm />
          </Suspense>

          <div className="pt-8 border-t border-on-surface-variant/5">
            <p className="text-sm text-center text-on-surface-variant/40 font-medium">
              New operative?{" "}
              <Link href="/register" className="text-primary font-black hover:underline underline-offset-4 decoration-2">
                Apply for Node Access
              </Link>
            </p>
          </div>

          <div className="lg:hidden rounded-3xl border border-on-surface-variant/5 bg-surface-container-low/50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/30">Engineered By</p>
            <Link
              href="https://www.instagram.com/jagain.networks/"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex text-sm font-bold text-primary/70 transition-colors hover:text-primary"
            >
              Jagain Networks
            </Link>
          </div>
        </div>

        {/* Floating Help */}
        <div className="absolute bottom-12 right-12 hidden sm:block">
          <button className="h-12 w-12 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant/40 hover:text-primary transition-colors">
            <span className="text-xs font-black">?</span>
          </button>
        </div>
      </div>
    </div>
  )
}
