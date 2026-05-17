"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Shield,
  Search,
  Download,
  ChevronDown,
  ChevronRight,
  Filter,
  ArrowLeft,
  ArrowRight,
} from "lucide-react"

interface AuditLogEntry {
  id: string
  action: string
  entityType: string
  entityId: string | null
  entityName: string | null
  userId: string
  user: {
    id: string
    name: string
    email: string
    avatar: string | null
  }
  metadata: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

interface AuditLogResponse {
  logs: AuditLogEntry[]
  total: number
  limit: number
  offset: number
}

const ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  login: "Logged in",
  logout: "Logged out",
  export: "Exported",
  invite: "Invited",
  import: "Imported",
}

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-500/10 text-green-600 dark:text-green-400",
  update: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  delete: "bg-red-500/10 text-red-600 dark:text-red-400",
  login: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  logout: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  export: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  invite: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  import: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
}

const ENTITY_TYPES = ["task", "project", "doc", "user", "comment", "webhook", "settings", "sprint"]
const ACTIONS = ["create", "update", "delete", "login", "logout", "export", "invite", "import"]

export function AuditLogViewer() {
  const [data, setData] = useState<AuditLogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [actionFilter, setActionFilter] = useState("")
  const [entityFilter, setEntityFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [page, setPage] = useState(0)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const limit = 20

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set("search", search)
      if (actionFilter) params.set("action", actionFilter)
      if (entityFilter) params.set("entityType", entityFilter)
      if (dateFrom) params.set("from", dateFrom)
      if (dateTo) params.set("to", dateTo)
      params.set("limit", limit.toString())
      params.set("offset", (page * limit).toString())

      const res = await fetch(`/api/audit?${params.toString()}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (error) {
      console.error("Failed to fetch audit logs:", error)
    } finally {
      setLoading(false)
    }
  }, [search, actionFilter, entityFilter, dateFrom, dateTo, page])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const toggleRow = (id: string) => {
    const next = new Set(expandedRows)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedRows(next)
  }

  const exportCSV = () => {
    if (!data?.logs.length) return

    const headers = ["Timestamp", "User", "Action", "Entity Type", "Entity Name", "IP Address"]
    const rows = data.logs.map((log) => [
      new Date(log.createdAt).toISOString(),
      log.user.name,
      log.action,
      log.entityType,
      log.entityName || "",
      log.ipAddress || "",
    ])

    const csv = [headers, ...rows].map((row) => row.map((c) => `"${c}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `audit-log-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalPages = data ? Math.ceil(data.total / limit) : 0

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const initials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Audit Log
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4 mr-1" />
              Filters
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={!data?.logs.length}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search audit logs..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="pl-9"
          />
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Action</label>
              <select
                value={actionFilter}
                onChange={(e) => { setActionFilter(e.target.value); setPage(0) }}
                className="w-full px-2 py-1.5 text-sm rounded-md border bg-background"
              >
                <option value="">All actions</option>
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Entity</label>
              <select
                value={entityFilter}
                onChange={(e) => { setEntityFilter(e.target.value); setPage(0) }}
                className="w-full px-2 py-1.5 text-sm rounded-md border bg-background"
              >
                <option value="">All entities</option>
                {ENTITY_TYPES.map((e) => (
                  <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(0) }}
                className="w-full px-2 py-1.5 text-sm rounded-md border bg-background"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(0) }}
                className="w-full px-2 py-1.5 text-sm rounded-md border bg-background"
              />
            </div>
          </div>
        )}

        {/* Table */}
        <div className="mobile-horizontal-scroll overflow-x-auto rounded-lg border">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50 dark:bg-zinc-900/50">
                <th className="w-8 px-3 py-2" />
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Timestamp</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">User</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Action</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Entity</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</td>
                </tr>
              ) : !data?.logs.length ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-muted-foreground">No audit logs found</td>
                </tr>
              ) : (
                data.logs.map((log) => (
                  <>
                    <tr
                      key={log.id}
                      className="border-b hover:bg-zinc-50 dark:hover:bg-zinc-900/30 cursor-pointer"
                      onClick={() => log.metadata && toggleRow(log.id)}
                    >
                      <td className="px-3 py-2">
                        {log.metadata ? (
                          expandedRows.has(log.id) ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatDate(log.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            {log.user.avatar && <AvatarImage src={log.user.avatar} alt={log.user.name} />}
                            <AvatarFallback className="text-[10px] bg-zinc-200 dark:bg-zinc-700">
                              {initials(log.user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate max-w-[120px]">{log.user.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[log.action] || "bg-muted text-muted-foreground"}`}>
                          {ACTION_LABELS[log.action] || log.action}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-muted-foreground capitalize">{log.entityType}</span>
                      </td>
                      <td className="px-3 py-2 truncate max-w-[200px]">
                        {log.entityName || "—"}
                      </td>
                    </tr>
                    {expandedRows.has(log.id) && log.metadata && (
                      <tr key={`${log.id}-detail`} className="border-b bg-zinc-50/50 dark:bg-zinc-900/20">
                        <td colSpan={6} className="px-6 py-3">
                          <div className="text-xs space-y-2">
                            <p className="font-medium text-muted-foreground">Metadata</p>
                            <pre className="bg-zinc-100 dark:bg-zinc-800 p-3 rounded-md overflow-x-auto text-xs">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                            {log.ipAddress && (
                              <p className="text-muted-foreground">IP: {log.ipAddress}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {page * limit + 1}–{Math.min((page + 1) * limit, data?.total || 0)} of {data?.total || 0}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
