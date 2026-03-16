'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Users, Plus, UserCircle, FolderKanban, X, Search, UserPlus, LinkIcon } from 'lucide-react'
import { UserAvatar } from '@/components/ui/user-avatar'

interface TeamProject {
  id: string
  project: { id: string; name: string; color: string; icon: string; status: string }
}

interface TeamMember {
  user: { id: string; name: string; email: string; avatar?: string | null }
}

interface Team {
  id: string
  name: string
  color: string
  members: TeamMember[]
  projects: TeamProject[]
}

interface WorkspaceUser {
  id: string
  name: string
  email: string
  avatar?: string | null
}

interface AvailableProject {
  id: string
  name: string
  color: string
  icon: string
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamColor, setNewTeamColor] = useState('#18181B')
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Member picker state
  const [memberPickerTeam, setMemberPickerTeam] = useState<string | null>(null)
  const [allUsers, setAllUsers] = useState<WorkspaceUser[]>([])
  const [memberSearch, setMemberSearch] = useState('')

  // Project linker state
  const [projectPickerTeam, setProjectPickerTeam] = useState<string | null>(null)
  const [allProjects, setAllProjects] = useState<AvailableProject[]>([])
  const [projectSearch, setProjectSearch] = useState('')

  const fetchTeams = useCallback(() => {
    fetch('/api/teams')
      .then(res => res.json())
      .then(data => setTeams(Array.isArray(data) ? data : []))
      .catch(console.error)
  }, [])

  useEffect(() => {
    fetchTeams()
  }, [fetchTeams])

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

  // Member management
  const openMemberPicker = async (teamId: string) => {
    setMemberPickerTeam(teamId)
    setMemberSearch('')
    try {
      const res = await fetch('/api/search?q=@')
      if (res.ok) {
        const data = await res.json()
        setAllUsers(data.members ?? [])
      }
    } catch {
      // fallback: fetch users from workspace
    }
  }

  const addMember = async (teamId: string, userId: string) => {
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-member', teamId, userId }),
      })
      if (res.ok) fetchTeams()
    } catch (error) {
      console.error('Failed to add member:', error)
    }
  }

  const removeMember = async (teamId: string, userId: string) => {
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove-member', teamId, userId }),
      })
      if (res.ok) fetchTeams()
    } catch (error) {
      console.error('Failed to remove member:', error)
    }
  }

  // Project management
  const openProjectPicker = async (teamId: string) => {
    setProjectPickerTeam(teamId)
    setProjectSearch('')
    try {
      const res = await fetch('/api/projects')
      if (res.ok) {
        const data = await res.json()
        setAllProjects(Array.isArray(data) ? data : data.projects ?? [])
      }
    } catch {
      setAllProjects([])
    }
  }

  const linkProject = async (teamId: string, projectId: string) => {
    const team = teams.find(t => t.id === teamId)
    const memberCount = team?.members?.length ?? 0
    if (memberCount > 0 && !confirm(`This will grant all ${memberCount} team member${memberCount !== 1 ? 's' : ''} access to this project. Continue?`)) return
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link-project', teamId, projectId }),
      })
      if (res.ok) fetchTeams()
    } catch (error) {
      console.error('Failed to link project:', error)
    }
  }

  const unlinkProject = async (teamId: string, projectId: string) => {
    if (!confirm('Team members without direct access will lose access to this project. Continue?')) return
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink-project', teamId, projectId }),
      })
      if (res.ok) fetchTeams()
    } catch (error) {
      console.error('Failed to unlink project:', error)
    }
  }

  const avatarColors = ['#2563EB', '#059669', '#DC2626', '#D97706', '#7C3AED', '#0891B2', '#BE185D', '#4F46E5', '#0D9488', '#E11D48']
  const getTeamAvatarColor = (name: string) => {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return avatarColors[Math.abs(hash) % avatarColors.length]
  }

  const teamColors = ['#18181B', '#2563EB', '#059669', '#DC2626', '#D97706', '#7C3AED', '#0891B2', '#BE185D']

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your divisions and team members</p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-foreground text-background hover:bg-foreground/90">
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
              <Button onClick={createTeam} disabled={isLoading || !newTeamName.trim()} className="w-full bg-foreground text-background hover:bg-foreground/90">
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
          {teams.map((team) => {
            const teamMemberIds = new Set(team.members.map(m => m.user.id))
            const teamProjectIds = new Set(team.projects.map(p => p.project.id))

            return (
              <Card key={team.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                      style={{ backgroundColor: team.color || getTeamAvatarColor(team.name) }}
                    >
                      {team.name.charAt(0).toUpperCase()}
                    </div>
                    <CardTitle className="text-lg">{team.name}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Members section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-muted-foreground">{team.members?.length ?? 0} {(team.members?.length ?? 0) === 1 ? 'member' : 'members'}</p>
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openMemberPicker(team.id)}>
                        <UserPlus className="w-3.5 h-3.5 mr-1" />
                        <span className="text-xs">Manage</span>
                      </Button>
                    </div>
                    {team.members && team.members.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {team.members.map((member) => (
                          <div key={member.user.id} className="flex items-center gap-2 bg-muted/50 rounded-full px-3 py-1">
                            <UserAvatar user={{ name: member.user.name, image: member.user.avatar }} size="xs" />
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

                  {/* Projects section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-muted-foreground">{team.projects?.length ?? 0} {(team.projects?.length ?? 0) === 1 ? 'project' : 'projects'}</p>
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openProjectPicker(team.id)}>
                        <LinkIcon className="w-3.5 h-3.5 mr-1" />
                        <span className="text-xs">Link</span>
                      </Button>
                    </div>
                    {team.projects && team.projects.length > 0 ? (
                      <div className="space-y-1.5">
                        {team.projects.map((tp) => (
                          <div key={tp.id} className="flex items-center gap-2 group">
                            <Link
                              href={`/projects/${tp.project.id}`}
                              className="flex items-center gap-2 flex-1 min-w-0 rounded-md px-2 py-1 hover:bg-muted/50 transition-colors"
                            >
                              <span
                                className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-black/10"
                                style={{ backgroundColor: tp.project.color }}
                              />
                              <span className="text-sm truncate">{tp.project.name}</span>
                            </Link>
                            <button
                              onClick={() => unlinkProject(team.id, tp.project.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-all"
                            >
                              <X className="w-3 h-3 text-muted-foreground" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <FolderKanban className="w-4 h-4" />
                        <span>No projects linked</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Member Picker Dialog */}
      <Dialog open={!!memberPickerTeam} onOpenChange={(open) => { if (!open) setMemberPickerTeam(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Members</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search people..."
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {memberPickerTeam && (() => {
              const team = teams.find(t => t.id === memberPickerTeam)
              if (!team) return null
              const memberIds = new Set(team.members.map(m => m.user.id))
              const filtered = allUsers.filter(u =>
                (u.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
                 u.email.toLowerCase().includes(memberSearch.toLowerCase()))
              )

              return (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {/* Current members */}
                  {team.members.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">Current Members</p>
                      {team.members.map((m) => (
                        <div key={m.user.id} className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-muted/50">
                          <div className="flex items-center gap-2">
                            <UserAvatar user={{ name: m.user.name, image: m.user.avatar }} size="xs" />
                            <div>
                              <p className="text-sm">{m.user.name}</p>
                              <p className="text-xs text-muted-foreground">{m.user.email}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => removeMember(team.id, m.user.id)}>
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Available to add */}
                  {filtered.filter(u => !memberIds.has(u.id)).length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">Add Members</p>
                      {filtered.filter(u => !memberIds.has(u.id)).map((u) => (
                        <div key={u.id} className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-muted/50">
                          <div className="flex items-center gap-2">
                            <UserAvatar user={{ name: u.name, image: u.avatar }} size="xs" />
                            <div>
                              <p className="text-sm">{u.name}</p>
                              <p className="text-xs text-muted-foreground">{u.email}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => addMember(team.id, u.id)}>
                            <Plus className="w-3 h-3 mr-1" /> Add
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {filtered.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No users found</p>
                  )}
                </div>
              )
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Project Picker Dialog */}
      <Dialog open={!!projectPickerTeam} onOpenChange={(open) => { if (!open) setProjectPickerTeam(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Projects</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search projects..."
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {projectPickerTeam && (() => {
              const team = teams.find(t => t.id === projectPickerTeam)
              if (!team) return null
              const linkedIds = new Set(team.projects.map(p => p.project.id))
              const filtered = allProjects.filter(p =>
                p.name.toLowerCase().includes(projectSearch.toLowerCase())
              )

              return (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {filtered.map((project) => {
                    const isLinked = linkedIds.has(project.id)
                    return (
                      <div key={project.id} className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-muted/50">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-full flex-shrink-0 ring-1 ring-black/10"
                            style={{ backgroundColor: project.color }}
                          />
                          <span className="text-sm">{project.name}</span>
                        </div>
                        {isLinked ? (
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => unlinkProject(team.id, project.id)}>
                            Unlink
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => linkProject(team.id, project.id)}>
                            <LinkIcon className="w-3 h-3 mr-1" /> Link
                          </Button>
                        )}
                      </div>
                    )
                  })}
                  {filtered.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No projects found</p>
                  )}
                </div>
              )
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
