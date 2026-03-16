"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import { FileText, Loader2, Download } from "lucide-react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import type { FormField } from "./form-builder"

interface Submission {
  id: string
  data: Record<string, any>
  createdAt: string
  submitterId: string | null
}

interface FormSubmissionsProps {
  formId: string
  fields: FormField[]
}

export function FormSubmissions({ formId, fields }: FormSubmissionsProps) {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchSubmissions() {
      try {
        setLoading(true)
        const res = await fetch(`/api/forms/${formId}`)
        if (!res.ok) throw new Error("Failed to fetch submissions")
        const form = await res.json()
        setSubmissions(form.submissions ?? [])
      } catch (err: any) {
        setError(err.message ?? "Something went wrong")
      } finally {
        setLoading(false)
      }
    }

    fetchSubmissions()
  }, [formId])

  if (loading) {
    return <SubmissionsSkeleton fieldCount={fields.length} />
  }

  if (error) {
    return (
      <div className="rounded-lg border border-zinc-200 p-6 text-center">
        <p className="text-sm text-zinc-500">{error}</p>
      </div>
    )
  }

  if (submissions.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center justify-center rounded-lg border border-zinc-200 py-16"
      >
        <FileText className="h-10 w-10 text-zinc-300" />
        <p className="mt-3 text-sm font-medium text-zinc-500">
          No submissions yet
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          Submissions will appear here once the form is filled out.
        </p>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          {submissions.length} submission{submissions.length !== 1 ? "s" : ""}
        </p>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
            "border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
          )}
          onClick={() => downloadCsv(fields, submissions)}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50/80">
              {fields.map((field) => (
                <th
                  key={field.id ?? field.name}
                  className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500"
                >
                  {field.name}
                </th>
              ))}
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">
                Submitted
              </th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((submission, index) => (
              <motion.tr
                key={submission.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: index * 0.03 }}
                className={cn(
                  "border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50/50 transition-colors"
                )}
              >
                {fields.map((field) => (
                  <td
                    key={field.id ?? field.name}
                    className="px-4 py-3 text-zinc-700"
                  >
                    {renderCellValue(submission.data[field.name])}
                  </td>
                ))}
                <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                  {format(new Date(submission.createdAt), "MMM d, yyyy h:mm a")}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}

function renderCellValue(value: any): string {
  if (value === null || value === undefined) return "-"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return value.join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function downloadCsv(fields: FormField[], submissions: Submission[]) {
  const headers = [...fields.map((f) => f.name), "Submitted"]
  const rows = submissions.map((s) => [
    ...fields.map((f) => {
      const val = s.data[f.name]
      if (val === null || val === undefined) return ""
      if (typeof val === "object") return JSON.stringify(val)
      return String(val)
    }),
    format(new Date(s.createdAt), "yyyy-MM-dd HH:mm:ss"),
  ])

  const csvContent = [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
    )
    .join("\n")

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "submissions.csv"
  link.click()
  URL.revokeObjectURL(url)
}

function SubmissionsSkeleton({ fieldCount }: { fieldCount: number }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200">
        <div className="border-b border-zinc-100 bg-zinc-50/80 flex gap-4 px-4 py-2.5">
          {Array.from({ length: fieldCount + 1 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-20" />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, row) => (
          <div
            key={row}
            className="flex gap-4 px-4 py-3 border-b border-zinc-100 last:border-b-0"
          >
            {Array.from({ length: fieldCount + 1 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-24" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
