import { Metadata } from "next"
import Link from "next/link"
import { RegisterForm } from "./register-form"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Image from "next/image"

export const metadata: Metadata = {
  title: "Request Access | NEXUS",
  description: "Join the Nexus strategic ecosystem.",
}

export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

export default async function RegisterPage() {
  const session = await auth()
  if (session) redirect("/dashboard")

  return (
    <div className="relative min-h-screen flex items-stretch bg-surface overflow-hidden">
      {/* Left Branding Side (Desktop) */}
      <div className="hidden lg:flex w-1/2 bg-primary relative flex-col justify-between p-16 overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-tertiary-new/30 blur-[120px] animate-pulse" />
          <div className="absolute bottom-[-5%] left-[-5%] w-[40%] h-[40%] rounded-full bg-secondary-new/20 blur-[100px]" />
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
            Unified <br />
            <span className="text-primary-foreground/40">Execution.</span>
          </h2>
          <p className="max-w-md text-xl text-primary-foreground/60 font-medium leading-relaxed">
            Begin your journey into a high-fidelity workspace designed for precision and collaborative intelligence.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-8">
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-primary-foreground/30">Network Status</p>
            <p className="text-xs font-bold text-primary-foreground/60">Operational / Encryption: Active</p>
          </div>
        </div>
      </div>

      {/* Right Register Side */}
      <div className="relative flex flex-1 flex-col justify-center overflow-y-auto bg-surface px-5 py-8 sm:px-10 sm:py-12 lg:px-24 xl:px-32">
        {/* Mobile Header */}
        <div className="absolute left-5 top-6 lg:hidden sm:left-10 sm:top-10">
          <Link href="/" className="flex items-center">
            <Image
              src="/logos/nexus-logo-mono.png"
              alt="NEXUS"
              width={120}
              height={40}
              className="object-contain"
              priority
            />
          </Link>
        </div>

        <div className="mx-auto w-full max-w-md space-y-8 animate-fade-in py-6 pt-14 sm:space-y-10 sm:py-12 sm:pt-10 lg:pt-0">
          <div className="space-y-2">
            <h3 className="text-3xl font-headline font-black text-primary tracking-tight sm:text-4xl">Request Entry</h3>
            <p className="text-sm font-medium text-on-surface-variant/60 sm:text-base">Provision your operative profile and verify access through a one-time code sent to your email.</p>
          </div>

          <RegisterForm />

          <div className="pt-8 border-t border-on-surface-variant/5">
            <p className="text-sm text-center text-on-surface-variant/40 font-medium">
              Already verified?{" "}
              <Link href="/login" className="text-primary font-black hover:underline underline-offset-4 decoration-2">
                Initiate Login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
