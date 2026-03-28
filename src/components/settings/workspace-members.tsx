"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Users, UserPlus, Trash2, Loader2, Crown } from "lucide-react"

interface WorkspaceMember {
  id: string
  userId: string
  name: string
  email: string
  avatar: string | null
  role: string
  joinedAt: string
}

export function WorkspaceMembersSection({ canManage, currentUserId }: { canManage: boolean; currentUserId: string }) {
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
    } catch {
      // silently fail
    }
  }

  const handleRemove = async (memberId: string) => {
    if (!confirm("Remove this member from the workspace?")) return
    try {
      const res = await fetch(`/api/workspaces/members?memberId=${memberId}`, { method: "DELETE" })
      if (res.ok) {
        setMembers(members.filter(m => m.id !== memberId))
      }
    } catch {
      // silently fail
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Workspace Members
            <span className="text-sm font-normal text-muted-foreground">({members.length})</span>
          </CardTitle>
          {canManage && (
            <Button size="sm" className="bg-foreground text-background hover:bg-foreground/90" onClick={() => setShowInvite(!showInvite)}>
              <UserPlus className="h-4 w-4 mr-1" />
              Invite
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showInvite && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Email address" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleInvite() }} className="flex-1" />
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
              <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()} className="bg-foreground text-background hover:bg-foreground/90">
                {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
              </Button>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        )}

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
                <span className="text-[10px] text-muted-foreground">Joined {new Date(member.joinedAt).toLocaleDateString()}</span>
                {canManage && member.userId !== currentUserId ? (
                  <>
                    <select value={member.role} onChange={(e) => handleRoleChange(member.id, e.target.value)} className="h-7 rounded border bg-background px-2 text-xs">
                      <option value="MEMBER">Member</option>
                      <option value="ADMIN">Admin</option>
                      <option value="OWNER">Owner</option>
                    </select>
                    <button onClick={() => handleRemove(member.id)} className="p-1 text-muted-foreground hover:text-red-600 transition-colors">
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
  )
}
