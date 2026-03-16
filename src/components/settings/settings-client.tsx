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
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account and workspace</p>
      </div>

      {/* Tab navigation */}
      <div className="flex flex-nowrap gap-1 border-b overflow-x-auto">
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
                <Input id="email" value={user.email} disabled className="opacity-60" />
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

// ── Notification Settings Tab ─────────────────────────────────

interface NotifPrefs {
  emailEnabled: boolean
  waEnabled: boolean
  slackEnabled: boolean
  waPhone: string | null
  slackWebhook: string | null
  taskAssigned: boolean
  taskDueSoon: boolean
  commentMention: boolean
  projectInvite: boolean
  statusUpdate: boolean
}

function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotifPrefs>({
    emailEnabled: true,
    waEnabled: false,
    slackEnabled: false,
    waPhone: null,
    slackWebhook: null,
    taskAssigned: true,
    taskDueSoon: true,
    commentMention: true,
    projectInvite: true,
    statusUpdate: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch("/api/notifications/preferences")
      .then((r) => r.json())
      .then((data) => {
        setPrefs(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error("Failed to save notification preferences:", error)
    } finally {
      setSaving(false)
    }
  }

  const toggle = (key: keyof NotifPrefs) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }))
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {/* Channels */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-5 w-5" />
            Notification Channels
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            icon={<Mail className="h-4 w-4" />}
            label="Email Notifications"
            description="Receive notifications via email"
            checked={prefs.emailEnabled}
            onChange={() => toggle("emailEnabled")}
          />

          <Separator />

          <ToggleRow
            icon={<MessageSquare className="h-4 w-4" />}
            label="WhatsApp Notifications"
            description="Receive notifications via WhatsApp"
            checked={prefs.waEnabled}
            onChange={() => toggle("waEnabled")}
          />
          {prefs.waEnabled && (
            <div className="pl-8 space-y-1">
              <Label htmlFor="wa-phone" className="text-xs">Phone Number</Label>
              <Input
                id="wa-phone"
                placeholder="+62812345678"
                value={prefs.waPhone || ""}
                onChange={(e) => setPrefs((p) => ({ ...p, waPhone: e.target.value || null }))}
                className="max-w-xs"
              />
            </div>
          )}

          <Separator />

          <ToggleRow
            icon={<Hash className="h-4 w-4" />}
            label="Slack Notifications"
            description="Receive notifications via Slack webhook"
            checked={prefs.slackEnabled}
            onChange={() => toggle("slackEnabled")}
          />
          {prefs.slackEnabled && (
            <div className="pl-8 space-y-1">
              <Label htmlFor="slack-webhook" className="text-xs">Webhook URL</Label>
              <Input
                id="slack-webhook"
                placeholder="https://hooks.slack.com/services/..."
                value={prefs.slackWebhook || ""}
                onChange={(e) => setPrefs((p) => ({ ...p, slackWebhook: e.target.value || null }))}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notification types */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification Types</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            label="Task Assigned"
            description="When someone assigns a task to you"
            checked={prefs.taskAssigned}
            onChange={() => toggle("taskAssigned")}
          />
          <Separator />
          <ToggleRow
            label="Task Due Soon"
            description="When a task is due within 24 hours"
            checked={prefs.taskDueSoon}
            onChange={() => toggle("taskDueSoon")}
          />
          <Separator />
          <ToggleRow
            label="Comment Mentions"
            description="When someone mentions you in a comment"
            checked={prefs.commentMention}
            onChange={() => toggle("commentMention")}
          />
          <Separator />
          <ToggleRow
            label="Project Invitations"
            description="When you're invited to a project"
            checked={prefs.projectInvite}
            onChange={() => toggle("projectInvite")}
          />
          <Separator />
          <ToggleRow
            label="Status Updates"
            description="When a project status is updated"
            checked={prefs.statusUpdate}
            onChange={() => toggle("statusUpdate")}
          />
        </CardContent>
      </Card>

      <Button
        className="bg-foreground text-background hover:bg-foreground/90"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "Saving..." : saved ? "Saved" : "Save Preferences"}
      </Button>
    </>
  )
}

// ── Password Change Section ──────────────────────────────────

function PasswordChangeSection() {
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          Change Password
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="current-password">Current Password</Label>
          <Input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Enter current password"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-password">New Password</Label>
          <Input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password (min 8 characters)"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm New Password</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit() }}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">Password updated successfully</p>}

        <Button
          className="bg-foreground text-background hover:bg-foreground/90"
          onClick={handleSubmit}
          disabled={saving || !currentPassword || !newPassword || !confirmPassword}
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Updating...
            </>
          ) : (
            "Update Password"
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Workspace Members Section ──────────────────────────────────

interface WorkspaceMember {
  id: string
  userId: string
  name: string
  email: string
  avatar: string | null
  role: string
  joinedAt: string
}

function WorkspaceMembersSection({ canManage, currentUserId }: { canManage: boolean; currentUserId: string }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState("MEMBER")
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  useEffect(() => {
    fetch("/api/workspaces/members")
      .then((r) => r.json())
      .then((data) => {
        setMembers(data.members || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setError(null)
    try {
      const res = await fetch("/api/workspaces/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to invite member")
      }
      const data = await res.json()
      setMembers([...members, data.member])
      setInviteEmail("")
      setShowInvite(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite member")
    } finally {
      setInviting(false)
    }
  }

  const handleRoleChange = async (memberId: string, role: string) => {
    try {
      const res = await fetch("/api/workspaces/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, role }),
      })
      if (res.ok) {
        const data = await res.json()
        setMembers(members.map(m => m.id === memberId ? { ...m, role: data.member.role } : m))
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleRemove = async (memberId: string) => {
    if (!confirm("Remove this member from the workspace?")) return
    try {
      const res = await fetch(`/api/workspaces/members?memberId=${memberId}`, { method: "DELETE" })
      if (res.ok) {
        setMembers(members.filter(m => m.id !== memberId))
      }
    } catch (e) {
      console.error(e)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Workspace Members
              <span className="text-sm font-normal text-muted-foreground">({members.length})</span>
            </CardTitle>
            {canManage && (
              <Button
                size="sm"
                className="bg-foreground text-background hover:bg-foreground/90"
                onClick={() => setShowInvite(!showInvite)}
              >
                <UserPlus className="h-4 w-4 mr-1" />
                Invite
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Invite form */}
          {showInvite && (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Email address"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleInvite() }}
                  className="flex-1"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <Button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  className="bg-foreground text-background hover:bg-foreground/90"
                >
                  {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </Button>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          )}

          {/* Members list */}
          <div className="space-y-1">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between py-2.5 px-2 rounded-md hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    {member.avatar && <AvatarImage src={member.avatar} alt={member.name} />}
                    <AvatarFallback className="bg-[#18181B] text-white text-xs">
                      {member.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{member.name}</p>
                      {member.role === "OWNER" && <Crown className="h-3 w-3 text-amber-500" />}
                      {member.userId === currentUserId && <span className="text-[10px] text-muted-foreground">(you)</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    Joined {new Date(member.joinedAt).toLocaleDateString()}
                  </span>
                  {canManage && member.userId !== currentUserId ? (
                    <>
                      <select
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                        className="h-7 rounded border bg-background px-2 text-xs"
                      >
                        <option value="MEMBER">Member</option>
                        <option value="ADMIN">Admin</option>
                        <option value="OWNER">Owner</option>
                      </select>
                      <button
                        onClick={() => handleRemove(member.id)}
                        className="p-1 text-muted-foreground hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <span className="text-xs font-medium text-muted-foreground capitalize">{member.role.toLowerCase()}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  )
}

// ── Toggle row component ──────────────────────────────────────

function ToggleRow({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon?: React.ReactNode
  label: string
  description: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          checked ? "bg-foreground" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    </div>
  )
}
