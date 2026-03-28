import Image from 'next/image'
import { RegisterForm } from './register-form'

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#000000] px-4 py-8">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-10">
          <div className="flex justify-center mb-3">
            <Image
              src="/logos/nexus-logo-login.png"
              alt="NEXUS"
              width={1000}
              height={232}
              className="w-[160px] h-auto object-contain"
              priority
            />
          </div>
          <div className="w-12 h-px bg-gray-700/60 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Navigation & Execution Hub for Unified Strategy</p>
          <p className="text-xs text-gray-600 mt-1">by PATS Group</p>
        </div>

        <div className="bg-[#0A0A0C] border border-white/[0.08] rounded-2xl p-8 shadow-2xl shadow-black/40">
          <h2 className="text-xl font-semibold text-white mb-6">Create your account</h2>
          <RegisterForm />
        </div>

        <p className="text-center text-[10px] text-gray-700 mt-8">
          Developed by Berlin & GIDEON
        </p>
      </div>
    </div>
  )
}
