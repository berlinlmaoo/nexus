"use client"

import { useEffect, useMemo, useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { UserAvatar } from "@/components/ui/user-avatar"
import { Crown, Loader2, Pencil, Search, Trash2, Upload, UserPlus, X } from "lucide-react"
import { toast } from "sonner"

interface WorkspaceMember {
  id: string
  userId: string
  name: string
  email: string
  avatar: string | null
  role: string
  attendanceRole: "NONE" | "SUPERVISOR"
  joinedAt: string
}

interface EditMemberState {
  memberId: string
  userId: string
  name: string
  avatar: string | null
}

export function WorkspaceMembersSection({ canManage, currentUserId }: { canManage: boolean; currentUserId: string }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState("MEMBER")
  const [inviteAttendanceRole, setInviteAttendanceRole] = useState<"NONE" | "SUPERVISOR">("NONE")
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [search, setSearch] = useState("")
  const [editMember, setEditMember] = useState<EditMemberState | null>(null)
  const [editName, setEditName] = useState("")
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null)
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    fetch("/api/workspaces/members")
      .then((r) => r.json())
      .then((data) => {
        setMembers(data.members || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!editAvatarFile) {
      setEditAvatarPreview(null)
      return
    }

    const objectUrl = URL.createObjectURL(editAvatarFile)
    setEditAvatarPreview(objectUrl)

    return () => URL.revokeObjectURL(objectUrl)
  }, [editAvatarFile])

  const filteredMembers = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return members

    return members.filter((member) => {
      const haystacks = [
        member.name,
        member.email,
        member.role,
        member.attendanceRole === "SUPERVISOR" ? "attendance supervisor" : "attendance none",
      ]

      return haystacks.some((value) => value.toLowerCase().includes(normalized))
    })
  }, [members, search])

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setError(null)
    try {
      const res = await fetch("/api/workspaces/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole, attendanceRole: inviteAttendanceRole }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to invite member")
      }
      const data = await res.json()
      setMembers((current) => [...current, data.member])
      setInviteEmail("")
      setInviteAttendanceRole("NONE")
      setShowInvite(false)
      toast.success("Operative invited successfully")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to invite member"
      setError(message)
      toast.error(message)
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
      if (!res.ok) {
        throw new Error("Failed to update role")
      }
      const data = await res.json()
      setMembers((current) => current.map((m) => (m.id === memberId ? { ...m, role: data.member.role } : m)))
      toast.success("Role updated")
    } catch {
      toast.error("Failed to update role")
    }
  }

  const handleAttendanceRoleChange = async (memberId: string, attendanceRole: "NONE" | "SUPERVISOR") => {
    try {
      const res = await fetch("/api/workspaces/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, attendanceRole }),
      })
      if (!res.ok) {
        throw new Error("Failed to update attendance role")
      }
      const data = await res.json()
      setMembers((current) =>
        current.map((m) => (m.id === memberId ? { ...m, attendanceRole: data.member.attendanceRole } : m))
      )
      toast.success("Attendance role updated")
    } catch {
      toast.error("Failed to update attendance role")
    }
  }

  const handleRemove = async (memberId: string) => {
    if (!confirm("Remove this member from the workspace?")) return
    try {
      const res = await fetch(`/api/workspaces/members?memberId=${memberId}`, { method: "DELETE" })
      if (!res.ok) {
        throw new Error("Failed to remove member")
      }
      setMembers((current) => current.filter((m) => m.id !== memberId))
      toast.success("Operative removed")
    } catch {
      toast.error("Failed to remove operative")
    }
  }

  const openEditDialog = (member: WorkspaceMember) => {
    setEditMember({
      memberId: member.id,
      userId: member.userId,
      name: member.name,
      avatar: member.avatar,
    })
    setEditName(member.name)
    setEditAvatarFile(null)
    setEditAvatarPreview(null)
  }

  const closeEditDialog = () => {
    setEditMember(null)
    setEditName("")
    setEditAvatarFile(null)
    setEditAvatarPreview(null)
  }

  const handleSaveEdit = async () => {
    if (!editMember) return

    const trimmedName = editName.trim()
    if (!trimmedName) {
      toast.error("Name cannot be empty")
      return
    }

    setSavingEdit(true)
    try {
      let nextAvatar = editMember.avatar

      if (trimmedName !== editMember.name) {
        const res = await fetch(`/api/workspaces/members/${editMember.memberId}/profile`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => null)
          throw new Error(data?.error || "Failed to update operative name")
        }
      }

      if (editAvatarFile) {
        const formData = new FormData()
        formData.append("file", editAvatarFile)

        const uploadRes = await fetch(`/api/workspaces/members/${editMember.memberId}/avatar`, {
          method: "POST",
          body: formData,
        })

        const uploadData = await uploadRes.json().catch(() => null)
        if (!uploadRes.ok) {
          throw new Error(uploadData?.error || "Failed to update operative avatar")
        }

        nextAvatar = uploadData?.user?.avatar ?? uploadData?.url ?? nextAvatar
      }

      setMembers((current) =>
        current.map((member) =>
          member.id === editMember.memberId
            ? {
                ...member,
                name: trimmedName,
                avatar: nextAvatar,
              }
            : member
        )
      )

      toast.success("Operative profile updated")
      closeEditDialog()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update operative")
    } finally {
      setSavingEdit(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary/20" />
      </div>
    )
  }

  return (
    <div className="space-y-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-2xl font-headline font-black tracking-tight text-on-surface">Active Operatives</h3>
          <p className="text-sm font-medium text-on-surface-variant/60">
            Verified personnel with access to this node ({members.length}).
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:min-w-[260px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/35" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search operative..."
              className="h-12 rounded-2xl border-none bg-surface-container-low pl-11 pr-10 text-sm font-bold"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant/35 transition hover:bg-surface-container-high hover:text-on-surface"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {canManage && (
            <Button
              onClick={() => setShowInvite(!showInvite)}
              className="h-12 rounded-2xl bg-primary px-6 text-xs font-black uppercase tracking-widest text-primary-foreground shadow-lg transition-all active:scale-95"
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Invite
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-8">
        {showInvite && (
          <div className="animate-scale-in space-y-6 rounded-[2rem] border border-primary/5 bg-surface-container-low p-8">
            <div className="space-y-2">
              <label className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
                Operative Email
              </label>
              <div className="flex flex-col gap-4 xl:flex-row">
                <input
                  placeholder="Enter email address..."
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleInvite()
                  }}
                  className="h-14 flex-1 rounded-2xl border-none bg-surface-container-lowest px-6 text-sm font-bold text-on-surface placeholder:text-on-surface-variant/20 transition-all focus:ring-4 focus:ring-primary/5"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="h-14 cursor-pointer appearance-none rounded-2xl border-none bg-surface-container-lowest px-6 text-sm font-bold text-on-surface outline-none focus:ring-4 focus:ring-primary/5"
                >
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <select
                  value={inviteAttendanceRole}
                  onChange={(e) => setInviteAttendanceRole(e.target.value as "NONE" | "SUPERVISOR")}
                  className="h-14 cursor-pointer appearance-none rounded-2xl border-none bg-surface-container-lowest px-6 text-sm font-bold text-on-surface outline-none focus:ring-4 focus:ring-primary/5"
                >
                  <option value="NONE">Attendance: None</option>
                  <option value="SUPERVISOR">Attendance: Supervisor</option>
                </select>
                <Button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  className="h-14 rounded-2xl bg-primary px-8 text-xs font-black uppercase tracking-widest text-primary-foreground shadow-lg transition-all"
                >
                  {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Deploy Invitation"}
                </Button>
              </div>
              {error ? (
                <p className="ml-1 mt-2 text-[10px] font-bold uppercase tracking-widest text-red-600">{error}</p>
              ) : null}
            </div>
          </div>
        )}

        {filteredMembers.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-on-surface-variant/15 bg-surface-container-low p-8 text-sm font-medium text-on-surface-variant/55">
            No operatives matched the current search.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMembers.map((member) => (
              <div
                key={member.id}
                className="group rounded-[1.75rem] border border-on-surface-variant/10 bg-surface-container p-4 transition-all duration-300 hover:bg-surface-container-low"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-4">
                      <div className="relative shrink-0">
                        <Avatar className="h-12 w-12 rounded-2xl ring-2 ring-surface-container-low">
                          {member.avatar ? <AvatarImage src={member.avatar} alt={member.name} /> : null}
                          <AvatarFallback className="rounded-2xl bg-primary text-xs font-black text-primary-foreground">
                            {member.name
                              .split(" ")
                              .map((chunk) => chunk[0])
                              .join("")
                              .toUpperCase()
                              .slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        {member.role === "OWNER" ? (
                          <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-lg bg-amber-500 text-white shadow-lg">
                            <Crown className="h-3 w-3" />
                          </div>
                        ) : null}
                      </div>

                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="break-words text-sm font-black text-on-surface sm:text-base">{member.name}</p>
                          {member.userId === currentUserId ? (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-primary">
                              Origin Node
                            </span>
                          ) : null}
                        </div>
                        <p className="break-all text-xs font-medium text-on-surface-variant/60">{member.email}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{member.role}</Badge>
                          <Badge variant={member.attendanceRole === "SUPERVISOR" ? "default" : "outline"}>
                            {member.attendanceRole === "SUPERVISOR" ? "Attendance Supervisor" : "Attendance None"}
                          </Badge>
                          <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/35">
                            Access Logged: {new Date(member.joinedAt).toLocaleDateString("id-ID")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    {canManage ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-2xl px-4 text-[10px] font-black uppercase tracking-[0.18em]"
                          onClick={() => openEditDialog(member)}
                        >
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Edit
                        </Button>
                        {member.userId !== currentUserId ? (
                          <>
                            <select
                              value={member.role}
                              onChange={(e) => handleRoleChange(member.id, e.target.value)}
                              className="h-9 cursor-pointer appearance-none rounded-xl border-none bg-surface-container-high/50 px-3 text-[10px] font-black uppercase tracking-widest text-on-surface outline-none transition-colors hover:bg-surface-container-high"
                            >
                              <option value="MEMBER">Member</option>
                              <option value="ADMIN">Admin</option>
                              <option value="OWNER">Owner</option>
                            </select>
                            <select
                              value={member.attendanceRole}
                              onChange={(e) => handleAttendanceRoleChange(member.id, e.target.value as "NONE" | "SUPERVISOR")}
                              className="h-9 cursor-pointer appearance-none rounded-xl border-none bg-surface-container-high/50 px-3 text-[10px] font-black uppercase tracking-widest text-on-surface outline-none transition-colors hover:bg-surface-container-high"
                            >
                              <option value="NONE">Attendance None</option>
                              <option value="SUPERVISOR">Attendance Supervisor</option>
                            </select>
                            <button
                              onClick={() => handleRemove(member.id)}
                              className="rounded-lg p-2 text-on-surface-variant/30 transition-all hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Badge variant="outline">{member.role}</Badge>
                        {member.attendanceRole === "SUPERVISOR" ? <Badge>Attendance Supervisor</Badge> : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={Boolean(editMember)} onOpenChange={(open) => !open && closeEditDialog()}>
        <DialogContent className="rounded-[2rem] border-none bg-surface-container-lowest p-0 shadow-2xl sm:max-w-2xl">
          {editMember ? (
            <div className="p-6 sm:p-8">
              <DialogHeader className="space-y-3 text-left">
                <DialogTitle className="text-2xl font-headline font-black tracking-tight text-on-surface">
                  Edit Operative
                </DialogTitle>
                <DialogDescription className="text-sm font-medium text-on-surface-variant/60">
                  Update how this user appears inside Nexus.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
                <div className="flex flex-col items-start gap-3 sm:block sm:space-y-3">
                  <UserAvatar
                    user={{
                      name: editName || editMember.name,
                      avatar: editAvatarPreview || editMember.avatar,
                    }}
                    size="xl"
                    className="h-24 w-24 rounded-[1.75rem]"
                  />
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-on-surface-variant/10 bg-surface-container px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-on-surface transition hover:bg-surface-container-high">
                    <Upload className="h-4 w-4" />
                    Upload Photo
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      className="hidden"
                      onChange={(event) => setEditAvatarFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>

                <div className="flex-1 space-y-5">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
                      Display Name
                    </Label>
                    <Input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      className="h-12 rounded-2xl border-none bg-surface-container px-5 text-sm font-bold"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
                      Account Email
                    </Label>
                    <Input value={members.find((member) => member.id === editMember.memberId)?.email ?? ""} disabled className="h-12 rounded-2xl border-none bg-surface-container px-5 text-sm font-bold text-on-surface-variant/45" />
                  </div>

                  <div className="grid gap-3 sm:flex sm:flex-wrap">
                    <Button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={savingEdit}
                      className="h-11 w-full rounded-2xl bg-primary px-5 text-xs font-black uppercase tracking-[0.18em] text-primary-foreground sm:w-auto"
                    >
                      {savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save Changes
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={closeEditDialog}
                      className="h-11 w-full rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em] sm:w-auto"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
