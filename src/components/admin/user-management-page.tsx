"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Shield, Search, Users, Loader2, UserPlus, Trash2, Building2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { UserAvatar } from "@/components/ui/user-avatar"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ProjectIcon } from "@/components/projects/project-icon"
import type { BadgeProps } from "@/components/ui/badge"
import { getPrimaryWorkspaceDefaults } from "@/lib/workspace-defaults"

type MembershipFilter = "all" | "workspace-members" | "non-members" | "system-admins"
type SystemRole = "ADMIN" | "MEMBER"
type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER"

interface AdminUserRow {
  id: string
  name: string
  email: string
  avatar: string | null
  role: SystemRole
  createdAt: string
  firstJoinedAt: string | null
  workspaceMembershipCount: number
}

interface WorkspaceOption {
  id: string
  name: string
  slug: string
}

interface UserWorkspaceMembership {
  id: string
  role: WorkspaceRole
  joinedAt: string
  workspace: WorkspaceOption
  teams: Array<{
    id: string
    name: string
    color: string
    role: string
  }>
  projects: Array<{
    id: string
    name: string
    color: string
    icon: string
    status: string
    role: string
    source: string
  }>
}

interface AdminUserDetail {
  id: string
  name: string
  email: string
  avatar: string | null
  role: SystemRole
  createdAt: string
  updatedAt: string
  workspaceMemberships: UserWorkspaceMembership[]
}

interface UserDetailResponse {
  user: AdminUserDetail
  availableWorkspaces: WorkspaceOption[]
}

interface UserManagementPageProps {
  currentUserName: string
}

const membershipFilterOptions: Array<{ value: MembershipFilter; label: string }> = [
  { value: "all", label: "All users" },
  { value: "workspace-members", label: "Workspace members" },
  { value: "non-members", label: "Non-members" },
  { value: "system-admins", label: "System admins" },
]

const systemRoleOptions: Array<{ value: "all" | SystemRole; label: string }> = [
  { value: "all", label: "All system roles" },
  { value: "ADMIN", label: "System admin" },
  { value: "MEMBER", label: "Member" },
]

const workspaceRoleOptions: WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER"]
const primaryWorkspaceDefaults = getPrimaryWorkspaceDefaults()

function formatDate(value: string | null) {
  if (!value) return "Not joined yet"
  return new Date(value).toLocaleDateString()
}

function isPrimaryWorkspaceMembership(workspace: WorkspaceOption) {
  return workspace.slug === primaryWorkspaceDefaults.slug || workspace.name === primaryWorkspaceDefaults.name
}

function systemRoleBadgeVariant(role: SystemRole): BadgeProps["variant"] {
  return role === "ADMIN" ? "default" : "outline"
}

export function UserManagementPage({ currentUserName }: UserManagementPageProps) {
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [membershipFilter, setMembershipFilter] = useState<MembershipFilter>("all")
  const [systemRoleFilter, setSystemRoleFilter] = useState<"all" | SystemRole>("all")
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState<AdminUserDetail | null>(null)
  const [availableWorkspaces, setAvailableWorkspaces] = useState<WorkspaceOption[]>([])
  const [pendingSystemRole, setPendingSystemRole] = useState<SystemRole>("MEMBER")
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState("")
  const [pendingWorkspaceRole, setPendingWorkspaceRole] = useState<WorkspaceRole>("MEMBER")
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [pendingRemoveMembership, setPendingRemoveMembership] = useState<{
    membershipId: string
    workspaceName: string
  } | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        q: query,
        membershipFilter,
        systemRole: systemRoleFilter,
        page: "1",
        pageSize: "50",
      })

      const res = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" })
      const data = res.ok ? await res.json() : { users: [] }
      setUsers(Array.isArray(data.users) ? data.users : [])
    } catch (error) {
      console.error("Failed to fetch admin users:", error)
      setUsers([])
      toast.error("Failed to load user directory")
    } finally {
      setLoading(false)
    }
  }, [membershipFilter, query, systemRoleFilter])

  const fetchUserDetail = useCallback(async (userId: string) => {
    setSelectedUserId(userId)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { cache: "no-store" })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || "Failed to load user details")
      }

      const payload = data as UserDetailResponse
      setSelectedUser(payload.user)
      setAvailableWorkspaces(payload.availableWorkspaces)
      setPendingSystemRole(payload.user.role)
      setDetailOpen(true)
    } catch (error) {
      console.error("Failed to fetch admin user detail:", error)
      toast.error(error instanceof Error ? error.message : "Failed to load user details")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const unassignedWorkspaces = useMemo(() => {
    if (!selectedUser) return []
    const assignedIds = new Set(selectedUser.workspaceMemberships.map((membership) => membership.workspace.id))
    return availableWorkspaces.filter((workspace) => !assignedIds.has(workspace.id))
  }, [availableWorkspaces, selectedUser])

  useEffect(() => {
    if (unassignedWorkspaces.length === 0) {
      setPendingWorkspaceId("")
      return
    }

    setPendingWorkspaceId((current) => {
      if (current && unassignedWorkspaces.some((workspace) => workspace.id === current)) {
        return current
      }

      return unassignedWorkspaces[0]?.id ?? ""
    })
  }, [unassignedWorkspaces])

  const refreshSelectedUser = useCallback(async () => {
    if (!selectedUserId) return
    await fetchUserDetail(selectedUserId)
    await fetchUsers()
  }, [fetchUserDetail, fetchUsers, selectedUserId])

  const handleSystemRoleSave = async () => {
    if (!selectedUser || pendingSystemRole === selectedUser.role) return

    setActiveAction("system-role")
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: pendingSystemRole }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || "Failed to update system role")
      }

      toast.success("System role updated")
      await refreshSelectedUser()
    } catch (error) {
      console.error("Failed to update system role:", error)
      toast.error(error instanceof Error ? error.message : "Failed to update system role")
    } finally {
      setActiveAction(null)
    }
  }

  const handleAddWorkspaceMembership = async () => {
    if (!selectedUser || !pendingWorkspaceId) return

    setActiveAction("add-workspace")
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/workspace-memberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: pendingWorkspaceId, role: pendingWorkspaceRole }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || "Failed to add user to workspace")
      }

      toast.success("User added to workspace")
      setPendingWorkspaceId("")
      setPendingWorkspaceRole("MEMBER")
      await refreshSelectedUser()
    } catch (error) {
      console.error("Failed to add workspace membership:", error)
      toast.error(error instanceof Error ? error.message : "Failed to add user to workspace")
    } finally {
      setActiveAction(null)
    }
  }

  const handleWorkspaceRoleChange = async (membershipId: string, role: WorkspaceRole) => {
    if (!selectedUser) return

    setActiveAction(`membership-role-${membershipId}`)
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/workspace-memberships/${membershipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || "Failed to update workspace role")
      }

      toast.success("Workspace role updated")
      await refreshSelectedUser()
    } catch (error) {
      console.error("Failed to update workspace role:", error)
      toast.error(error instanceof Error ? error.message : "Failed to update workspace role")
    } finally {
      setActiveAction(null)
    }
  }

  const confirmRemoveWorkspaceMembership = async () => {
    if (!selectedUser || !pendingRemoveMembership) return

    setActiveAction(`remove-membership-${pendingRemoveMembership.membershipId}`)
    try {
      const res = await fetch(
        `/api/admin/users/${selectedUser.id}/workspace-memberships/${pendingRemoveMembership.membershipId}`,
        { method: "DELETE" }
      )
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || "Failed to remove workspace membership")
      }

      toast.success("Workspace membership removed")
      setPendingRemoveMembership(null)
      await refreshSelectedUser()
    } catch (error) {
      console.error("Failed to remove workspace membership:", error)
      toast.error(error instanceof Error ? error.message : "Failed to remove workspace membership")
    } finally {
      setActiveAction(null)
    }
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-8 animate-fade-in pb-24">
      <div className="space-y-2">
        <h1 className="text-3xl font-headline font-black tracking-tighter text-primary sm:text-5xl">
          User Management
        </h1>
        <p className="flex items-center gap-3 text-sm font-medium text-on-surface-variant/60 sm:text-lg">
          <span className="h-2 w-2 rounded-full bg-primary" />
          Global directory and access control for admin operators like {currentUserName}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-[2rem] border border-on-surface-variant/5 bg-surface-container-lowest p-5 shadow-sm sm:grid-cols-[minmax(0,1fr)_220px_220px] sm:rounded-[2.5rem] sm:p-8">
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
            Search Directory
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/30" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or email..."
              className="h-12 rounded-2xl border-none bg-surface-container-low pl-11 font-medium"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
            Membership Scope
          </label>
          <Select value={membershipFilter} onValueChange={(value) => setMembershipFilter(value as MembershipFilter)}>
            <SelectTrigger className="h-12 rounded-2xl border-none bg-surface-container-low font-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {membershipFilterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">
            System Role
          </label>
          <Select value={systemRoleFilter} onValueChange={(value) => setSystemRoleFilter(value as "all" | SystemRole)}>
            <SelectTrigger className="h-12 rounded-2xl border-none bg-surface-container-low font-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {systemRoleOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary/30" />
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-[2rem] border border-on-surface-variant/5 bg-surface-container-lowest p-8 shadow-sm">
          <EmptyState
            icon={Users}
            title="No users match this filter"
            description="Try another search term or widen the membership and role filters."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex flex-col gap-4 rounded-[2rem] border border-on-surface-variant/5 bg-surface-container-lowest p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6"
            >
              <div className="flex min-w-0 items-center gap-4">
                <UserAvatar user={{ name: user.name, avatar: user.avatar }} size="lg" className="h-12 w-12 rounded-2xl" />
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-lg font-headline font-black tracking-tight text-primary">
                      {user.name}
                    </p>
                    <Badge variant={systemRoleBadgeVariant(user.role)}>
                      {user.role === "ADMIN" ? "System Admin" : "Member"}
                    </Badge>
                  </div>
                  <p className="truncate text-sm text-on-surface-variant/55">{user.email}</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:items-end">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">
                  <span>{user.workspaceMembershipCount} workspace{user.workspaceMembershipCount === 1 ? "" : "s"}</span>
                  <span className="h-1 w-1 rounded-full bg-on-surface-variant/20" />
                  <span>Registered {formatDate(user.createdAt)}</span>
                  <span className="h-1 w-1 rounded-full bg-on-surface-variant/20" />
                  <span>First joined {formatDate(user.firstJoinedAt)}</span>
                </div>
                <Button
                  onClick={() => void fetchUserDetail(user.id)}
                  disabled={detailLoading && selectedUserId === user.id}
                  className="h-11 w-full rounded-2xl bg-primary px-5 text-xs font-black uppercase tracking-widest text-primary-foreground sm:w-auto"
                >
                  {detailLoading && selectedUserId === user.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Shield className="mr-2 h-4 w-4" />
                      Manage Access
                    </>
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl rounded-[2rem] border-none p-5 shadow-2xl sm:rounded-[2.5rem] sm:p-8">
          <DialogHeader>
            <DialogTitle>User Access & Roles</DialogTitle>
            <DialogDescription>
              Global system access, workspace roles, and read-only membership context.
            </DialogDescription>
          </DialogHeader>

          {!selectedUser ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary/30" />
            </div>
          ) : (
            <div className="space-y-8">
              <div className="flex flex-col gap-4 rounded-[1.75rem] bg-surface-container-low/50 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <UserAvatar user={{ name: selectedUser.name, avatar: selectedUser.avatar }} size="xl" className="rounded-[1.5rem]" />
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-2xl font-headline font-black tracking-tight text-primary">
                        {selectedUser.name}
                      </h3>
                      <Badge variant={systemRoleBadgeVariant(selectedUser.role)}>
                        {selectedUser.role === "ADMIN" ? "System Admin" : "Member"}
                      </Badge>
                    </div>
                    <p className="text-sm text-on-surface-variant/60">{selectedUser.email}</p>
                    <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/35">
                      Registered {formatDate(selectedUser.createdAt)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <div className="space-y-6">
                  <div className="space-y-4 rounded-[1.75rem] bg-surface-container-low/40 p-5">
                    <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/35">
                      <Shield className="h-3.5 w-3.5" />
                      System Role
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Select value={pendingSystemRole} onValueChange={(value) => setPendingSystemRole(value as SystemRole)}>
                        <SelectTrigger className="h-11 flex-1 rounded-2xl border-none bg-surface-container-lowest font-medium">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ADMIN">System Admin</SelectItem>
                          <SelectItem value="MEMBER">Member</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={() => void handleSystemRoleSave()}
                        disabled={activeAction === "system-role" || pendingSystemRole === selectedUser.role}
                        className="h-11 w-full rounded-2xl bg-primary px-5 text-xs font-black uppercase tracking-widest text-primary-foreground sm:w-auto"
                      >
                        {activeAction === "system-role" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-[1.75rem] bg-surface-container-low/40 p-5">
                    <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/35">
                      <UserPlus className="h-3.5 w-3.5" />
                      Add To Workspace
                    </p>
                    {unassignedWorkspaces.length > 0 ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
                        <Select value={pendingWorkspaceId} onValueChange={setPendingWorkspaceId}>
                          <SelectTrigger className="h-11 rounded-2xl border-none bg-surface-container-lowest font-medium">
                            <SelectValue placeholder="Select workspace..." />
                          </SelectTrigger>
                          <SelectContent>
                            {unassignedWorkspaces.map((workspace) => (
                              <SelectItem key={workspace.id} value={workspace.id}>
                                {workspace.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={pendingWorkspaceRole} onValueChange={(value) => setPendingWorkspaceRole(value as WorkspaceRole)}>
                          <SelectTrigger className="h-11 rounded-2xl border-none bg-surface-container-lowest font-medium">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {workspaceRoleOptions.map((role) => (
                              <SelectItem key={role} value={role}>
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          onClick={() => void handleAddWorkspaceMembership()}
                          disabled={activeAction === "add-workspace" || !pendingWorkspaceId}
                          className="h-11 w-full rounded-2xl bg-primary px-5 text-xs font-black uppercase tracking-widest text-primary-foreground sm:w-auto"
                        >
                          {activeAction === "add-workspace" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-on-surface-variant/10 bg-surface-container-lowest px-4 py-4">
                        <p className="text-sm font-bold text-on-surface">
                          This user is already in every available workspace.
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-on-surface-variant/55">
                          Add another workspace first if you want to assign this user somewhere else.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 rounded-[1.75rem] bg-surface-container-low/40 p-5">
                    <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/35">
                      <Building2 className="h-3.5 w-3.5" />
                      Workspace Access
                    </p>

                    <div className="space-y-3">
                      {selectedUser.workspaceMemberships.length > 0 ? (
                        selectedUser.workspaceMemberships.map((membership) => (
                          <div key={membership.id} className="space-y-3 rounded-2xl bg-surface-container-lowest p-4">
                            {(() => {
                              const isPrimaryMembership = isPrimaryWorkspaceMembership(membership.workspace)

                              return (
                                <>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-bold text-on-surface">{membership.workspace.name}</p>
                                <p className="text-xs text-on-surface-variant/50">
                                  Joined {formatDate(membership.joinedAt)}
                                </p>
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                {isPrimaryMembership ? (
                                  <>
                                    <div className="flex h-10 min-w-[150px] items-center rounded-2xl bg-surface-container px-4 text-sm font-medium text-on-surface-variant/75">
                                      {membership.role}
                                    </div>
                                    <Badge variant="outline" className="h-10 rounded-2xl border-primary/15 bg-primary/5 px-4 text-[10px] font-black uppercase tracking-widest text-primary">
                                      Required
                                    </Badge>
                                  </>
                                ) : (
                                  <>
                                    <Select
                                      value={membership.role}
                                      onValueChange={(value) => void handleWorkspaceRoleChange(membership.id, value as WorkspaceRole)}
                                    >
                                      <SelectTrigger className="h-10 min-w-[150px] rounded-2xl border-none bg-surface-container font-medium">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {workspaceRoleOptions.map((role) => (
                                          <SelectItem key={role} value={role}>
                                            {role}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Button
                                      variant="outline"
                                      onClick={() => setPendingRemoveMembership({
                                        membershipId: membership.id,
                                        workspaceName: membership.workspace.name,
                                      })}
                                      disabled={activeAction === `remove-membership-${membership.id}`}
                                      className="h-10 rounded-2xl border-red-200/60 bg-red-50 px-4 text-xs font-black uppercase tracking-widest text-red-600 hover:bg-red-100"
                                    >
                                      {activeAction === `remove-membership-${membership.id}` ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <>
                                          <Trash2 className="mr-2 h-4 w-4" />
                                          Remove
                                        </>
                                      )}
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>

                            {isPrimaryMembership && (
                              <p className="text-xs leading-relaxed text-on-surface-variant/45">
                                PATS Group adalah workspace utama yang wajib untuk semua user, jadi role dan membership-nya tidak diubah dari panel ini.
                              </p>
                            )}

                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                              <div className="space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/35">
                                  Teams
                                </p>
                                {membership.teams.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {membership.teams.map((team) => (
                                      <Badge key={team.id} variant="ghost" className="gap-2">
                                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: team.color }} />
                                        {team.name} · {team.role}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-on-surface-variant/45">No team access in this workspace.</p>
                                )}
                              </div>

                              <div className="space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/35">
                                  Projects
                                </p>
                                {membership.projects.length > 0 ? (
                                  <div className="space-y-2">
                                    {membership.projects.map((project) => (
                                      <div key={project.id} className="flex items-center gap-3 rounded-2xl bg-surface-container px-3 py-2">
                                        <ProjectIcon icon={project.icon} color={project.color} size="sm" variant="lucide" />
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-sm font-bold text-on-surface">{project.name}</p>
                                          <p className="truncate text-xs text-on-surface-variant/50">
                                            {project.role} · {project.source === "direct" ? "Direct" : "Team sync"}
                                          </p>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-on-surface-variant/45">No project access in this workspace.</p>
                                )}
                              </div>
                            </div>
                                </>
                              )
                            })()}
                          </div>
                        ))
                      ) : (
                        <p className="rounded-2xl border border-dashed border-on-surface-variant/10 px-4 py-5 text-sm text-on-surface-variant/40">
                          This user has not joined any workspace yet.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-[1.75rem] bg-surface-container-low/40 p-5">
                  <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/35">
                    <Users className="h-3.5 w-3.5" />
                    Membership Context
                  </p>
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-surface-container-lowest p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/35">
                        Workspace memberships
                      </p>
                      <p className="mt-2 text-3xl font-headline font-black tracking-tight text-primary">
                        {selectedUser.workspaceMemberships.length}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-surface-container-lowest p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/35">
                        Team memberships
                      </p>
                      <p className="mt-2 text-3xl font-headline font-black tracking-tight text-primary">
                        {selectedUser.workspaceMemberships.reduce((count, membership) => count + membership.teams.length, 0)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-surface-container-lowest p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/35">
                        Project memberships
                      </p>
                      <p className="mt-2 text-3xl font-headline font-black tracking-tight text-primary">
                        {selectedUser.workspaceMemberships.reduce((count, membership) => count + membership.projects.length, 0)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-dashed border-on-surface-variant/10 px-4 py-4 text-sm text-on-surface-variant/45">
                      Team dan project di panel ini masih read-only untuk v1. Edit akses detail tetap lewat surface Teams dan Project membership yang sudah ada.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingRemoveMembership)}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveMembership(null)
        }}
        title="Remove user from workspace?"
        description={pendingRemoveMembership
          ? `This will remove the user from ${pendingRemoveMembership.workspaceName}. Existing team and project access sourced from that workspace may also stop working.`
          : "Remove this user from the selected workspace."}
        confirmLabel="Remove access"
        icon={<Trash2 className="h-5 w-5" />}
        isLoading={Boolean(
          pendingRemoveMembership &&
          activeAction === `remove-membership-${pendingRemoveMembership.membershipId}`
        )}
        onConfirm={confirmRemoveWorkspaceMembership}
      />
    </div>
  )
}
