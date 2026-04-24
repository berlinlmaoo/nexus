import Image from "next/image"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, Clock3, ExternalLink, MapPin, ShieldCheck } from "lucide-react"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import {
  getAttendanceRecordMetrics,
  getAttendanceWorkspaceContext,
  isAttendanceCorrected,
  isAttendanceSilentCorrectionAdmin,
} from "@/lib/attendance"
import { AttendanceRecordDetailClient } from "@/components/attendance/attendance-record-detail-client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"
const ATTENDANCE_TIMEZONE = "Asia/Jakarta"

function formatDateTime(value: Date | null) {
  if (!value) return "Not recorded"
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: ATTENDANCE_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value)
}

function formatDay(value: Date) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: ATTENDANCE_TIMEZONE,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(value)
}

function formatDistance(value: number | null) {
  if (value === null || Number.isNaN(value)) return "Unknown"
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`
  return `${Math.round(value)} m`
}

function formatMinutes(value: number) {
  if (!value) return "0 min"
  if (value >= 60) {
    const hours = Math.floor(value / 60)
    const minutes = value % 60
    if (!minutes) return `${hours}h`
    return `${hours}h ${minutes}m`
  }
  return `${value} min`
}

function formatCoordinates(lat: number | null, lng: number | null) {
  if (lat === null || lng === null) return "Not recorded"
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

function buildMapsUrl(lat: number | null, lng: number | null) {
  if (lat === null || lng === null) return null
  return `https://www.google.com/maps?q=${lat},${lng}`
}

function statusVariant(status: "CHECKED_IN" | "COMPLETED" | "INCOMPLETE") {
  if (status === "COMPLETED") return "success" as const
  if (status === "INCOMPLETE") return "destructive" as const
  return "warning" as const
}

function shiftSourceLabel(source: "OFFICE" | "TEAM") {
  return source === "TEAM" ? "Team Shift Override" : "Office Default Shift"
}

function AttendanceEventSection({
  label,
  recordedAt,
  distanceMeters,
  lat,
  lng,
  address,
  photoUrl,
}: {
  label: string
  recordedAt: Date | null
  distanceMeters: number | null
  lat: number | null
  lng: number | null
  address: string | null
  photoUrl: string | null
}) {
  const mapsUrl = buildMapsUrl(lat, lng)

  return (
    <div className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">{label}</p>
          <h2 className="mt-1 text-xl font-headline font-black tracking-tight text-on-surface">
            {formatDateTime(recordedAt)}
          </h2>
        </div>
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary"
          >
            Open Maps
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="overflow-hidden rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container">
          {photoUrl ? (
            <Image
              src={photoUrl}
              alt={`${label} attendance evidence`}
              width={1400}
              height={1000}
              className="h-80 w-full object-cover"
            />
          ) : (
            <div className="flex h-80 items-center justify-center px-6 text-center text-sm font-medium text-on-surface-variant/55">
              No selfie evidence was stored for this event.
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">GPS Coordinates</p>
            <p className="mt-2 text-sm font-black text-on-surface">{formatCoordinates(lat, lng)}</p>
          </div>
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Resolved Address</p>
            <p className="mt-2 text-sm font-black text-on-surface">{address || "Address not resolved"}</p>
          </div>
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Distance From Office</p>
            <p className="mt-2 text-sm font-black text-on-surface">{formatDistance(distanceMeters)}</p>
          </div>
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Recorded Time</p>
            <p className="mt-2 text-sm font-black text-on-surface">{formatDateTime(recordedAt)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default async function AttendanceRecordDetailPage({
  params,
}: {
  params: { recordId: string }
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const context = await getAttendanceWorkspaceContext(session.user.id)
  if (!context.workspace || !context.user) redirect("/attendance")

  const record = await prisma.attendanceRecord.findUnique({
    where: { id: params.recordId },
    include: {
      officeLocation: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
      correctedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  })

  if (!record || record.workspaceId !== context.workspace.id) {
    notFound()
  }

  if (!context.canManageAttendance && record.userId !== session.user.id) {
    notFound()
  }

  const offices = context.canManageAttendance
    ? await prisma.officeLocation.findMany({
        where: {
          workspaceId: context.workspace.id,
        },
        select: {
          id: true,
          name: true,
          address: true,
        },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      })
    : []
  const isSilentAdmin = isAttendanceSilentCorrectionAdmin(context.user.email)

  const mapsOfficeUrl = buildMapsUrl(record.officeLocation.latitude, record.officeLocation.longitude)
  const metrics = getAttendanceRecordMetrics(record)
  const isCorrected = isAttendanceCorrected(record)

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" className="h-11 rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em]">
          <Link href="/attendance">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Link>
        </Button>
        <Badge variant={statusVariant(record.status)} className="rounded-full px-3 py-1">
          {record.status.replace("_", " ")}
        </Badge>
        {record.effectiveShiftSource === "TEAM" && record.effectiveTeamName && (
          <Badge variant="outline" className="rounded-full px-3 py-1">
            Team Shift Override · {record.effectiveTeamName}
          </Badge>
        )}
      </div>

      <div className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-on-surface-variant/40">
              Attendance Report
            </p>
            <h1 className="text-3xl font-headline font-black tracking-tight text-on-surface sm:text-5xl">
              {record.user.name}
            </h1>
            <p className="text-sm font-medium text-on-surface-variant/60 sm:text-base">
              {record.user.email} · {formatDay(record.attendanceDate)}
            </p>
          </div>

          <div className="space-y-3 lg:w-[24rem]">
            <AttendanceRecordDetailClient
              recordId={record.id}
              canManage={context.canManageAttendance}
              isSilentAdmin={isSilentAdmin}
              offices={offices}
              initialValues={{
                officeLocationId: record.officeLocationId,
                checkInAt: record.checkInAt?.toISOString() ?? null,
                checkOutAt: record.checkOutAt?.toISOString() ?? null,
                notes: record.notes,
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.5rem] bg-surface-container p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Office</p>
              <p className="mt-2 text-sm font-black text-on-surface">{record.officeLocation.name}</p>
            </div>
            <div className="rounded-[1.5rem] bg-surface-container p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Radius</p>
              <p className="mt-2 text-sm font-black text-on-surface">{record.officeLocation.radiusMeters}m</p>
            </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Clock3 className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Check In</p>
                <p className="text-sm font-black text-on-surface">
                  {formatDateTime(record.checkInAt)} {metrics.checkInStatus ? `· ${metrics.checkInStatus.replace("_", " ")}` : ""}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Clock3 className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Check Out</p>
                <p className="text-sm font-black text-on-surface">
                  {formatDateTime(record.checkOutAt)} {metrics.checkOutStatus ? `· ${metrics.checkOutStatus.replace("_", " ")}` : ""}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <MapPin className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Office Center</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-black text-on-surface">
                    {formatCoordinates(record.officeLocation.latitude, record.officeLocation.longitude)}
                  </p>
                  {mapsOfficeUrl && (
                    <a href={mapsOfficeUrl} target="_blank" rel="noreferrer" className="text-primary">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Worked Time</p>
            <p className="mt-2 text-sm font-black text-on-surface">{formatMinutes(metrics.workedMinutes)}</p>
          </div>
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Late Minutes</p>
            <p className="mt-2 text-sm font-black text-on-surface">{formatMinutes(metrics.lateMinutes)}</p>
          </div>
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Early Leave</p>
            <p className="mt-2 text-sm font-black text-on-surface">{formatMinutes(metrics.earlyLeaveMinutes)}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Effective Shift Source</p>
            <p className="mt-2 text-sm font-black text-on-surface">{shiftSourceLabel(record.effectiveShiftSource)}</p>
          </div>
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Effective Team</p>
            <p className="mt-2 text-sm font-black text-on-surface">{record.effectiveTeamName || "No team override"}</p>
          </div>
          <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Effective Shift Time</p>
            <p className="mt-2 text-sm font-black text-on-surface">
              {record.effectiveShiftStartTime && record.effectiveShiftEndTime
                ? `${record.effectiveShiftStartTime} - ${record.effectiveShiftEndTime}`
                : `${record.officeLocation.shiftStartTime} - ${record.officeLocation.shiftEndTime}`}
            </p>
          </div>
        </div>

        {record.officeLocation.address && (
          <div className="mt-6 rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Office Address</p>
            <p className="mt-2 text-sm font-medium text-on-surface-variant/70">{record.officeLocation.address}</p>
          </div>
        )}

        <div className="mt-6 rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Shift Policy</p>
          <p className="mt-2 text-sm font-medium text-on-surface-variant/70">
            {record.officeLocation.shiftStartTime} - {record.officeLocation.shiftEndTime} · {record.officeLocation.timezone} ·
            Late grace {record.officeLocation.lateGraceMinutes}m · Early leave grace {record.officeLocation.earlyLeaveGraceMinutes}m
          </p>
          {record.effectiveShiftSource === "TEAM" && record.effectiveShiftStartTime && record.effectiveShiftEndTime && (
            <p className="mt-2 text-sm font-semibold text-primary">
              This record used team override hours {record.effectiveShiftStartTime} - {record.effectiveShiftEndTime}
              {record.effectiveTeamName ? ` from ${record.effectiveTeamName}` : ""}.
            </p>
          )}
        </div>

        {isCorrected && (
          <div className="mt-6 rounded-[1.5rem] border border-primary/10 bg-primary/[0.04] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Correction Log</p>
            <p className="mt-2 text-sm font-bold text-on-surface">
              {record.correctedBy?.name ?? "Admin"} · {formatDateTime(record.correctedAt)}
            </p>
            {record.correctionReason && (
              <p className="mt-2 text-sm font-medium text-on-surface-variant/70 whitespace-pre-wrap">
                {record.correctionReason}
              </p>
            )}
          </div>
        )}

        {record.notes && (
          <div className="mt-6 rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Notes</p>
            <p className="mt-2 text-sm font-medium text-on-surface-variant/70 whitespace-pre-wrap">{record.notes}</p>
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <AttendanceEventSection
          label="Check In Evidence"
          recordedAt={record.checkInAt}
          distanceMeters={record.checkInDistanceMeters}
          lat={record.checkInLat}
          lng={record.checkInLng}
          address={record.checkInAddress}
          photoUrl={record.checkInPhotoUrl}
        />
        <AttendanceEventSection
          label="Check Out Evidence"
          recordedAt={record.checkOutAt}
          distanceMeters={record.checkOutDistanceMeters}
          lat={record.checkOutLat}
          lng={record.checkOutLng}
          address={record.checkOutAddress}
          photoUrl={record.checkOutPhotoUrl}
        />
      </div>

      <div className="rounded-[2rem] border border-primary/10 bg-primary/[0.03] p-4 text-sm font-medium text-on-surface-variant/70">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
          <p>
            This report stores server-side timestamps, office geofence matching, GPS coordinates, and
            selfie evidence for the selected attendance record.
          </p>
        </div>
      </div>
    </div>
  )
}
