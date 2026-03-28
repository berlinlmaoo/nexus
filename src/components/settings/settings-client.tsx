"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { User, Building2, Palette, Camera, X, Loader2, Sun, Moon, Monitor, Bell, Mail, MessageSquare, Hash, Shield, Webhook, Upload, Users, Lock, UserPlus, Trash2, Crown, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { useTheme } from "@/components/layout/theme-provider"
import { AuditLogViewer } from "./audit-log-viewer"
import { WebhooksManager } from "./webhooks-manager"
import { ImportWizard } from "./import-wizard"
import { NotificationSettings } from "./notification-settings"
import { PasswordChangeSection } from "./password-change"
import { WorkspaceMembersSection } from "./workspace-members"

interface SettingsClientProps {
  user: {
    id: string
    name: string
    email: string
    avatar: string | null
  }
  workspace: {
    id: string
    name: string
    slug: string
  } | null
  isAdmin?: boolean
  workspaceRole?: string | null
}

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"]

type SettingsTab = "profile" | "security" | "members" | "notifications" | "webhooks" | "import" | "audit"

export function SettingsClient({ user, workspace, isAdmin, workspaceRole }: SettingsClientProps) {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile")
  const [name, setName] = useState(user.name)
  const [workspaceName, setWorkspaceName] = useState(workspace?.name || "")
  const [saving, setSaving] = useState(false)

  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatar)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return "Invalid file type. Use PNG, JPG, or WEBP."
    }
    if (file.size > MAX_FILE_SIZE) {
      return "File too large. Maximum size is 5MB."
    }
    return null
  }

  const handleFileSelect = useCallback((file: File) => {
    const error = validateFile(file)
    if (error) {
      setUploadError(error)
      return
    }
    setUploadError(null)
    setSelectedFile(file)
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileSelect(file)
    if (e.target) e.target.value = ""
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => setDragOver(false)

  const handleUpload = async () => {
    if (!selectedFile) return
    setUploading(true)
    setUploadError(null)

    try {
      const formData = new FormData()
      formData.append("file", selectedFile)

      const res = await fetch("/api/upload/avatar", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Upload failed")
      }

      const data = await res.json()
      setAvatarUrl(data.url)
      setPreviewUrl(null)
      setSelectedFile(null)
      router.refresh()
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Upload failed"
      )
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveAvatar = async () => {
    setRemoving(true)
    setUploadError(null)

    try {
      const res = await fetch("/api/upload/avatar", { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to remove avatar")
      }

      setAvatarUrl(null)
      setPreviewUrl(null)
      setSelectedFile(null)
      router.refresh()
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Failed to remove avatar"
      )
    } finally {
      setRemoving(false)
    }
  }

  const cancelPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setSelectedFile(null)
    setUploadError(null)
  }

  const handleSaveProfile = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (res.ok) {
        router.refresh()
      }
    } catch (error) {
      console.error("Failed to save profile:", error)
    } finally {
      setSaving(false)
    }
  }

  const displayImage = previewUrl || avatarUrl

  const canManageMembers = workspaceRole === "OWNER" || workspaceRole === "ADMIN"

  const tabs: { id: SettingsTab; label: string; icon: typeof User }[] = [
    { id: "profile", label: "Profile", icon: User },
    { id: "security", label: "Security", icon: Lock },
    { id: "members", label: "Members", icon: Users },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "webhooks" as const, label: "Webhooks", icon: Webhook },
    { id: "import" as const, label: "Import", icon: Upload },
    ...(isAdmin ? [{ id: "audit" as const, label: "Audit Log", icon: Shield }] : []),
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-6 min-w-0">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account and workspace</p>
      </div>

      {/* Tab navigation */}
      <div className="flex flex-nowrap gap-0.5 border-b overflow-x-auto min-w-0 pb-0 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all duration-200 whitespace-nowrap",
              activeTab === id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && (
        <>
          <Card id="profile-section">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Avatar upload area */}
              <div className="flex items-start gap-6">
                {/* Avatar with hover overlay */}
                <div
                  className={cn(
                    "relative group cursor-pointer rounded-full shrink-0",
                    dragOver && "ring-2 ring-ring ring-offset-2"
                  )}
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  <Avatar className="h-20 w-20">
                    {displayImage && (
                      <AvatarImage
                        src={displayImage}
                        alt={user.name}
                        className="object-cover"
                      />
                    )}
                    <AvatarFallback className="bg-[#18181B] text-white text-xl">
                      {initials}
                    </AvatarFallback>
                  </Avatar>

                  {/* Hover overlay */}
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <Camera className="h-5 w-5 text-white" />
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>

                <div className="flex-1 space-y-2">
                  <div>
                    <p className="font-medium">{user.name}</p>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Click avatar or drag & drop. PNG, JPG, WEBP (max 5MB)
                  </p>

                  {uploadError && (
                    <p className="text-xs text-red-600">{uploadError}</p>
                  )}

                  <div className="flex items-center gap-2">
                    {selectedFile && (
                      <>
                        <Button
                          size="sm"
                          className="bg-foreground text-background hover:bg-foreground/90"
                          onClick={handleUpload}
                          disabled={uploading}
                        >
                          {uploading ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            "Save Avatar"
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={cancelPreview}
                          disabled={uploading}
                        >
                          Cancel
                        </Button>
                      </>
                    )}

                    {!selectedFile && avatarUrl && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRemoveAvatar}
                        disabled={removing}
                        className="text-muted-foreground"
                      >
                        {removing ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Removing...
                          </>
                        ) : (
                          <>
                            <X className="h-3 w-3 mr-1" />
                            Remove
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="name">Display Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={user.email} disabled className="bg-neutral-100 dark:bg-neutral-900 text-neutral-500 cursor-not-allowed" />
                <p className="text-xs text-muted-foreground">
                  Email cannot be changed
                </p>
              </div>

              <Button
                className="bg-foreground text-background hover:bg-foreground/90"
                disabled={saving || name.trim() === user.name}
                onClick={handleSaveProfile}
              >
                {saving ? "Saving..." : "Save Profile"}
              </Button>
            </CardContent>
          </Card>

          {workspace && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Workspace
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="workspace-name">Workspace Name</Label>
                  <Input
                    id="workspace-name"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    className="min-h-[40px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-slug">Slug</Label>
                  <Input
                    id="workspace-slug"
                    value={workspace.slug}
                    disabled
                    className="opacity-60"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                Theme
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3">
                {([
                  { value: "light" as const, label: "Light", icon: Sun },
                  { value: "dark" as const, label: "Dark", icon: Moon },
                  { value: "system" as const, label: "System", icon: Monitor },
                ]).map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    className={cn(
                      "flex h-24 w-24 flex-col items-center justify-center gap-2 rounded-xl border-2 text-sm font-medium transition-all duration-200 active:scale-95",
                      theme === value
                        ? "border-foreground bg-muted shadow-sm"
                        : "border-transparent bg-muted/50 hover:border-border hover:bg-muted/80"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "security" && <PasswordChangeSection />}

      {activeTab === "members" && <WorkspaceMembersSection canManage={canManageMembers} currentUserId={user.id} />}

      {activeTab === "notifications" && <NotificationSettings />}

      {activeTab === "webhooks" && <WebhooksManager />}

      {activeTab === "import" && <ImportWizard />}

      {activeTab === "audit" && isAdmin && <AuditLogViewer />}
    </div>
  )
}

