"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2, AlertCircle, ArrowLeft, ArrowRight, Upload } from "lucide-react"
import { cn } from "@/lib/utils"

type Source = "asana" | "notion" | null
type Step = 1 | 2 | 3 | 4

interface ImportJob {
  id: string
  status: string
  progress: number
  total: number
  details?: { imported?: number; errors?: string[] }
}

export function ImportWizard() {
  const [source, setSource] = useState<Source>(null)
  const [step, setStep] = useState<Step>(1)

  // Asana fields
  const [asanaToken, setAsanaToken] = useState("")
  const [asanaWorkspace, setAsanaWorkspace] = useState("")

  // Notion fields
  const [notionToken, setNotionToken] = useState("")
  const [notionDatabases, setNotionDatabases] = useState("")

  const [importing, setImporting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Poll for import status
  useEffect(() => {
    if (!jobId) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/import/status?jobId=${jobId}`)
        if (res.ok) {
          const data = await res.json()
          setJob(data)
          if (data.status === "completed" || data.status === "failed") {
            setImporting(false)
            clearInterval(interval)
          }
        }
      } catch {
        // ignore poll errors
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [jobId])

  const handleStartImport = async () => {
    setError(null)
    setImporting(true)

    try {
      let res: Response

      if (source === "asana") {
        res = await fetch("/api/import/asana", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personalAccessToken: asanaToken,
            workspaceGid: asanaWorkspace,
          }),
        })
      } else {
        const dbIds = notionDatabases
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        res = await fetch("/api/import/notion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            integrationToken: notionToken,
            databaseIds: dbIds,
          }),
        })
      }

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Import failed")
      }

      const data = await res.json()
      setJobId(data.jobId)
      setStep(4)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed")
      setImporting(false)
    }
  }

  const reset = () => {
    setSource(null)
    setStep(1)
    setAsanaToken("")
    setAsanaWorkspace("")
    setNotionToken("")
    setNotionDatabases("")
    setJobId(null)
    setJob(null)
    setError(null)
    setImporting(false)
  }

  const canProceed = () => {
    if (step === 1) return !!source
    if (step === 2) {
      if (source === "asana") return !!asanaToken && !!asanaWorkspace
      return !!notionToken && !!notionDatabases
    }
    return true
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Import from External Tools
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Step indicators */}
        <div className="flex items-center gap-2 text-sm">
          {[
            { n: 1, label: "Source" },
            { n: 2, label: "Credentials" },
            { n: 3, label: "Confirm" },
            { n: 4, label: "Import" },
          ].map(({ n, label }) => (
            <div key={n} className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                  step >= n
                    ? "bg-foreground text-white"
                    : "bg-surface-container text-muted-foreground"
                )}
              >
                {n}
              </div>
              <span className={step >= n ? "font-medium" : "text-muted-foreground"}>
                {label}
              </span>
              {n < 4 && <div className="h-px w-6 bg-surface-container-high" />}
            </div>
          ))}
        </div>

        {/* Step 1: Select source */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Select the platform you want to import from:
            </p>
            <div className="flex gap-3">
              {(["asana", "notion"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSource(s)}
                  className={cn(
                    "flex h-20 w-32 flex-col items-center justify-center gap-1.5 rounded-lg border-2 text-sm font-medium transition-all",
                    source === s
                      ? "border-on-surface-variant bg-surface-container-lowest"
                      : "border-transparent bg-muted hover:border-on-surface-variant"
                  )}
                >
                  <span className="text-lg font-bold capitalize">{s}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Credentials */}
        {step === 2 && source === "asana" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="asana-token">Personal Access Token</Label>
              <Input
                id="asana-token"
                type="password"
                value={asanaToken}
                onChange={(e) => setAsanaToken(e.target.value)}
                placeholder="Enter your Asana personal access token"
              />
              <p className="text-xs text-muted-foreground">
                Get from Asana Developer Console &gt; Personal Access Tokens
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="asana-workspace">Workspace GID</Label>
              <Input
                id="asana-workspace"
                value={asanaWorkspace}
                onChange={(e) => setAsanaWorkspace(e.target.value)}
                placeholder="e.g. 1234567890"
              />
            </div>
          </div>
        )}

        {step === 2 && source === "notion" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="notion-token">Integration Token</Label>
              <Input
                id="notion-token"
                type="password"
                value={notionToken}
                onChange={(e) => setNotionToken(e.target.value)}
                placeholder="Enter your Notion integration token"
              />
              <p className="text-xs text-muted-foreground">
                Create an integration at notion.so/my-integrations
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notion-dbs">Database IDs</Label>
              <Input
                id="notion-dbs"
                value={notionDatabases}
                onChange={(e) => setNotionDatabases(e.target.value)}
                placeholder="Comma-separated database IDs"
              />
              <p className="text-xs text-muted-foreground">
                Found in the database URL after the workspace name
              </p>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Ready to import</p>
            <div className="rounded-lg bg-surface-container-lowest p-4 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Source:</span>{" "}
                <span className="font-medium capitalize">{source}</span>
              </p>
              {source === "asana" && (
                <p>
                  <span className="text-muted-foreground">Workspace:</span>{" "}
                  {asanaWorkspace}
                </p>
              )}
              {source === "notion" && (
                <p>
                  <span className="text-muted-foreground">Databases:</span>{" "}
                  {notionDatabases.split(",").length} database(s)
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              This will create new projects and tasks in your workspace. Existing data will not be affected.
            </p>
          </div>
        )}

        {/* Step 4: Import progress */}
        {step === 4 && (
          <div className="space-y-4">
            {importing && !job && (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting import...
              </div>
            )}
            {job && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {job.status === "running" && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {job.status === "completed" && (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  )}
                  {job.status === "failed" && (
                    <AlertCircle className="h-4 w-4 text-red-600" />
                  )}
                  <span className="text-sm font-medium capitalize">
                    {job.status}
                  </span>
                </div>

                {/* Progress bar */}
                {job.total > 0 && (
                  <div className="space-y-1">
                    <div className="h-2 rounded-full bg-surface-container overflow-hidden">
                      <div
                        className="h-full bg-foreground rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.round((job.progress / job.total) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {job.progress} / {job.total} projects
                    </p>
                  </div>
                )}

                {/* Errors */}
                {job.details?.errors && job.details.errors.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-3 text-sm">
                    <p className="font-medium text-red-700 dark:text-red-400">
                      {job.details.errors.length} error(s):
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-red-600 dark:text-red-300">
                      {job.details.errors.slice(0, 5).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(job.status === "completed" || job.status === "failed") && (
                  <Button variant="outline" size="sm" onClick={reset}>
                    Import Again
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        {/* Navigation */}
        {step < 4 && (
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep((step - 1) as Step)}
              >
                <ArrowLeft className="h-3 w-3 mr-1" />
                Back
              </Button>
            )}
            {step < 3 && (
              <Button
                size="sm"
                className="bg-foreground text-background hover:bg-foreground/90"
                disabled={!canProceed()}
                onClick={() => setStep((step + 1) as Step)}
              >
                Next
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
            {step === 3 && (
              <Button
                size="sm"
                className="bg-foreground text-background hover:bg-foreground/90"
                disabled={importing}
                onClick={handleStartImport}
              >
                {importing ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-3 w-3 mr-1" />
                    Start Import
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
