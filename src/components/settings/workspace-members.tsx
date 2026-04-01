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
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary/20" />
      </div>
    )
  }

  return (
    <div className="space-y-12">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-headline font-black text-on-surface tracking-tight">Active Operatives</h3>
          <p className="text-sm text-on-surface-variant/60 font-medium">Verified personnel with access to this node ({members.length}).</p>
        </div>
        {canManage && (
          <Button 
            onClick={() => setShowInvite(!showInvite)}
            className="h-12 px-6 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg transition-all active:scale-95"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Invite
          </Button>
        )}
      </div>

      <div className="space-y-8">
        {showInvite && (
          <div className="p-8 rounded-[2rem] bg-surface-container-low border border-primary/5 space-y-6 animate-scale-in">
             <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Operative Email</label>
                <div className="flex gap-4">
                  <input 
                    placeholder="Enter email address..." 
                    value={inviteEmail} 
                    onChange={(e) => setInviteEmail(e.target.value)} 
                    onKeyDown={(e) => { if (e.key === "Enter") handleInvite() }} 
                    className="flex-1 h-14 bg-surface-container-lowest border-none rounded-2xl px-6 text-sm font-bold text-on-surface placeholder:text-on-surface-variant/20 focus:ring-4 focus:ring-primary/5 transition-all"
                  />
                  <select 
                    value={inviteRole} 
                    onChange={(e) => setInviteRole(e.target.value)} 
                    className="h-14 rounded-2xl bg-surface-container-lowest border-none px-6 text-sm font-bold text-on-surface focus:ring-4 focus:ring-primary/5 outline-none appearance-none cursor-pointer"
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                  <Button 
                    onClick={handleInvite} 
                    disabled={inviting || !inviteEmail.trim()} 
                    className="h-14 px-8 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg transition-all"
                  >
                    {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Deploy Invitation"}
                  </Button>
                </div>
                {error && <p className="text-[10px] font-bold text-red-600 ml-1 uppercase tracking-widest mt-2">{error}</p>}
             </div>
          </div>
        )}

        <div className="space-y-1">
          {members.map((member) => (
            <div key={member.id} className="group flex items-center justify-between py-4 px-6 rounded-2xl hover:bg-surface-container-low transition-all duration-300">
              <div className="flex items-center gap-4">
                <div className="relative">
                   <Avatar className="h-12 w-12 rounded-2xl ring-2 ring-surface-container-low">
                    {member.avatar && <AvatarImage src={member.avatar} alt={member.name} />}
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-black rounded-2xl">
                      {member.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  {member.role === "OWNER" && (
                    <div className="absolute -top-1 -right-1 h-5 w-5 bg-amber-500 rounded-lg flex items-center justify-center text-white shadow-lg">
                      <Crown className="h-3 w-3" />
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-on-surface">{member.name}</p>
                    {member.userId === currentUserId && (
                      <span className="text-[9px] font-black uppercase tracking-widest bg-primary/10 text-primary px-2 py-0.5 rounded-full">Origin Node</span>
                    )}
                  </div>
                  <p className="text-xs text-on-surface-variant/60 font-medium">{member.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/20">Access Logged: {new Date(member.joinedAt).toLocaleDateString()}</span>
                {canManage && member.userId !== currentUserId ? (
                  <div className="flex items-center gap-2">
                    <select 
                      value={member.role} 
                      onChange={(e) => handleRoleChange(member.id, e.target.value)} 
                      className="h-8 rounded-xl bg-surface-container-high/50 border-none px-3 text-[10px] font-black uppercase tracking-widest text-on-surface outline-none appearance-none cursor-pointer hover:bg-surface-container-high transition-colors"
                    >
                      <option value="MEMBER">Member</option>
                      <option value="ADMIN">Admin</option>
                      <option value="OWNER">Owner</option>
                    </select>
                    <button 
                      onClick={() => handleRemove(member.id)} 
                      className="p-2 text-on-surface-variant/20 hover:text-red-600 hover:bg-red-50 transition-all rounded-lg opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <span className="px-3 py-1 rounded-full bg-surface-container-high text-[9px] font-black uppercase tracking-[0.2em] text-on-surface-variant/60">
                    {member.role}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
