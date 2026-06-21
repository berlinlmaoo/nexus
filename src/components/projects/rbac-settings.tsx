"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/ui/user-avatar"
import { Shield, ShieldCheck, Eye, UserCog, ChevronDown, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

type Role = "ADMIN" | "MEMBER" | "VIEWER" | "GUEST"

interface Member {
  id: string
  name: string
  email: string
  avatar: string | null
  role: Role
}

interface RBACSettingsProps {
  projectId: string
  members: Member[]
  currentUserRole?: Role
  onRoleChange?: (memberId: string, role: Role) => void
}

const ROLES: { value: Role; label: string; description: string; icon: typeof Shield }[] = [
  { value: "ADMIN", label: "Admin", description: "Full access to all settings and data", icon: ShieldCheck },
  { value: "MEMBER", label: "Member", description: "Create and edit tasks, add comments", icon: Shield },
  { value: "VIEWER", label: "Viewer", description: "Read-only access to project data", icon: Eye },
  { value: "GUEST", label: "Guest", description: "Limited read access to specific projects", icon: UserCog },
]

const ROLE_COLORS: Record<Role, string> = {
  ADMIN: "bg-foreground text-white",
  MEMBER: "bg-surface-container text-foreground",
  VIEWER: "bg-muted text-on-surface-variant",
  GUEST: "bg-surface-container-lowest text-muted-foreground border",
}

const ROLE_PERMISSIONS: Record<Role, string[]> = {
  ADMIN: ["Manage members", "Edit settings", "Delete project", "Create tasks", "Edit tasks", "Comment", "View"],
  MEMBER: ["Create tasks", "Edit tasks", "Comment", "View"],
  VIEWER: ["View tasks", "View comments"],
  GUEST: ["View assigned tasks only"],
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge className={cn("text-[10px] font-medium px-1.5 py-0", ROLE_COLORS[role])}>
      {role}
    </Badge>
  )
}

export function RBACSettings({ projectId, members: initialMembers, currentUserRole = "ADMIN", onRoleChange }: RBACSettingsProps) {
  const [members, setMembers] = useState(initialMembers)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)

  const isAdmin = currentUserRole === "ADMIN"

  const handleRoleChange = async (memberId: string, newRole: Role) => {
    setUpdating(memberId)
    setOpenDropdown(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, role: newRole }),
      })
      if (res.ok) {
        setMembers(members.map(m => m.id === memberId ? { ...m, role: newRole } : m))
        onRoleChange?.(memberId, newRole)
      }
    } catch (e) {
      console.error("Failed to update role:", e)
    } finally {
      setUpdating(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-5 w-5" />
          Team Roles & Permissions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Permissions overview */}
        <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {ROLES.map(({ value, label, description, icon: Icon }) => (
            <div key={value} className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold">{label}</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">{description}</p>
              <div className="pt-1 space-y-0.5">
                {ROLE_PERMISSIONS[value].map(perm => (
                  <p key={perm} className="text-[10px] text-muted-foreground">• {perm}</p>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Members list */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Members</h4>
          {members.map(member => (
            <div key={member.id} className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3">
                <UserAvatar user={{ name: member.name, image: member.avatar }} size="md" />
                <div>
                  <p className="text-sm font-medium">{member.name}</p>
                  <p className="text-xs text-muted-foreground">{member.email}</p>
                </div>
              </div>
              <div className="relative">
                {isAdmin ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 gap-1"
                      onClick={() => setOpenDropdown(openDropdown === member.id ? null : member.id)}
                      disabled={updating === member.id}
                    >
                      {updating === member.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <RoleBadge role={member.role} />
                          <ChevronDown className="h-3 w-3" />
                        </>
                      )}
                    </Button>
                    {openDropdown === member.id && (
                      <div className="absolute right-0 top-full mt-1 z-20 rounded-lg border bg-background p-1 shadow-lg min-w-[160px] animate-scale-in">
                        {ROLES.map(role => (
                          <button
                            key={role.value}
                            onClick={() => handleRoleChange(member.id, role.value)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors",
                              member.role === role.value ? "bg-muted font-medium" : "hover:bg-muted/50"
                            )}
                          >
                            <role.icon className="h-3 w-3" />
                            {role.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <RoleBadge role={member.role} />
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
