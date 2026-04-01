"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Lock, Loader2 } from "lucide-react"

export function PasswordChangeSection() {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async () => {
    setError(null)
    setSuccess(false)

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("All fields are required")
      return
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters")
      return
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to change password")
      }
      setSuccess(true)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-12">
      <div>
        <h3 className="text-2xl font-headline font-black text-on-surface tracking-tight">Security Protocol</h3>
        <p className="text-sm text-on-surface-variant/60 font-medium">Update your access cipher to maintain node integrity.</p>
      </div>

      <div className="space-y-8 pt-4">
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Current Cipher</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Enter current password"
            className="w-full h-14 bg-surface-container-low border-none rounded-2xl px-6 text-sm font-bold text-on-surface placeholder:text-on-surface-variant/20 focus:ring-4 focus:ring-primary/5 transition-all"
          />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">New Cipher</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 8 characters"
              className="w-full h-14 bg-surface-container-low border-none rounded-2xl px-6 text-sm font-bold text-on-surface placeholder:text-on-surface-variant/20 focus:ring-4 focus:ring-primary/5 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Confirm New Cipher</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit() }}
              className="w-full h-14 bg-surface-container-low border-none rounded-2xl px-6 text-sm font-bold text-on-surface placeholder:text-on-surface-variant/20 focus:ring-4 focus:ring-primary/5 transition-all"
            />
          </div>
        </div>

        {error && <p className="text-[10px] font-bold text-red-600 ml-1 uppercase tracking-widest">{error}</p>}
        {success && <p className="text-[10px] font-bold text-green-600 ml-1 uppercase tracking-widest">Protocol updated successfully</p>}

        <Button 
          onClick={handleSubmit} 
          disabled={saving || !currentPassword || !newPassword || !confirmPassword}
          className="h-14 px-8 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-primary/10 transition-all hover:-translate-y-1 active:scale-95"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : "Update Password"}
        </Button>
      </div>
    </div>
  )
}
