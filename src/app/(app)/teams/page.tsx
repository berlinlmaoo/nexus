'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { EmptyTeams } from '@/components/ui/empty-state'
import { Users, Plus, FolderKanban, UserPlus, LinkIcon, ShieldCheck, Loader2, Trash2 } from 'lucide-react'
import { UserAvatar } from '@/components/ui/user-avatar'
import { ProjectIcon } from '@/components/projects/project-icon'

interface TeamProject {
  id: string
  project: { id: string; name: string; color: string; icon: string; status: string }
}

interface TeamMember {
  id: string
  role: string
  user: { id: string; name: string; email: string; avatar?: string | null }
}

interface Team {
  id: string
  name: string
  color: string
  members: TeamMember[]
  projects: TeamProject[]
}

interface WorkspaceMember {
  id: string
  userId: string
  name: string
  email: string
  avatar: string | null
  role: string
}

interface ProjectOption {
  id: string
  name: string
  color: string
  icon: string
  status: string
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamColor, setNewTeamColor] = useState('#0c1427')
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isCreatingTeam, setIsCreatingTeam] = useState(false)
  const [memberDrafts, setMemberDrafts] = useState<Record<string, string>>({})
  const [projectDrafts, setProjectDrafts] = useState<Record<string, string>>({})
  const [activeAction, setActiveAction] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [teamsRes, membersRes, projectsRes] = await Promise.all([
        fetch('/api/teams'),
        fetch('/api/workspaces/members'),
        fetch('/api/projects'),
      ])

      const teamsData = teamsRes.ok ? await teamsRes.json() : []
      const membersData = membersRes.ok ? await membersRes.json() : { members: [] }
      const projectsData = projectsRes.ok ? await projectsRes.json() : []

      setTeams(Array.isArray(teamsData) ? teamsData : [])
      setWorkspaceMembers(Array.isArray(membersData?.members) ? membersData.members : [])
      setProjects(Array.isArray(projectsData) ? projectsData : [])
    } catch (error) {
      console.error('Failed to fetch team data:', error)
      setTeams([])
      setWorkspaceMembers([])
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const createTeam = async () => {
    if (!newTeamName.trim()) return
    setIsCreatingTeam(true)
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTeamName, color: newTeamColor }),
      })
      if (res.ok) {
        setNewTeamName('')
        setIsOpen(false)
        await fetchData()
      }
    } catch (error) {
      console.error('Failed to create team:', error)
    } finally {
      setIsCreatingTeam(false)
    }
  }

  const runTeamAction = async (actionKey: string, body: Record<string, string>) => {
    setActiveAction(actionKey)
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        await fetchData()
        return true
      }
    } catch (error) {
      console.error('Failed team action:', error)
    } finally {
      setActiveAction(null)
    }
    return false
  }

  const handleAddMember = async (teamId: string) => {
    const userId = memberDrafts[teamId]
    if (!userId) return
    const didAdd = await runTeamAction(`add-member-${teamId}`, {
      action: 'add-member',
      teamId,
      userId,
    })
    if (didAdd) {
      setMemberDrafts((prev) => ({ ...prev, [teamId]: '' }))
    }
  }

  const handleRemoveMember = async (teamId: string, userId: string) => {
    if (!confirm('Remove this member from the team?')) return
    await runTeamAction(`remove-member-${teamId}-${userId}`, {
      action: 'remove-member',
      teamId,
      userId,
    })
  }

  const handleLinkProject = async (teamId: string) => {
    const projectId = projectDrafts[teamId]
    if (!projectId) return
    const didLink = await runTeamAction(`link-project-${teamId}`, {
      action: 'link-project',
      teamId,
      projectId,
    })
    if (didLink) {
      setProjectDrafts((prev) => ({ ...prev, [teamId]: '' }))
    }
  }

  const handleUnlinkProject = async (teamId: string, projectId: string) => {
    if (!confirm('Unlink this project from the team?')) return
    await runTeamAction(`unlink-project-${teamId}-${projectId}`, {
      action: 'unlink-project',
      teamId,
      projectId,
    })
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-8 animate-fade-in pb-24 sm:space-y-10">
      <div className="flex flex-col gap-4 sm:gap-8 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-headline font-black tracking-tighter text-primary sm:text-5xl">Teams</h1>
          <p className="flex items-center gap-3 text-sm font-medium text-on-surface-variant/60 sm:text-lg">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Managing {teams.length} active team{teams.length === 1 ? '' : 's'}
          </p>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="h-12 w-full rounded-2xl bg-primary px-6 text-xs font-black uppercase tracking-[0.2em] text-primary-foreground shadow-2xl shadow-primary/20 transition-all hover:-translate-y-1 active:scale-95 sm:h-14 sm:w-auto sm:px-8">
              <Plus className="mr-3 h-4 w-4" />
              Create Team
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md rounded-[2rem] border-none p-5 shadow-2xl sm:rounded-[2.5rem] sm:p-8">
            <DialogHeader>
              <DialogTitle className="text-2xl font-headline font-black text-primary">Create Team</DialogTitle>
            </DialogHeader>
            <div className="space-y-6 pt-6">
              <div className="space-y-2">
                <label className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">Team Name</label>
                <input
                  placeholder="e.g. Operations"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  className="h-12 w-full rounded-2xl bg-surface-container-low px-4 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 focus:ring-2 focus:ring-primary/5"
                />
              </div>
              <Button onClick={createTeam} disabled={isCreatingTeam || !newTeamName.trim()} className="h-14 w-full rounded-2xl bg-primary text-xs font-black uppercase tracking-widest text-primary-foreground">
                {isCreatingTeam ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Team'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary/30" />
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-[2rem] border border-on-surface-variant/5 bg-surface-container-lowest p-5 sm:rounded-[2.5rem] sm:p-8">
          <EmptyTeams onAdd={() => setIsOpen(true)} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-8 xl:grid-cols-2">
          {teams.map((team) => {
            const availableMembers = workspaceMembers.filter(
              (member) => !team.members.some((teamMember) => teamMember.user.id === member.userId)
            )
            const availableProjects = projects.filter(
              (project) => !team.projects.some((teamProject) => teamProject.project.id === project.id)
            )

            return (
              <div
                key={team.id}
                className="space-y-5 rounded-[2rem] border border-on-surface-variant/5 bg-surface-container-lowest p-5 shadow-sm sm:space-y-6 sm:rounded-[2.5rem] sm:p-8"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div
                      className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] text-lg font-black text-primary-foreground shadow-lg sm:h-16 sm:w-16 sm:rounded-[1.5rem] sm:text-xl"
                      style={{ backgroundColor: team.color }}
                    >
                      {team.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-xl font-headline font-black tracking-tight text-primary sm:text-2xl">{team.name}</h3>
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">
                        <ShieldCheck className="h-3 w-3" />
                        <span>{team.members.length} member{team.members.length === 1 ? '' : 's'}</span>
                        <span className="h-1 w-1 rounded-full bg-on-surface-variant/20" />
                        <span>{team.projects.length} project{team.projects.length === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="space-y-4 rounded-[1.5rem] bg-surface-container-low/40 p-4 sm:rounded-[1.75rem] sm:p-6">
                    <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30">
                      <Users className="h-3 w-3" />
                      Team Members
                    </p>

                    <div className="space-y-3">
                      {team.members.length > 0 ? (
                        team.members.map((member) => (
                          <div key={member.id} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                              <UserAvatar user={{ name: member.user.name, avatar: member.user.avatar }} size="sm" />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-on-surface">{member.user.name}</p>
                                <p className="truncate text-xs text-on-surface-variant/50">{member.user.email}</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-2 sm:justify-end">
                              <span className="rounded-full bg-surface-container px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-on-surface-variant/60">
                                {member.role}
                              </span>
                              <button
                                onClick={() => handleRemoveMember(team.id, member.user.id)}
                                disabled={activeAction === `remove-member-${team.id}-${member.user.id}`}
                                className="rounded-xl p-2 text-on-surface-variant/30 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                                title="Remove member"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-2xl border border-dashed border-on-surface-variant/10 px-4 py-5 text-sm text-on-surface-variant/40">
                          No members in this team yet.
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 border-t border-on-surface-variant/5 pt-4">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30">
                        <UserPlus className="h-3 w-3" />
                        Add Member
                      </div>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <select
                          value={memberDrafts[team.id] || ''}
                          onChange={(e) => setMemberDrafts((prev) => ({ ...prev, [team.id]: e.target.value }))}
                          className="h-11 flex-1 rounded-2xl bg-surface-container-lowest px-4 text-sm font-medium text-on-surface outline-none"
                        >
                          <option value="">Select workspace member...</option>
                          {availableMembers.map((member) => (
                            <option key={member.id} value={member.userId}>
                              {member.name} ({member.email})
                            </option>
                          ))}
                        </select>
                        <Button
                          onClick={() => handleAddMember(team.id)}
                          disabled={!memberDrafts[team.id] || activeAction === `add-member-${team.id}`}
                          className="h-11 rounded-2xl bg-primary px-5 text-xs font-black uppercase tracking-widest text-primary-foreground"
                        >
                          {activeAction === `add-member-${team.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-[1.5rem] bg-surface-container-low/40 p-4 sm:rounded-[1.75rem] sm:p-6">
                    <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30">
                      <FolderKanban className="h-3 w-3" />
                      Linked Projects
                    </p>

                    <div className="space-y-3">
                      {team.projects.length > 0 ? (
                        team.projects.map((teamProject) => (
                          <div key={teamProject.id} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                              <ProjectIcon icon={teamProject.project.icon} color={teamProject.project.color} size="sm" variant="lucide" />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-on-surface">{teamProject.project.name}</p>
                                <p className="truncate text-xs text-on-surface-variant/50">{teamProject.project.status}</p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleUnlinkProject(team.id, teamProject.project.id)}
                              disabled={activeAction === `unlink-project-${team.id}-${teamProject.project.id}`}
                              className="self-end rounded-xl p-2 text-on-surface-variant/30 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 sm:self-auto"
                              title="Unlink project"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-2xl border border-dashed border-on-surface-variant/10 px-4 py-5 text-sm text-on-surface-variant/40">
                          No linked projects yet.
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 border-t border-on-surface-variant/5 pt-4">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30">
                        <LinkIcon className="h-3 w-3" />
                        Link Project
                      </div>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <select
                          value={projectDrafts[team.id] || ''}
                          onChange={(e) => setProjectDrafts((prev) => ({ ...prev, [team.id]: e.target.value }))}
                          className="h-11 flex-1 rounded-2xl bg-surface-container-lowest px-4 text-sm font-medium text-on-surface outline-none"
                        >
                          <option value="">Select project...</option>
                          {availableProjects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          onClick={() => handleLinkProject(team.id)}
                          disabled={!projectDrafts[team.id] || activeAction === `link-project-${team.id}`}
                          className="h-11 rounded-2xl bg-primary px-5 text-xs font-black uppercase tracking-widest text-primary-foreground"
                        >
                          {activeAction === `link-project-${team.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
