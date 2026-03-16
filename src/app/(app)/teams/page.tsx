'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Users, Plus, UserCircle } from 'lucide-react'
import { UserAvatar } from '@/components/ui/user-avatar'

interface Team {
  id: string
  name: string
  color: string
  members: { user: { id: string; name: string; email: string } }[]
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamColor, setNewTeamColor] = useState('#18181B')
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    fetchTeams()
  }, [])

  const fetchTeams = () => {
    fetch('/api/teams')
      .then(res => res.json())
      .then(data => setTeams(Array.isArray(data) ? data : []))
      .catch(console.error)
  }

  const createTeam = async () => {
    if (!newTeamName.trim()) return
    setIsLoading(true)
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTeamName, color: newTeamColor }),
      })
      if (res.ok) {
        setNewTeamName('')
        setNewTeamColor('#18181B')
        setIsOpen(false)
        fetchTeams()
      }
    } catch (error) {
      console.error('Failed to create team:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const teamColors = ['#18181B', '#2563EB', '#059669', '#DC2626', '#D97706', '#7C3AED', '#0891B2', '#BE185D']

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Teams</h1>
          <p className="text-muted-foreground mt-1">Manage your divisions and team members</p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#18181B] hover:bg-[#27272A]">
              <Plus className="w-4 h-4 mr-2" />
              New Team
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Team</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground block mb-1">Team Name</label>
                <Input
                  placeholder="e.g., Jagain Agency"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground block mb-2">Color</label>
                <div className="flex gap-2">
                  {teamColors.map((color) => (
                    <button
                      key={color}
                      onClick={() => setNewTeamColor(color)}
                      className={`w-8 h-8 rounded-full transition-all ${
                        newTeamColor === color ? 'ring-2 ring-offset-2 ring-ring scale-110' : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <Button onClick={createTeam} disabled={isLoading || !newTeamName.trim()} className="w-full bg-[#18181B] hover:bg-[#27272A]">
                {isLoading ? 'Creating...' : 'Create Team'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {teams.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Users className="w-12 h-12 text-muted-foreground/60 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground">No teams yet</h3>
            <p className="text-muted-foreground/60 mt-1">Create teams for your divisions (Jagain, Multimedia, etc.)</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map((team) => (
            <Card key={team.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: team.color }}
                  />
                  <CardTitle className="text-lg">{team.name}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{team.members?.length ?? 0} members</p>
                  {team.members && team.members.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {team.members.map((member) => (
                        <div key={member.user.id} className="flex items-center gap-2 bg-muted/50 rounded-full px-3 py-1">
                          <UserAvatar user={{ name: member.user.name }} size="xs" />
                          <span className="text-xs text-muted-foreground">{member.user.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <UserCircle className="w-4 h-4" />
                      <span>No members added</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
