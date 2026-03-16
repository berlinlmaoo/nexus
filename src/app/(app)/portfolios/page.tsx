'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FolderKanban, Plus, Pencil, Trash2 } from 'lucide-react'

interface PortfolioProject {
  project: {
    id: string
    name: string
    status: string
    color: string
  }
}

interface Portfolio {
  id: string
  name: string
  description: string | null
  status: string
  owner: { id: string; name: string }
  projects: PortfolioProject[]
  createdAt: string
}

interface Project {
  id: string
  name: string
  color: string
}

const STATUS_COLORS: Record<string, string> = {
  ON_TRACK: 'bg-green-500',
  AT_RISK: 'bg-yellow-500',
  OFF_TRACK: 'bg-red-500',
  COMPLETED: 'bg-blue-500',
}

const STATUS_LABELS: Record<string, string> = {
  ON_TRACK: 'On Track',
  AT_RISK: 'At Risk',
  OFF_TRACK: 'Off Track',
  COMPLETED: 'Completed',
}

export default function PortfoliosPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Portfolio | null>(null)
  const [deleting, setDeleting] = useState<Portfolio | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formStatus, setFormStatus] = useState('ON_TRACK')
  const [formProjectIds, setFormProjectIds] = useState<string[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)

  const fetchPortfolios = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolios')
      const data = await res.json()
      setPortfolios(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    fetchPortfolios()
    fetch('/api/projects')
      .then(res => res.json())
      .then(data => {
        const arr = Array.isArray(data) ? data : []
        setProjects(arr)
        if (arr.length > 0 && arr[0].workspaceId) {
          setWorkspaceId(arr[0].workspaceId)
        }
      })
      .catch(console.error)
  }, [fetchPortfolios])

  function openCreate() {
    setEditing(null)
    setFormName('')
    setFormDescription('')
    setFormStatus('ON_TRACK')
    setFormProjectIds([])
    setDialogOpen(true)
  }

  function openEdit(p: Portfolio) {
    setEditing(p)
    setFormName(p.name)
    setFormDescription(p.description || '')
    setFormStatus(p.status)
    setFormProjectIds(p.projects.map(pp => pp.project.id))
    setDialogOpen(true)
  }

  function openDelete(p: Portfolio) {
    setDeleting(p)
    setDeleteDialogOpen(true)
  }

  async function handleSave() {
    if (!formName.trim()) return

    if (editing) {
      await fetch(`/api/portfolios/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          description: formDescription || null,
          status: formStatus,
          projectIds: formProjectIds,
        }),
      })
    } else {
      if (!workspaceId) return
      await fetch('/api/portfolios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          description: formDescription || null,
          workspaceId,
          projectIds: formProjectIds,
        }),
      })
    }

    setDialogOpen(false)
    fetchPortfolios()
  }

  async function handleDelete() {
    if (!deleting) return
    await fetch(`/api/portfolios/${deleting.id}`, { method: 'DELETE' })
    setDeleteDialogOpen(false)
    setDeleting(null)
    fetchPortfolios()
  }

  function toggleProject(projectId: string) {
    setFormProjectIds(prev =>
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Portfolios</h1>
          <p className="text-muted-foreground mt-1">Manage collections of projects and track their progress</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" />
          New Portfolio
        </Button>
      </div>

      {portfolios.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FolderKanban className="w-12 h-12 text-muted-foreground/60 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground">No portfolios yet</h3>
            <p className="text-muted-foreground/60 mt-1">Create your first portfolio to group and track projects</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {portfolios.map((portfolio) => (
            <Card key={portfolio.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[portfolio.status] || 'bg-gray-400'}`} />
                    <CardTitle className="text-lg">{portfolio.name}</CardTitle>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(portfolio)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => openDelete(portfolio)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                {portfolio.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{portfolio.description}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <span className="font-medium">{STATUS_LABELS[portfolio.status] || portfolio.status}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Projects</span>
                    <span className="font-medium">{portfolio.projects.length}</span>
                  </div>
                  {portfolio.projects.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {portfolio.projects.slice(0, 5).map((pp) => (
                        <span
                          key={pp.project.id}
                          className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded"
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: pp.project.color || '#7B2FBE' }}
                          />
                          {pp.project.name}
                        </span>
                      ))}
                      {portfolio.projects.length > 5 && (
                        <span className="text-xs text-muted-foreground">+{portfolio.projects.length - 5} more</span>
                      )}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground pt-1">
                    Owner: {portfolio.owner.name}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Portfolio' : 'Create Portfolio'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update portfolio details and projects.' : 'Create a new portfolio to group related projects.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Portfolio name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input id="description" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Optional description" />
            </div>
            {editing && (
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ON_TRACK">On Track</SelectItem>
                    <SelectItem value="AT_RISK">At Risk</SelectItem>
                    <SelectItem value="OFF_TRACK">Off Track</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Projects</Label>
              <div className="border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
                {projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No projects available</p>
                ) : (
                  projects.map((project) => (
                    <label key={project.id} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={formProjectIds.includes(project.id)}
                        onChange={() => toggleProject(project.id)}
                        className="rounded"
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: project.color || '#7B2FBE' }}
                      />
                      {project.name}
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!formName.trim()}>
              {editing ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Portfolio</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleting?.name}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
