"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { FilePenLine, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toastError, toastSuccess } from "@/lib/toast"

type OfficeLocationOption = {
  id: string
  name: string
  address: string | null
}

type AttendanceRecordDetailClientProps = {
  recordId: string
  canManage: boolean
  isSilentAdmin: boolean
  offices: OfficeLocationOption[]
  initialValues: {
    officeLocationId: string
    checkInAt: string | null
    checkOutAt: string | null
    notes: string | null
  }
}

function parseResponseError(payload: unknown) {
  if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }

  return "Request failed"
}

export function AttendanceRecordDetailClient({
  recordId,
  canManage,
  isSilentAdmin,
  offices,
  initialValues,
}: AttendanceRecordDetailClientProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    officeLocationId: initialValues.officeLocationId,
    checkInAt: initialValues.checkInAt,
    checkOutAt: initialValues.checkOutAt,
    notes: initialValues.notes ?? "",
    correctionReason: "",
  })

  const selectedOffice = useMemo(
    () => offices.find((office) => office.id === form.officeLocationId) ?? null,
    [form.officeLocationId, offices]
  )

  if (!canManage) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11 rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em]"
        onClick={() => setOpen(true)}
      >
        <FilePenLine className="mr-2 h-4 w-4" />
        Correct Attendance
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl rounded-[2rem] border-none bg-surface-container-lowest p-0 shadow-2xl">
          <div className="p-6 sm:p-8">
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-2xl">Manual Attendance Correction</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed text-on-surface-variant/70">
                Gunakan ini kalau admin perlu benerin jam masuk, jam pulang, office, atau catatan absensi
                tanpa ubah data langsung dari database.
              </DialogDescription>
            </DialogHeader>

            {isSilentAdmin && (
              <div className="mt-4 rounded-[1.5rem] border border-primary/10 bg-primary/[0.04] px-4 py-3 text-sm font-medium text-on-surface-variant/75">
                Silent correction mode aktif untuk akun ini. Perubahan attendance tidak akan menampilkan correction log di report.
              </div>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Office</Label>
                <select
                  value={form.officeLocationId}
                  onChange={(event) => setForm((current) => ({ ...current, officeLocationId: event.target.value }))}
                  className="h-12 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-semibold text-on-surface outline-none"
                >
                  {offices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.name}
                    </option>
                  ))}
                </select>
                {selectedOffice?.address && (
                  <p className="text-xs font-medium text-on-surface-variant/55">{selectedOffice.address}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Check In Time</Label>
                <DateTimePicker
                  value={form.checkInAt}
                  onChange={(value) => setForm((current) => ({ ...current, checkInAt: value }))}
                  popoverSide="bottom"
                  popoverAlign="start"
                  popoverSideOffset={2}
                  popoverAvoidCollisions={false}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <Label>Check Out Time</Label>
                <DateTimePicker
                  value={form.checkOutAt}
                  onChange={(value) => setForm((current) => ({ ...current, checkOutAt: value }))}
                  popoverSide="bottom"
                  popoverAlign="start"
                  popoverSideOffset={2}
                  popoverAvoidCollisions={false}
                  className="w-full"
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  rows={4}
                  className="rounded-2xl border-none bg-surface-container-low text-sm font-medium shadow-none"
                  placeholder="Catatan koreksi tambahan..."
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>
                  Correction Reason {isSilentAdmin ? <span className="text-on-surface-variant/45">(Optional)</span> : null}
                </Label>
                <Textarea
                  value={form.correctionReason}
                  onChange={(event) => setForm((current) => ({ ...current, correctionReason: event.target.value }))}
                  rows={3}
                  className="rounded-2xl border-none bg-surface-container-low text-sm font-medium shadow-none"
                  placeholder="Kenapa record ini dikoreksi?"
                />
              </div>
            </div>

            <DialogFooter className="mt-6 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em]"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="h-11 rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em]"
                disabled={
                  submitting ||
                  (!isSilentAdmin && !form.correctionReason.trim()) ||
                  !form.checkInAt
                }
                onClick={async () => {
                  setSubmitting(true)
                  try {
                    const response = await fetch(`/api/attendance/records/${recordId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        officeLocationId: form.officeLocationId,
                        checkInAt: form.checkInAt,
                        checkOutAt: form.checkOutAt,
                        notes: form.notes.trim() || null,
                        correctionReason: form.correctionReason.trim() || null,
                      }),
                    })

                    const payload = await response.json().catch(() => null)
                    if (!response.ok) {
                      throw new Error(parseResponseError(payload))
                    }

                    toastSuccess("Attendance report corrected")
                    setOpen(false)
                    router.refresh()
                  } catch (error) {
                    toastError(error instanceof Error ? error.message : "Failed to correct attendance")
                  } finally {
                    setSubmitting(false)
                  }
                }}
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePenLine className="mr-2 h-4 w-4" />}
                Save Correction
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
