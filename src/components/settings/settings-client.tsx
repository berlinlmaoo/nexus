"use client"

import { useState, useRef, useCallback } from "react"
import { User, Building2, Palette, Camera, X, Loader2, Sun, Moon, Monitor, Bell, Mail, Shield, Webhook, Upload, Users, Lock, Trash2, Crown, ChevronRight, Activity, Share2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { useTheme } from "@/components/layout/theme-provider"
import { AuditLogViewer } from "./audit-log-viewer"
import { WebhooksManager } from "./webhooks-manager"
import { ImportWizard } from "./import-wizard"
import { NotificationSettings } from "./notification-settings"
import { PasswordChangeSection } from "./password-change"
import { WorkspaceMembersSection } from "./workspace-members"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/ui/user-avatar"

interface SettingsClientProps {
  user: { id: string; name: string; email: string; avatar: string | null; role?: string }
  workspace: { id: string; name: string; slug: string } | null
  isAdmin?: boolean
  workspaceRole?: string | null
}

type SettingsTab = "profile" | "security" | "members" | "notifications" | "webhooks" | "import" | "audit"

export function SettingsClient({ user, workspace, isAdmin, workspaceRole }: SettingsClientProps) {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile")
  const [name, setName] = useState(user.name)
  const [saving, setSaving] = useState(false)

  const tabs: { id: SettingsTab; label: string; icon: any }[] = [
    { id: "profile", label: "Identity", icon: User },
    { id: "security", label: "Security", icon: Lock },
    { id: "members", label: "Operatives", icon: Users },
    { id: "notifications", label: "Intelligence", icon: Bell },
    { id: "webhooks", label: "Webhooks", icon: Webhook },
    { id: "import", label: "Migration", icon: Upload },
    { id: "audit", label: "Protocols", icon: Activity },
  ]

  const handleSaveProfile = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (res.ok) router.refresh()
    } catch (error) { console.error(error) } finally { setSaving(false) }
  }

  return (
    <div className="max-w-[1600px] mx-auto animate-fade-in pb-24 [content-visibility:auto]">
      {/* Header */}
      <div className="mb-12 space-y-2 px-4">
        <h1 className="text-5xl font-headline font-black tracking-tighter text-on-surface">
          System Configuration
        </h1>
        <p className="text-on-surface-variant/60 font-medium text-lg flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-primary" />
          Modifying operational parameters for {user.name}
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-12">
        {/* Navigation Sidebar */}
        <aside className="w-full lg:w-72 shrink-0 px-4">
          <nav className="flex flex-col gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "group flex items-center justify-between px-5 py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all duration-300",
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground shadow-xl shadow-primary/20 scale-[1.02]"
                    : "text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container-low"
                )}
              >
                <div className="flex items-center gap-4">
                  <tab.icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </div>
                <ChevronRight className={cn("h-3.5 w-3.5 opacity-0 transition-all", activeTab === tab.id ? "opacity-100 translate-x-0" : "group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0")} />
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 px-4">
          <div className="bg-surface-container-lowest rounded-[3rem] p-12 shadow-sm border border-on-surface-variant/5 min-h-[600px] relative overflow-hidden">
            {/* Background Decoration */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/[0.02] rounded-full blur-[100px] -mr-32 -mt-32" />

            <div className="relative z-10 max-w-3xl">
              {activeTab === "profile" && (
                <div className="space-y-12">
                  <div className="flex items-center gap-8">
                    <div className="relative group">
                      <UserAvatar user={{ name: user.name, image: user.avatar }} size="lg" className="h-24 w-24 ring-4 ring-surface-container-low" />
                      <button className="absolute inset-0 rounded-full bg-primary/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-primary-foreground">
                        <Camera className="h-6 w-6" />
                      </button>
                    </div>
                    <div>
                      <h3 className="text-2xl font-headline font-black text-on-surface tracking-tight">Identity Designation</h3>
                      <p className="text-sm text-on-surface-variant/60 font-medium">How you are recognized within the Nexus network.</p>
                    </div>
                  </div>

                  <div className="space-y-8 pt-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Full Designation</label>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full h-14 bg-surface-container-low border-none rounded-2xl px-6 text-sm font-bold text-on-surface focus:ring-4 focus:ring-primary/5 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Verified Node Email</label>
                      <input
                        value={user.email}
                        disabled
                        className="w-full h-14 bg-surface-container-low/50 border-none rounded-2xl px-6 text-sm font-bold text-on-surface-variant/40 cursor-not-allowed"
                      />
                    </div>
                    <Button 
                      onClick={handleSaveProfile} 
                      disabled={saving || name.trim() === user.name}
                      className="h-14 px-8 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-primary/10 transition-all hover:-translate-y-1 active:scale-95"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : "Update Identity"}
                    </Button>
                  </div>
                </div>
              )}

              {activeTab === "security" && <PasswordChangeSection />}
              {activeTab === "members" && (
                <WorkspaceMembersSection 
                  canManage={isAdmin || user?.role === "ADMIN"} 
                  currentUserId={user?.id || ""} 
                />
              )}
              {activeTab === "notifications" && <NotificationSettings />}
              {activeTab === "webhooks" && <WebhooksManager />}
              {activeTab === "import" && <ImportWizard />}
              {activeTab === "audit" && <AuditLogViewer />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
