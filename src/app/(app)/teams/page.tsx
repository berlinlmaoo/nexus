'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { EmptyTeams } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Users, Plus, FolderKanban, UserPlus, LinkIcon, ShieldCheck, Loader2, Trash2, Search, Check, ChevronsUpDown } from 'lucide-react'
import { UserAvatar } from '@/components/ui/user-avatar'
import { ProjectIcon } from '@/components/projects/project-icon'
import { cn } from '@/lib/utils'

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
  workspaceId: string
  canManage: boolean
  isPrimaryTeam?: boolean
  members: TeamMember[]
  projects: TeamProject[]
}

interface MemberOption {
  id: string
  userId: string
  name: string
  email: string
  avatar: string | null
  role: string
  isWorkspaceMember: boolean
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
  const [memberOptionsByTeam, setMemberOptionsByTeam] = useState<Record<string, MemberOption[]>>({})
  const [projectOptionsByTeam, setProjectOptionsByTeam] = useState<Record<string, ProjectOption[]>>({})
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamColor, setNewTeamColor] = useState('#0c1427')
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isCreatingTeam, setIsCreatingTeam] = useState(false)
  const [memberDrafts, setMemberDrafts] = useState<Record<string, string[]>>({})
  const [projectDrafts, setProjectDrafts] = useState<Record<string, string>>({})
  const [memberSearchByTeam, setMemberSearchByTeam] = useState<Record<string, string>>({})
  const [projectSearchByTeam, setProjectSearchByTeam] = useState<Record<string, string>>({})
  const [memberPickerOpenByTeam, setMemberPickerOpenByTeam] = useState<Record<string, boolean>>({})
  const [projectPickerOpenByTeam, setProjectPickerOpenByTeam] = useState<Record<string, boolean>>({})
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [pendingMemberRemoval, setPendingMemberRemoval] = useState<{
    teamId: string
    userId: string
    memberName: string
  } | null>(null)
  const [pendingProjectUnlink, setPendingProjectUnlink] = useState<{
    teamId: string
    projectId: string
    projectName: string
  } | null>(null)
  const [pendingTeamDelete, setPendingTeamDelete] = useState<{
    teamId: string
    teamName: string
  } | null>(null)
  const canCreateTeams = teams.some((team) => team.canManage)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const teamsRes = await fetch('/api/teams', { cache: 'no-store' })
      const teamsData = teamsRes.ok ? await teamsRes.json() : []
      const normalizedTeams = Array.isArray(teamsData) ? teamsData : []

      const teamPayloads = await Promise.all(
        normalizedTeams.map(async (team) => {
          const teamQuery = `&teamId=${team.id}`

          const [membersRes, projectsRes] = await Promise.all([
            fetch(`/api/workspaces/members?workspaceId=${team.workspaceId}&includeRegistered=1${teamQuery}`, { cache: 'no-store' }),
            fetch(`/api/projects?workspaceId=${team.workspaceId}&includeAllWorkspace=1${teamQuery}`, { cache: 'no-store' }),
          ])

          const membersData = membersRes.ok ? await membersRes.json() : { members: [], availableUsers: [] }
          const projectsData = projectsRes.ok ? await projectsRes.json() : []

          const members = Array.isArray(membersData?.members)
            ? membersData.members.map((member: Omit<MemberOption, 'isWorkspaceMember'>) => ({
                ...member,
                isWorkspaceMember: true,
              }))
            : []

          const availableUsers = Array.isArray(membersData?.availableUsers)
            ? membersData.availableUsers.map((candidate: { id: string; name: string; email: string; avatar: string | null }) => ({
                id: candidate.id,
                userId: candidate.id,
                name: candidate.name,
                email: candidate.email,
                avatar: candidate.avatar,
                role: 'REGISTERED',
                isWorkspaceMember: false,
              }))
            : []

          const dedupedMembers = Array.from(
            new Map([...members, ...availableUsers].map((member) => [member.userId, member])).values()
          )

          return {
            teamId: team.id,
            members: dedupedMembers,
            projects: Array.isArray(projectsData) ? projectsData : [],
          }
        })
      )

      const nextMembersByTeam: Record<string, MemberOption[]> = {}
      const nextProjectsByTeam: Record<string, ProjectOption[]> = {}

      for (const payload of teamPayloads) {
        nextMembersByTeam[payload.teamId] = payload.members
        nextProjectsByTeam[payload.teamId] = payload.projects
      }

      setTeams(normalizedTeams)
      setMemberOptionsByTeam(nextMembersByTeam)
      setProjectOptionsByTeam(nextProjectsByTeam)
    } catch (error) {
      console.error('Failed to fetch team data:', error)
      setTeams([])
      setMemberOptionsByTeam({})
      setProjectOptionsByTeam({})
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
        toast.success('Team created')
        setNewTeamName('')
        setIsOpen(false)
        await fetchData()
      } else {
        const data = await res.json().catch(() => null)
        toast.error(data?.error || 'Failed to create team')
      }
    } catch (error) {
      console.error('Failed to create team:', error)
      toast.error('Failed to create team')
    } finally {
      setIsCreatingTeam(false)
    }
  }

  const runTeamAction = async (
    actionKey: string,
    body: Record<string, string | string[]>,
    successMessage: string
  ) => {
    setActiveAction(actionKey)
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        await fetchData()
        toast.success(successMessage)
        return true
      }
      const data = await res.json().catch(() => null)
      toast.error(data?.error || 'Team action failed')
    } catch (error) {
      console.error('Failed team action:', error)
      toast.error('Team action failed')
    } finally {
      setActiveAction(null)
    }
    return false
  }

  const handleAddMember = async (teamId: string) => {
    const userIds = memberDrafts[teamId] || []
    if (userIds.length === 0) return
    const didAdd = await runTeamAction(`add-member-${teamId}`, {
      action: 'add-member',
      teamId,
      userIds,
    }, userIds.length === 1 ? 'Member added to team' : `${userIds.length} members added to team`)
    if (didAdd) {
      setMemberDrafts((prev) => ({ ...prev, [teamId]: [] }))
    }
  }

  const confirmRemoveMember = async () => {
    if (!pendingMemberRemoval) return

    const { teamId, userId } = pendingMemberRemoval
    const didRemove = await runTeamAction(`remove-member-${teamId}-${userId}`, {
      action: 'remove-member',
      teamId,
      userId,
    }, 'Member removed from team')

    if (didRemove) {
      setPendingMemberRemoval(null)
    }
  }

  const handleLinkProject = async (teamId: string) => {
    const projectId = projectDrafts[teamId]
    if (!projectId) return
    const didLink = await runTeamAction(`link-project-${teamId}`, {
      action: 'link-project',
      teamId,
      projectId,
    }, 'Project linked to team')
    if (didLink) {
      setProjectDrafts((prev) => ({ ...prev, [teamId]: '' }))
    }
  }

  const confirmUnlinkProject = async () => {
    if (!pendingProjectUnlink) return

    const { teamId, projectId } = pendingProjectUnlink
    const didUnlink = await runTeamAction(`unlink-project-${teamId}-${projectId}`, {
      action: 'unlink-project',
      teamId,
      projectId,
    }, 'Project unlinked from team')

    if (didUnlink) {
      setPendingProjectUnlink(null)
    }
  }

  const confirmDeleteTeam = async () => {
    if (!pendingTeamDelete) return

    const { teamId } = pendingTeamDelete
    const didDelete = await runTeamAction(`delete-team-${teamId}`, {
      action: 'delete-team',
      teamId,
    }, 'Team deleted')

    if (didDelete) {
      setPendingTeamDelete(null)
    }
  }

  const getSearchScore = useCallback((target: string, query: string) => {
    if (!query) return 3
    if (target === query) return 0
    if (target.startsWith(query)) return 1
    if (target.includes(query)) return 2
    return 99
  }, [])

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

        {canCreateTeams && (
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
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary/30" />
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-[2rem] border border-on-surface-variant/5 bg-surface-container-lowest p-5 sm:rounded-[2.5rem] sm:p-8">
          <EmptyTeams onAdd={canCreateTeams ? () => setIsOpen(true) : undefined} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-8 xl:grid-cols-2">
          {teams.map((team) => {
            const workspaceMembers = memberOptionsByTeam[team.id] || []
            const workspaceProjects = projectOptionsByTeam[team.id] || []

            const availableMembers = workspaceMembers.filter(
              (member) => !team.members.some((teamMember) => teamMember.user.id === member.userId)
            )
            const availableProjects = workspaceProjects.filter(
              (project) => !team.projects.some((teamProject) => teamProject.project.id === project.id)
            )
            const memberQuery = (memberSearchByTeam[team.id] || '').trim().toLowerCase()
            const projectQuery = (projectSearchByTeam[team.id] || '').trim().toLowerCase()
            const filteredMembers = [...availableMembers]
              .map((member, index) => {
                const name = member.name.toLowerCase()
                const email = member.email.toLowerCase()
                const score = Math.min(getSearchScore(name, memberQuery), getSearchScore(email, memberQuery))
                return { member, index, score }
              })
              .filter(({ score }) => score < 99)
              .sort((a, b) => {
                if (a.score !== b.score) return a.score - b.score
                return a.index - b.index
              })
              .map(({ member }) => member)
            const filteredProjects = [...availableProjects]
              .map((project, index) => ({
                project,
                index,
                score: getSearchScore(project.name.toLowerCase(), projectQuery),
              }))
              .filter(({ score }) => score < 99)
              .sort((a, b) => {
                if (a.score !== b.score) return a.score - b.score
                return a.index - b.index
              })
              .map(({ project }) => project)
            const selectedMemberIds = memberDrafts[team.id] || []
            const selectedMembers = availableMembers.filter((member) => selectedMemberIds.includes(member.userId))
            const selectedProject = availableProjects.find((project) => project.id === projectDrafts[team.id])

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
                        {!team.canManage && (
                          <>
                            <span className="h-1 w-1 rounded-full bg-on-surface-variant/20" />
                            <span>Read only</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {team.canManage && !team.isPrimaryTeam && (
                    <button
                      onClick={() => setPendingTeamDelete({
                        teamId: team.id,
                        teamName: team.name,
                      })}
                      disabled={activeAction === `delete-team-${team.id}`}
                      className="inline-flex items-center gap-2 self-start rounded-2xl border border-red-200/60 bg-red-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
                      title="Delete team"
                    >
                      {activeAction === `delete-team-${team.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Delete team
                    </button>
                  )}
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
                              {team.canManage && !team.isPrimaryTeam && (
                                <button
                                  onClick={() => setPendingMemberRemoval({
                                    teamId: team.id,
                                    userId: member.user.id,
                                    memberName: member.user.name,
                                  })}
                                  disabled={activeAction === `remove-member-${team.id}-${member.user.id}`}
                                  className="rounded-xl p-2 text-on-surface-variant/30 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                                  title="Remove member"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
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
                      {!team.canManage && (
                        <p className="rounded-2xl border border-dashed border-on-surface-variant/10 px-4 py-3 text-xs text-on-surface-variant/40">
                          You can only add members to teams you manage.
                        </p>
                      )}
                      {team.canManage && (
                        <p className="text-xs text-on-surface-variant/45">
                          {team.isPrimaryTeam
                            ? 'Semua user wajib menjadi member team inti PATS Group.'
                            : availableMembers.length > 0
                            ? `${availableMembers.length} user siap ditambahkan ke team ini.`
                            : 'Belum ada user lain yang bisa ditambahkan ke team ini.'}
                        </p>
                      )}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <Popover
                          open={Boolean(memberPickerOpenByTeam[team.id])}
                          onOpenChange={(open) => {
                            setMemberPickerOpenByTeam((prev) => ({ ...prev, [team.id]: open }))
                            if (!open) {
                              setMemberSearchByTeam((prev) => ({ ...prev, [team.id]: '' }))
                            }
                          }}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              disabled={!team.canManage || availableMembers.length === 0}
                              className="flex h-11 min-w-0 items-center justify-between rounded-2xl bg-surface-container-lowest px-4 text-sm font-medium text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <span className="truncate text-left">
                                {selectedMembers.length > 0
                                  ? selectedMembers.length === 1
                                    ? `${selectedMembers[0].name} (${selectedMembers[0].email})`
                                    : `${selectedMembers.length} members selected`
                                  : availableMembers.length > 0
                                  ? 'Select member...'
                                  : 'No users available'}
                              </span>
                              <ChevronsUpDown className="ml-3 h-4 w-4 shrink-0 text-on-surface-variant/35" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-[360px] rounded-2xl border-none p-2 shadow-2xl">
                            <div className="space-y-2">
                              <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/35" />
                                <Input
                                  value={memberSearchByTeam[team.id] || ''}
                                  onChange={(e) => setMemberSearchByTeam((prev) => ({ ...prev, [team.id]: e.target.value }))}
                                  placeholder="Search member..."
                                  className="h-10 rounded-xl border-on-surface-variant/10 bg-surface-container-low pl-9 text-sm font-medium"
                                />
                              </div>
                              <div className="max-h-64 space-y-1 overflow-y-auto">
                                {filteredMembers.map((member) => (
                                  <button
                                    key={member.userId}
                                    type="button"
                                    onClick={() => {
                                      setMemberDrafts((prev) => {
                                        const current = prev[team.id] || []
                                        const next = current.includes(member.userId)
                                          ? current.filter((id) => id !== member.userId)
                                          : [...current, member.userId]
                                        return { ...prev, [team.id]: next }
                                      })
                                    }}
                                    className={cn(
                                      'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                                      selectedMemberIds.includes(member.userId)
                                        ? 'bg-primary/5 text-primary'
                                        : 'hover:bg-surface-container-low'
                                    )}
                                  >
                                    <UserAvatar user={{ name: member.name, avatar: member.avatar }} size="xs" />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-bold">{member.name}</p>
                                      <p className="truncate text-xs text-on-surface-variant/50">
                                        {member.email}
                                        {!member.isWorkspaceMember ? ' • join workspace + team' : ''}
                                      </p>
                                    </div>
                                    {selectedMemberIds.includes(member.userId) && <Check className="h-4 w-4" />}
                                  </button>
                                ))}
                                {filteredMembers.length === 0 && (
                                  <p className="px-3 py-6 text-center text-xs text-on-surface-variant/40">
                                    No members match your search.
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center justify-between gap-2 border-t border-on-surface-variant/5 px-1 pt-2">
                                <p className="text-[11px] font-medium text-on-surface-variant/45">
                                  {selectedMemberIds.length} selected
                                </p>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 rounded-xl px-3 text-[11px] font-bold"
                                    onClick={() => setMemberDrafts((prev) => ({ ...prev, [team.id]: [] }))}
                                  >
                                    Clear
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-8 rounded-xl px-3 text-[11px] font-bold"
                                    onClick={() => {
                                      setMemberPickerOpenByTeam((prev) => ({ ...prev, [team.id]: false }))
                                      setMemberSearchByTeam((prev) => ({ ...prev, [team.id]: '' }))
                                    }}
                                  >
                                    Done
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                        <Button
                          onClick={() => handleAddMember(team.id)}
                          disabled={!team.canManage || availableMembers.length === 0 || selectedMemberIds.length === 0 || activeAction === `add-member-${team.id}`}
                          className="h-11 rounded-2xl bg-primary px-5 text-xs font-black uppercase tracking-widest text-primary-foreground sm:min-w-[120px]"
                        >
                          {activeAction === `add-member-${team.id}`
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : selectedMemberIds.length > 1
                            ? `Add ${selectedMemberIds.length}`
                            : 'Add'}
                        </Button>
                      </div>
                      {selectedMembers.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {selectedMembers.map((member) => (
                            <span
                              key={member.userId}
                              className="inline-flex items-center gap-2 rounded-full bg-surface-container px-3 py-1 text-[11px] font-bold text-on-surface"
                            >
                              {member.name}
                              <button
                                type="button"
                                onClick={() => setMemberDrafts((prev) => ({
                                  ...prev,
                                  [team.id]: (prev[team.id] || []).filter((id) => id !== member.userId),
                                }))}
                                className="text-on-surface-variant/45 transition-colors hover:text-red-600"
                                aria-label={`Remove ${member.name}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
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
                            {team.canManage && (
                              <button
                                onClick={() => setPendingProjectUnlink({
                                  teamId: team.id,
                                  projectId: teamProject.project.id,
                                  projectName: teamProject.project.name,
                                })}
                                disabled={activeAction === `unlink-project-${team.id}-${teamProject.project.id}`}
                                className="self-end rounded-xl p-2 text-on-surface-variant/30 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 sm:self-auto"
                                title="Unlink project"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
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
                      {!team.canManage && (
                        <p className="rounded-2xl border border-dashed border-on-surface-variant/10 px-4 py-3 text-xs text-on-surface-variant/40">
                          You can only link projects on teams you manage.
                        </p>
                      )}
                      {team.canManage && (
                        <p className="text-xs text-on-surface-variant/45">
                          {availableProjects.length > 0
                            ? `${availableProjects.length} project bisa di-link ke team ini.`
                            : 'Semua project workspace ini sudah terhubung ke team ini.'}
                        </p>
                      )}
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <Popover
                          open={Boolean(projectPickerOpenByTeam[team.id])}
                          onOpenChange={(open) => {
                            setProjectPickerOpenByTeam((prev) => ({ ...prev, [team.id]: open }))
                            if (!open) {
                              setProjectSearchByTeam((prev) => ({ ...prev, [team.id]: '' }))
                            }
                          }}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              disabled={!team.canManage || availableProjects.length === 0}
                              className="flex h-11 flex-1 items-center justify-between rounded-2xl bg-surface-container-lowest px-4 text-sm font-medium text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <span className="truncate text-left">
                                {selectedProject
                                  ? selectedProject.name
                                  : availableProjects.length > 0
                                  ? 'Select project...'
                                  : 'No projects available'}
                              </span>
                              <ChevronsUpDown className="ml-3 h-4 w-4 shrink-0 text-on-surface-variant/35" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-[360px] rounded-2xl border-none p-2 shadow-2xl">
                            <div className="space-y-2">
                              <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/35" />
                                <Input
                                  value={projectSearchByTeam[team.id] || ''}
                                  onChange={(e) => setProjectSearchByTeam((prev) => ({ ...prev, [team.id]: e.target.value }))}
                                  placeholder="Search project..."
                                  className="h-10 rounded-xl border-on-surface-variant/10 bg-surface-container-low pl-9 text-sm font-medium"
                                />
                              </div>
                              <div className="max-h-64 space-y-1 overflow-y-auto">
                                {filteredProjects.map((project) => (
                                  <button
                                    key={project.id}
                                    type="button"
                                    onClick={() => {
                                      setProjectDrafts((prev) => ({ ...prev, [team.id]: project.id }))
                                      setProjectPickerOpenByTeam((prev) => ({ ...prev, [team.id]: false }))
                                      setProjectSearchByTeam((prev) => ({ ...prev, [team.id]: '' }))
                                    }}
                                    className={cn(
                                      'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                                      projectDrafts[team.id] === project.id
                                        ? 'bg-primary/5 text-primary'
                                        : 'hover:bg-surface-container-low'
                                    )}
                                  >
                                    <ProjectIcon icon={project.icon} color={project.color} size="sm" variant="lucide" />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-bold">{project.name}</p>
                                      <p className="truncate text-xs text-on-surface-variant/50">{project.status}</p>
                                    </div>
                                    {projectDrafts[team.id] === project.id && <Check className="h-4 w-4" />}
                                  </button>
                                ))}
                                {filteredProjects.length === 0 && (
                                  <p className="px-3 py-6 text-center text-xs text-on-surface-variant/40">
                                    No projects match your search.
                                  </p>
                                )}
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                        <Button
                          onClick={() => handleLinkProject(team.id)}
                          disabled={!team.canManage || availableProjects.length === 0 || !projectDrafts[team.id] || activeAction === `link-project-${team.id}`}
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

      <ConfirmDialog
        open={Boolean(pendingMemberRemoval)}
        onOpenChange={(open) => {
          if (!open) setPendingMemberRemoval(null)
        }}
        title="Remove member from team?"
        description={pendingMemberRemoval
          ? `${pendingMemberRemoval.memberName} will lose access to this team and any team-only project access that came from it.`
          : 'Remove this member from the selected team.'}
        confirmLabel="Remove member"
        icon={<Trash2 className="h-5 w-5" />}
        isLoading={Boolean(
          pendingMemberRemoval &&
          activeAction === `remove-member-${pendingMemberRemoval.teamId}-${pendingMemberRemoval.userId}`
        )}
        onConfirm={confirmRemoveMember}
      />

      <ConfirmDialog
        open={Boolean(pendingProjectUnlink)}
        onOpenChange={(open) => {
          if (!open) setPendingProjectUnlink(null)
        }}
        title="Unlink project from team?"
        description={pendingProjectUnlink
          ? `${pendingProjectUnlink.projectName} will stop being shared through this team. Members may lose access if this is their only project link.`
          : 'Unlink this project from the selected team.'}
        confirmLabel="Unlink project"
        icon={<Trash2 className="h-5 w-5" />}
        isLoading={Boolean(
          pendingProjectUnlink &&
          activeAction === `unlink-project-${pendingProjectUnlink.teamId}-${pendingProjectUnlink.projectId}`
        )}
        onConfirm={confirmUnlinkProject}
      />

      <ConfirmDialog
        open={Boolean(pendingTeamDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingTeamDelete(null)
        }}
        title="Delete team?"
        description={pendingTeamDelete
          ? `${pendingTeamDelete.teamName} will be deleted. Team-linked project sharing from this team will be removed before deletion.`
          : 'Delete this team.'}
        confirmLabel="Delete team"
        icon={<Trash2 className="h-5 w-5" />}
        isLoading={Boolean(
          pendingTeamDelete &&
          activeAction === `delete-team-${pendingTeamDelete.teamId}`
        )}
        onConfirm={confirmDeleteTeam}
      />
    </div>
  )
}
