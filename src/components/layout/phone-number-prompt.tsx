"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, MessageCircle, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { isLikelyPhoneNumber, normalizeIndonesianPhoneNumber } from "@/lib/phone-number"

interface PhoneNumberPromptProps {
  userId: string
  initialPhoneNumber?: string | null
}

const DISMISSED_PREFIX = "nexus-phone-prompt-dismissed:"

export function PhoneNumberPrompt({ userId, initialPhoneNumber }: PhoneNumberPromptProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber ?? "")
  const [saving, setSaving] = useState(false)

  const storageKey = useMemo(() => `${DISMISSED_PREFIX}${userId}`, [userId])
  const normalizedPreview = normalizeIndonesianPhoneNumber(phoneNumber)
  const isValid = phoneNumber.trim().length > 0 && isLikelyPhoneNumber(phoneNumber)

  useEffect(() => {
    if (initialPhoneNumber) return
    if (typeof window === "undefined") return

    const dismissed = window.sessionStorage.getItem(storageKey)
    if (!dismissed) {
      const timer = window.setTimeout(() => setOpen(true), 650)
      return () => window.clearTimeout(timer)
    }
  }, [initialPhoneNumber, storageKey])

  const dismissForSession = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(storageKey, "true")
    }
    setOpen(false)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isValid) {
      toast.error("Nomor belum valid", {
        description: "Pakai nomor WhatsApp Indonesia, contoh 081234567890 atau +6281234567890.",
      })
      return
    }

    setSaving(true)
    try {
      const response = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error ?? "Failed to save phone number")
      }

      toast.success("Nomor WhatsApp tersimpan", {
        description: "Nexus akan pakai nomor ini untuk persiapan notifikasi WhatsApp.",
      })
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error("Gagal menyimpan nomor", {
        description: error instanceof Error ? error.message : "Coba lagi sebentar.",
      })
    } finally {
      setSaving(false)
    }
  }

  if (initialPhoneNumber) return null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : dismissForSession())}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="pr-8">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/15">
            <MessageCircle className="h-5 w-5" />
          </div>
          <DialogTitle>Tambahkan nomor WhatsApp</DialogTitle>
          <DialogDescription>
            Nexus sedang disiapkan untuk WhatsApp AI agent dan notifikasi operasional. Tambahkan nomor utama kamu dulu supaya data user siap dipakai nanti.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="phone-number" className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
              WhatsApp Number
            </label>
            <input
              id="phone-number"
              inputMode="tel"
              autoComplete="tel"
              placeholder="081234567890"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              className="h-14 w-full rounded-2xl border-none bg-surface-container-low px-5 text-sm font-bold text-on-surface outline-none transition-all placeholder:text-on-surface-variant/30 focus:bg-surface-container-lowest focus:ring-4 focus:ring-primary/5"
            />
            <p className="ml-1 text-xs font-medium text-on-surface-variant/50">
              {normalizedPreview && isValid
                ? `Akan disimpan sebagai ${normalizedPreview}`
                : "Format aman: 0812..., 62812..., atau +62812..."}
            </p>
          </div>

          <div className="rounded-2xl bg-surface-container-low p-4">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-xs font-semibold leading-relaxed text-on-surface-variant/60">
                Nomor ini disimpan di profil Nexus kamu. Notifikasi WhatsApp belum otomatis aktif sampai integrasi WhatsApp agent dihidupkan.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={dismissForSession}
              disabled={saving}
              className="h-12 rounded-2xl px-5 text-xs font-black uppercase tracking-widest"
            >
              Nanti dulu
            </Button>
            <Button
              type="submit"
              disabled={saving || !isValid}
              className="h-12 rounded-2xl bg-primary px-6 text-xs font-black uppercase tracking-widest text-primary-foreground"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save WhatsApp Number
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
