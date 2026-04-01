import { Metadata } from "next"
import Link from "next/link"
import { RegisterForm } from "./register-form"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"

export const metadata: Metadata = {
  title: "Request Access | NEXUS",
  description: "Join the Nexus strategic ecosystem.",
}

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
          <Link href="/" className="flex items-center gap-3 group">
            <div className="h-12 w-12 rounded-2xl bg-primary-foreground flex items-center justify-center text-primary transition-transform duration-500 group-hover:rotate-12">
              <span className="font-headline font-black text-2xl uppercase">NX</span>
            </div>
            <h1 className="text-2xl font-headline font-black tracking-[0.3em] text-primary-foreground uppercase">NEXUS</h1>
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
      <div className="flex-1 flex flex-col justify-center px-8 sm:px-16 lg:px-24 xl:px-32 py-12 relative overflow-y-auto">
        {/* Mobile Header */}
        <div className="lg:hidden absolute top-8 left-8">
          <h1 className="text-xl font-headline font-black tracking-widest text-primary uppercase">NEXUS</h1>
        </div>

        <div className="w-full max-w-md mx-auto space-y-10 animate-fade-in py-12">
          <div className="space-y-2">
            <h3 className="text-4xl font-headline font-black text-primary tracking-tight">Request Entry</h3>
            <p className="text-on-surface-variant/60 font-medium">Provision your operative profile within the system.</p>
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
