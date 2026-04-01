'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Users, Plus, UserCircle, FolderKanban, X, Search, UserPlus, LinkIcon, ChevronRight, LayoutGrid, ShieldCheck, Zap, Loader2 } from 'lucide-react'
import { UserAvatar } from '@/components/ui/user-avatar'
import { cn } from '@/lib/utils'

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

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamColor, setNewTeamColor] = useState('#0c1427')
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

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
        setIsOpen(false)
        fetchTeams()
      }
    } catch (error) {
      console.error('Failed to create team:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-12 animate-fade-in pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="space-y-2">
          <h1 className="text-5xl font-headline font-black tracking-tighter text-primary">
            Organizational Units
          </h1>
          <p className="text-on-surface-variant/60 font-medium text-lg flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-primary" />
            Managing {teams.length} strategic divisions
          </p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground rounded-2xl h-14 px-8 font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-primary/20 transition-all hover:-translate-y-1 active:scale-95">
              <Plus className="w-4 h-4 mr-3" />
              Establish Team
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md rounded-[2.5rem] border-none shadow-2xl p-8">
            <DialogHeader>
              <DialogTitle className="text-2xl font-headline font-black text-primary">Unit Protocol</DialogTitle>
            </DialogHeader>
            <div className="space-y-6 pt-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 ml-1">Unit Designation</label>
                <input
                  placeholder="e.g. Tactical Response"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  className="w-full h-12 bg-surface-container-low border-none rounded-2xl px-4 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 focus:ring-2 focus:ring-primary/5 transition-all"
                />
              </div>
              <Button onClick={createTeam} disabled={isLoading} className="w-full h-14 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-widest">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Authorize Unit"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {teams.map((team) => (
          <div 
            key={team.id}
            className="bg-surface-container-lowest p-8 rounded-[2.5rem] shadow-sm border border-on-surface-variant/5 transition-all duration-500 hover:shadow-2xl hover:shadow-primary/5 group"
          >
            <div className="flex items-start justify-between mb-8">
              <div className="flex items-center gap-4">
                <div 
                  className="h-16 w-16 rounded-[1.5rem] flex items-center justify-center text-primary-foreground text-xl font-black shadow-lg"
                  style={{ backgroundColor: team.color }}
                >
                  {team.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-2xl font-headline font-black text-primary tracking-tight">{team.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <ShieldCheck className="h-3 w-3 text-on-surface-variant/40" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">{team.members.length} Personnel Assigned</span>
                  </div>
                </div>
              </div>
              <button className="p-3 rounded-2xl bg-surface-container-low text-on-surface-variant/40 hover:text-primary hover:bg-surface-container transition-all">
                <LayoutGrid className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface-container-low/40 p-6 rounded-[1.5rem] space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30 flex items-center gap-2">
                  <Users className="h-3 w-3" /> Core Operatives
                </p>
                <div className="flex -space-x-2.5">
                  {team.members.slice(0, 5).map((m, i) => (
                    <UserAvatar key={i} user={{ name: m.user.name, image: m.user.avatar }} size="sm" className="ring-2 ring-surface-container-lowest shadow-sm" />
                  ))}
                  {team.members.length > 5 && (
                    <div className="h-8 w-8 rounded-full bg-surface-container flex items-center justify-center text-[10px] font-black text-on-surface-variant/60 border-2 border-surface-container-lowest">
                      +{team.members.length - 5}
                    </div>
                  )}
                  <button className="h-8 w-8 rounded-full bg-primary/5 flex items-center justify-center text-primary hover:bg-primary hover:text-primary-foreground transition-all ml-4">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="bg-surface-container-low/40 p-6 rounded-[1.5rem] space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30 flex items-center gap-2">
                  <FolderKanban className="h-3 w-3" /> Designated Nodes
                </p>
                <div className="flex items-center gap-2">
                  {team.projects.slice(0, 3).map((p, i) => (
                    <div key={i} className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm" style={{ backgroundColor: `${p.project.color}20` }}>
                      <Zap className="h-4 w-4" style={{ color: p.project.color }} />
                    </div>
                  ))}
                  <button className="h-8 w-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant/40 hover:text-primary transition-all">
                    <LinkIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
