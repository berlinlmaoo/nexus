"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { UserPlus, Loader2, X, Mail, Clock } from "lucide-react"

interface InviteDialogProps {
  projectId: string
  trigger?: React.ReactNode
}

interface Invite {
  id: string
  email: string
  role: string
  expiresAt: string
  inviter: { name: string; email: string }
}

interface Member {
  id: string
  role: string
  user: { id: string; name: string; email: string; avatar: string | null }
}

export function InviteDialog({ projectId, trigger }: InviteDialogProps) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("GUEST")
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/invite`)
      if (res.ok) {
        const data = await res.json()
        setInvites(data.invites || [])
        setMembers(data.members || [])
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      fetchData()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleInvite = async () => {
    setError(null)
    setSuccess(null)

    if (!email.trim()) {
      setError("Email is required")
      return
    }

    setInviting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to send invite")
      }

      setSuccess(data.message || "Invite sent")
      setEmail("")
      fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite")
    } finally {
      setInviting(false)
    }
  }

  const handleRevoke = async (inviteId: string) => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/invite?inviteId=${inviteId}`,
        { method: "DELETE" }
      )
      if (res.ok) {
        fetchData()
      }
    } catch {
      // ignore
    }
  }

  const initials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <UserPlus className="h-4 w-4 mr-1" />
            Invite
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite People</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-2">
          {/* Invite form */}
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="invite-email" className="text-xs">
                  Email address
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@example.com"
                  onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                />
              </div>
              <div className="w-32 space-y-1">
                <Label className="text-xs">Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GUEST">Guest</SelectItem>
                    <SelectItem value="MEMBER">Member</SelectItem>
                    <SelectItem value="VIEWER">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              size="sm"
              className="bg-foreground hover:bg-foreground/90"
              onClick={handleInvite}
              disabled={inviting || !email.trim()}
            >
              {inviting ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Mail className="h-3 w-3 mr-1" />
              )}
              Send Invite
            </Button>

            {error && <p className="text-xs text-red-600">{error}</p>}
            {success && <p className="text-xs text-green-600">{success}</p>}
          </div>

          <Separator />

          {/* Pending invites */}
          {invites.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Pending Invites
              </p>
              <div className="space-y-2">
                {invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between rounded-lg bg-zinc-50 dark:bg-zinc-900 p-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{invite.email}</span>
                      <span className="rounded bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 text-xs">
                        {invite.role}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleRevoke(invite.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Current members */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Members
            </p>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading...
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-1"
                  >
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        {member.user.avatar && (
                          <AvatarImage src={member.user.avatar} />
                        )}
                        <AvatarFallback className="bg-zinc-200 dark:bg-zinc-700 text-xs">
                          {initials(member.user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{member.user.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {member.user.email}
                        </p>
                      </div>
                    </div>
                    <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-xs font-medium">
                      {member.role}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
