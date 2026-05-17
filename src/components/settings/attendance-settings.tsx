"use client"

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Building2, Download, Loader2, MapPin, RefreshCw, Save, ShieldCheck, Users } from "lucide-react"
import { GeofenceMapPicker } from "@/components/attendance/geofence-map-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toastError, toastSuccess } from "@/lib/toast"

type OfficeLocation = {
  id: string
  name: string
  address: string | null
  latitude: number
  longitude: number
  radiusMeters: number
  timezone: string
  workdays: number[]
  shiftStartTime: string
  shiftEndTime: string
  lateGraceMinutes: number
  earlyLeaveGraceMinutes: number
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

type AttendanceRecord = {
  id: string
  attendanceDate: string
  checkInAt: string | null
  checkOutAt: string | null
  checkInStatus: "ON_TIME" | "LATE" | null
  checkOutStatus: "ON_TIME" | "EARLY_LEAVE" | "OVERTIME" | null
  lateMinutes: number
  earlyLeaveMinutes: number
  workedMinutes: number
  checkInAddress: string | null
  checkOutAddress: string | null
  checkInDistanceMeters: number | null
  checkOutDistanceMeters: number | null
  notes: string | null
  status: "CHECKED_IN" | "COMPLETED" | "INCOMPLETE"
  correctedAt: string | null
  correctionReason: string | null
  isCorrected: boolean
  effectiveShiftSource: "OFFICE" | "TEAM"
  effectiveTeamId: string | null
  effectiveTeamName: string | null
  effectiveShiftStartTime: string | null
  effectiveShiftEndTime: string | null
  officeLocation: {
    id: string
    name: string
    address?: string | null
    radiusMeters: number
  }
  user: {
    id: string
    name: string
    email: string
    avatar: string | null
  }
  correctedBy: {
    id: string
    name: string
    email: string
  } | null
  recordKind?: "ATTENDANCE" | "REQUEST" | "ABSENT"
  attendanceDayType?: "PRESENT" | "LEAVE_APPROVED" | "SICK_APPROVED" | "PERMIT_APPROVED" | "DAY_OFF_APPROVED" | "ABSENT"
  requestType?: "LEAVE" | "SICK" | "PERMIT" | "DAY_OFF" | null
  requestStatus?: "APPROVED" | null
  approvalSource?: "ADMIN" | "ATTENDANCE_SUPERVISOR" | "TEAM_HEAD" | null
  reviewedAt?: string | null
  reviewedBy?: {
    id: string
    name: string
    email: string
  } | null
  hasSupportingDocument?: boolean
  supportingDocumentUrl?: string | null
  supportingDocumentName?: string | null
}

type AttendanceRequest = {
  id: string
  startDate: string
  endDate: string
  type: "LEAVE" | "SICK" | "PERMIT" | "DAY_OFF"
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELED"
  reason: string
  reviewNote: string | null
  approvalSource: "ADMIN" | "ATTENDANCE_SUPERVISOR" | "TEAM_HEAD" | null
  supportingDocumentUrl: string | null
  supportingDocumentName: string | null
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
  user: {
    id: string
    name: string
    email: string
    avatar: string | null
  }
  reviewedBy: {
    id: string
    name: string
    email: string
  } | null
  team: {
    id: string
    name: string
  } | null
}

type WorkspaceMember = {
  id: string
  userId: string
  name: string
  email: string
  avatar: string | null
  role: string
  attendanceRole: "NONE" | "SUPERVISOR"
}

type AttendanceSettingsSectionProps = {
  workspace: { id: string; name: string; slug: string } | null
}

type OfficeDraft = {
  name: string
  address: string
  latitude: string
  longitude: string
  radiusMeters: string
  timezone: string
  workdays: number[]
  shiftStartTime: string
  shiftEndTime: string
  lateGraceMinutes: string
  earlyLeaveGraceMinutes: string
  isActive: boolean
}
const ATTENDANCE_TIMEZONE = "Asia/Jakarta"

const currentMonthKey = new Date().toLocaleDateString("en-CA", {
  timeZone: ATTENDANCE_TIMEZONE,
  year: "numeric",
  month: "2-digit",
}).slice(0, 7)

function monthToDateRange(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number)
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  return {
    dateFrom: formatter.format(start),
    dateTo: formatter.format(end),
  }
}

function formatDateTime(value: string | null) {
  if (!value) return "Not recorded"
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: ATTENDANCE_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function formatDateKey(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: ATTENDANCE_TIMEZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value))
}

function formatDistance(value: number | null) {
  if (value === null || Number.isNaN(value)) return "Unknown"
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`
  return `${Math.round(value)} m`
}

function getStatusVariant(status: AttendanceRecord["status"]) {
  if (status === "COMPLETED") return "success" as const
  if (status === "INCOMPLETE") return "destructive" as const
  return "warning" as const
}

function getCheckInVariant(status: AttendanceRecord["checkInStatus"]) {
  if (status === "LATE") return "destructive" as const
  if (status === "ON_TIME") return "success" as const
  return "outline" as const
}

function getCheckOutVariant(status: AttendanceRecord["checkOutStatus"]) {
  if (status === "EARLY_LEAVE") return "destructive" as const
  if (status === "OVERTIME") return "warning" as const
  if (status === "ON_TIME") return "success" as const
  return "outline" as const
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

function formatWorkdays(workdays: number[]) {
  const labels: Record<number, string> = {
    1: "Mon",
    2: "Tue",
    3: "Wed",
    4: "Thu",
    5: "Fri",
    6: "Sat",
    7: "Sun",
  }
  return workdays.map((day) => labels[day] ?? day).join(", ")
}

async function parseResponseError(response: Response) {
  try {
    const payload = await response.json()
    if (payload?.error) return payload.error as string
  } catch {
    // noop
  }
  return "Request failed"
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase()
}

function matchesSearchQuery({
  query,
  primaryFields,
  secondaryFields = [],
}: {
  query: string
  primaryFields: Array<string | null | undefined>
  secondaryFields?: Array<string | null | undefined>
}) {
  if (!query) return true

  const normalizedQuery = normalizeSearchValue(query)
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean)
  const normalizedPrimary = primaryFields.map((field) => normalizeSearchValue(field ?? "")).filter(Boolean)
  const normalizedSecondary = secondaryFields.map((field) => normalizeSearchValue(field ?? "")).filter(Boolean)

  const primaryTokenMatch = queryTokens.every((token) =>
    normalizedPrimary.some((field) =>
      field
        .split(/[\s._@-]+/)
        .filter(Boolean)
        .some((part) => part.startsWith(token))
    )
  )

  if (primaryTokenMatch) return true

  const shouldSearchSecondary =
    normalizedQuery.includes("@") ||
    normalizedQuery.includes(".") ||
    /\d/.test(normalizedQuery) ||
    queryTokens.some((token) => token.length >= 6)

  if (!shouldSearchSecondary) return false

  return [...normalizedPrimary, ...normalizedSecondary].some((field) => field.includes(normalizedQuery))
}

export function AttendanceSettingsSection({ workspace }: AttendanceSettingsSectionProps) {
  const [loading, setLoading] = useState(true)
  const [savingNewOffice, setSavingNewOffice] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [savingOfficeId, setSavingOfficeId] = useState<string | null>(null)
  const [offices, setOffices] = useState<OfficeLocation[]>([])
  const [officeDrafts, setOfficeDrafts] = useState<Record<string, OfficeDraft>>({})
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [requests, setRequests] = useState<AttendanceRequest[]>([])
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [requestSearch, setRequestSearch] = useState("")
  const [recapSearch, setRecapSearch] = useState("")
  const [requestFilters, setRequestFilters] = useState({
    month: currentMonthKey,
    status: "PENDING",
    type: "all",
    userId: "all",
    teamId: "all",
  })
  const [requestReviewNote, setRequestReviewNote] = useState("")
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null)
  const [selectedRecapRecord, setSelectedRecapRecord] = useState<AttendanceRecord | null>(null)
  const [filters, setFilters] = useState({
    month: currentMonthKey,
    dateFrom: monthToDateRange(currentMonthKey).dateFrom,
    dateTo: monthToDateRange(currentMonthKey).dateTo,
    officeLocationId: "all",
    userId: "all",
    status: "all",
    checkInStatus: "all",
    checkOutStatus: "all",
    isCorrected: "all",
  })
  const [newOffice, setNewOffice] = useState<OfficeDraft>({
    name: "",
    address: "",
    latitude: "",
    longitude: "",
    radiusMeters: "100",
    timezone: ATTENDANCE_TIMEZONE,
    workdays: [1, 2, 3, 4, 5, 6, 7],
    shiftStartTime: "09:00",
    shiftEndTime: "18:00",
    lateGraceMinutes: "15",
    earlyLeaveGraceMinutes: "0",
    isActive: true,
  })
  const deferredRequestSearch = useDeferredValue(requestSearch.trim().toLowerCase())
  const deferredRecapSearch = useDeferredValue(recapSearch.trim().toLowerCase())

  const syncOfficeDrafts = useCallback((nextOffices: OfficeLocation[]) => {
    setOfficeDrafts(
      Object.fromEntries(
        nextOffices.map((office) => [
          office.id,
          {
            name: office.name,
            address: office.address ?? "",
            latitude: String(office.latitude),
            longitude: String(office.longitude),
            radiusMeters: String(office.radiusMeters),
            timezone: office.timezone ?? ATTENDANCE_TIMEZONE,
            workdays: office.workdays?.length ? office.workdays : [1, 2, 3, 4, 5, 6, 7],
            shiftStartTime: office.shiftStartTime ?? "09:00",
            shiftEndTime: office.shiftEndTime ?? "18:00",
            lateGraceMinutes: String(office.lateGraceMinutes ?? 15),
            earlyLeaveGraceMinutes: String(office.earlyLeaveGraceMinutes ?? 0),
            isActive: office.isActive,
          },
        ])
      )
    )
  }, [])

  const fetchOffices = useCallback(async () => {
    const response = await fetch("/api/attendance/offices", { cache: "no-store" })
    if (!response.ok) {
      throw new Error(await parseResponseError(response))
    }
    const payload = await response.json()
    setOffices(payload.offices ?? [])
    syncOfficeDrafts(payload.offices ?? [])
  }, [syncOfficeDrafts])

  const fetchMembers = useCallback(async () => {
    const response = await fetch("/api/workspaces/members", { cache: "no-store" })
    if (!response.ok) {
      throw new Error(await parseResponseError(response))
    }
    const payload = await response.json()
    setMembers(payload.members ?? [])
  }, [])

  const fetchRecap = useCallback(async () => {
    const searchParams = new URLSearchParams({
      scope: "workspace",
      month: filters.month,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    })

    if (filters.officeLocationId !== "all") {
      searchParams.set("officeLocationId", filters.officeLocationId)
    }

    if (filters.userId !== "all") {
      searchParams.set("userId", filters.userId)
    }

    if (filters.status !== "all") {
      searchParams.set("status", filters.status)
    }

    if (filters.checkInStatus !== "all") {
      searchParams.set("checkInStatus", filters.checkInStatus)
    }

    if (filters.checkOutStatus !== "all") {
      searchParams.set("checkOutStatus", filters.checkOutStatus)
    }

    if (filters.isCorrected !== "all") {
      searchParams.set("isCorrected", filters.isCorrected)
    }

    const response = await fetch(`/api/attendance/history?${searchParams.toString()}`, { cache: "no-store" })
    if (!response.ok) {
      throw new Error(await parseResponseError(response))
    }

    const payload = await response.json()
    setRecords(payload.records ?? [])
  }, [filters])

  const fetchRequests = useCallback(async () => {
    const searchParams = new URLSearchParams({
      scope: "approvals",
      month: requestFilters.month,
    })

    if (requestFilters.status !== "all") {
      searchParams.set("status", requestFilters.status)
    }
    if (requestFilters.type !== "all") {
      searchParams.set("type", requestFilters.type)
    }
    if (requestFilters.userId !== "all") {
      searchParams.set("userId", requestFilters.userId)
    }
    if (requestFilters.teamId !== "all") {
      searchParams.set("teamId", requestFilters.teamId)
    }

    const response = await fetch(`/api/attendance/requests?${searchParams.toString()}`, { cache: "no-store" })
    if (!response.ok) {
      throw new Error(await parseResponseError(response))
    }

    const payload = await response.json()
    setRequests(payload.requests ?? [])
  }, [requestFilters])

  const loadAll = useCallback(async (showLoader = false) => {
    if (showLoader) setRefreshing(true)
    try {
      await Promise.all([fetchOffices(), fetchMembers(), fetchRecap(), fetchRequests()])
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Failed to load attendance settings")
    } finally {
      setLoading(false)
      if (showLoader) setRefreshing(false)
    }
  }, [fetchMembers, fetchOffices, fetchRecap, fetchRequests])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    if (loading) return
    void fetchRecap().catch((error) => {
      toastError(error instanceof Error ? error.message : "Failed to refresh attendance recap")
    })
  }, [fetchRecap, loading])

  useEffect(() => {
    if (loading) return
    void fetchRequests().catch((error) => {
      toastError(error instanceof Error ? error.message : "Failed to refresh attendance requests")
    })
  }, [fetchRequests, loading])

  const exportHref = useMemo(() => {
    const searchParams = new URLSearchParams({
      scope: "workspace",
      format: "xlsx",
      month: filters.month,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    })

    if (filters.officeLocationId !== "all") {
      searchParams.set("officeLocationId", filters.officeLocationId)
    }

    if (filters.userId !== "all") {
      searchParams.set("userId", filters.userId)
    }

    if (filters.status !== "all") {
      searchParams.set("status", filters.status)
    }

    if (filters.checkInStatus !== "all") {
      searchParams.set("checkInStatus", filters.checkInStatus)
    }

    if (filters.checkOutStatus !== "all") {
      searchParams.set("checkOutStatus", filters.checkOutStatus)
    }

    if (filters.isCorrected !== "all") {
      searchParams.set("isCorrected", filters.isCorrected)
    }

    return `/api/attendance/history?${searchParams.toString()}`
  }, [filters])

  const filteredRequests = useMemo(() => {
    if (!deferredRequestSearch) return requests
    return requests.filter((request) => {
      return matchesSearchQuery({
        query: deferredRequestSearch,
        primaryFields: [request.user.name, request.team?.name, request.type, request.reason],
        secondaryFields: [request.user.email],
      })
    })
  }, [deferredRequestSearch, requests])

  const filteredRecords = useMemo(() => {
    if (!deferredRecapSearch) return records
    return records.filter((record) => {
      return matchesSearchQuery({
        query: deferredRecapSearch,
        primaryFields: [
          record.user.name,
          record.officeLocation.name,
          record.officeLocation.address ?? "",
          record.attendanceDayType ?? "",
          record.requestType ?? "",
          record.approvalSource ?? "",
          record.effectiveTeamName ?? "",
        ],
        secondaryFields: [record.user.email],
      })
    })
  }, [deferredRecapSearch, records])

  const recapSummary = useMemo(() => {
    return filteredRecords.reduce(
      (accumulator, record) => {
        accumulator.total += 1
        if (record.status === "COMPLETED") accumulator.completed += 1
        if (record.status === "CHECKED_IN") accumulator.checkedIn += 1
        if (record.status === "INCOMPLETE") accumulator.incomplete += 1
        if (record.checkInStatus === "ON_TIME") accumulator.onTime += 1
        if (record.checkInStatus === "LATE") accumulator.late += 1
        if (record.checkOutStatus === "EARLY_LEAVE") accumulator.earlyLeave += 1
        accumulator.workedMinutes += record.workedMinutes ?? 0
        return accumulator
      },
      { total: 0, completed: 0, checkedIn: 0, incomplete: 0, onTime: 0, late: 0, earlyLeave: 0, workedMinutes: 0 }
    )
  }, [filteredRecords])

  const officeBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; count: number; late: number; workedMinutes: number }>()
    for (const record of filteredRecords) {
      const current = map.get(record.officeLocation.id) ?? {
        name: record.officeLocation.name,
        count: 0,
        late: 0,
        workedMinutes: 0,
      }
      current.count += 1
      if (record.checkInStatus === "LATE") current.late += 1
      current.workedMinutes += record.workedMinutes ?? 0
      map.set(record.officeLocation.id, current)
    }
    return Array.from(map.values()).sort((left, right) => right.count - left.count).slice(0, 5)
  }, [filteredRecords])

  const personBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; count: number; late: number; earlyLeave: number }>()
    for (const record of filteredRecords) {
      const current = map.get(record.user.id) ?? {
        name: record.user.name,
        count: 0,
        late: 0,
        earlyLeave: 0,
      }
      current.count += 1
      if (record.checkInStatus === "LATE") current.late += 1
      if (record.checkOutStatus === "EARLY_LEAVE") current.earlyLeave += 1
      map.set(record.user.id, current)
    }
    return Array.from(map.values()).sort((left, right) => right.count - left.count).slice(0, 5)
  }, [filteredRecords])

  const groupedSearchResults = useMemo(() => {
    if (!deferredRecapSearch) return []

    const map = new Map<
      string,
      {
        user: AttendanceRecord["user"]
        totalRows: number
        absentRows: number
        requestRows: number
        presentRows: number
        latestDate: string
        officeNames: Set<string>
        teamNames: Set<string>
      }
    >()

    for (const record of filteredRecords) {
      const current = map.get(record.user.id) ?? {
        user: record.user,
        totalRows: 0,
        absentRows: 0,
        requestRows: 0,
        presentRows: 0,
        latestDate: record.attendanceDate,
        officeNames: new Set<string>(),
        teamNames: new Set<string>(),
      }

      current.totalRows += 1
      if (record.recordKind === "ABSENT") current.absentRows += 1
      if (record.recordKind === "REQUEST") current.requestRows += 1
      if (record.recordKind === "ATTENDANCE") current.presentRows += 1
      if (new Date(record.attendanceDate).getTime() > new Date(current.latestDate).getTime()) {
        current.latestDate = record.attendanceDate
      }
      current.officeNames.add(record.officeLocation.name)
      if (record.effectiveTeamName) current.teamNames.add(record.effectiveTeamName)
      map.set(record.user.id, current)
    }

    return Array.from(map.values()).sort((left, right) => {
      if (right.totalRows !== left.totalRows) return right.totalRows - left.totalRows
      return left.user.name.localeCompare(right.user.name)
    })
  }, [deferredRecapSearch, filteredRecords])

  const requestSummary = useMemo(() => {
    return filteredRequests.reduce(
      (accumulator, request) => {
        accumulator.total += 1
        if (request.status === "PENDING") accumulator.pending += 1
        if (request.status === "APPROVED") accumulator.approved += 1
        if (request.status === "REJECTED") accumulator.rejected += 1
        if (request.type === "DAY_OFF") accumulator.dayOff += 1
        if (request.type === "SICK") accumulator.sick += 1
        return accumulator
      },
      { total: 0, pending: 0, approved: 0, rejected: 0, dayOff: 0, sick: 0 }
    )
  }, [filteredRequests])

  const resolveAddress = useCallback(async (latitude: number, longitude: number) => {
    const searchParams = new URLSearchParams({
      lat: String(latitude),
      lng: String(longitude),
    })

    const response = await fetch(`/api/attendance/reverse-geocode?${searchParams.toString()}`, {
      cache: "no-store",
    })

    if (!response.ok) {
      throw new Error(await parseResponseError(response))
    }

    const payload = await response.json()
    return (payload.address as string | null) ?? ""
  }, [])

  const handleNewOfficeMapChange = useCallback(
    async ({ latitude, longitude }: { latitude: number; longitude: number }) => {
      setNewOffice((current) => ({
        ...current,
        latitude: String(latitude),
        longitude: String(longitude),
      }))

      try {
        const address = await resolveAddress(latitude, longitude)
        setNewOffice((current) => ({
          ...current,
          address,
        }))
      } catch {
        // keep manual editing path available even if geocoder fails
      }
    },
    [resolveAddress]
  )

  const handleExistingOfficeMapChange = useCallback(
    async (officeId: string, { latitude, longitude }: { latitude: number; longitude: number }) => {
      setOfficeDrafts((current) => ({
        ...current,
        [officeId]: {
          ...current[officeId],
          latitude: String(latitude),
          longitude: String(longitude),
        },
      }))

      try {
        const address = await resolveAddress(latitude, longitude)
        setOfficeDrafts((current) => ({
          ...current,
          [officeId]: {
            ...current[officeId],
            address,
          },
        }))
      } catch {
        // keep manual editing path available even if geocoder fails
      }
    },
    [resolveAddress]
  )

  const handleCreateOffice = useCallback(async () => {
    setSavingNewOffice(true)
    try {
      const response = await fetch("/api/attendance/offices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newOffice.name.trim(),
          address: newOffice.address.trim() || null,
          latitude: Number(newOffice.latitude),
          longitude: Number(newOffice.longitude),
          radiusMeters: Number(newOffice.radiusMeters),
          timezone: newOffice.timezone,
          workdays: newOffice.workdays,
          shiftStartTime: newOffice.shiftStartTime,
          shiftEndTime: newOffice.shiftEndTime,
          lateGraceMinutes: Number(newOffice.lateGraceMinutes),
          earlyLeaveGraceMinutes: Number(newOffice.earlyLeaveGraceMinutes),
          isActive: newOffice.isActive,
        }),
      })

      if (!response.ok) {
        throw new Error(await parseResponseError(response))
      }

      setNewOffice({
        name: "",
        address: "",
        latitude: "",
        longitude: "",
        radiusMeters: "100",
        timezone: ATTENDANCE_TIMEZONE,
        workdays: [1, 2, 3, 4, 5, 6, 7],
        shiftStartTime: "09:00",
        shiftEndTime: "18:00",
        lateGraceMinutes: "15",
        earlyLeaveGraceMinutes: "0",
        isActive: true,
      })
      toastSuccess("Office geofence created")
      await loadAll()
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Failed to create office")
    } finally {
      setSavingNewOffice(false)
    }
  }, [loadAll, newOffice])

  const handleSaveOffice = useCallback(
    async (officeId: string) => {
      const draft = officeDrafts[officeId]
      if (!draft) return

      setSavingOfficeId(officeId)
      try {
        const response = await fetch(`/api/attendance/offices/${officeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name.trim(),
            address: draft.address.trim() || null,
            latitude: Number(draft.latitude),
            longitude: Number(draft.longitude),
            radiusMeters: Number(draft.radiusMeters),
            timezone: draft.timezone,
            workdays: draft.workdays,
            shiftStartTime: draft.shiftStartTime,
            shiftEndTime: draft.shiftEndTime,
            lateGraceMinutes: Number(draft.lateGraceMinutes),
            earlyLeaveGraceMinutes: Number(draft.earlyLeaveGraceMinutes),
            isActive: draft.isActive,
          }),
        })

        if (!response.ok) {
          throw new Error(await parseResponseError(response))
        }

        toastSuccess("Office geofence updated")
        await loadAll()
      } catch (error) {
        toastError(error instanceof Error ? error.message : "Failed to save office")
      } finally {
        setSavingOfficeId(null)
      }
    },
    [loadAll, officeDrafts]
  )

  const handleReviewRequest = useCallback(
    async (requestId: string, action: "approve" | "reject") => {
      setUpdatingRequestId(requestId)
      try {
        const response = await fetch(`/api/attendance/requests/${requestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            reviewNote: requestReviewNote.trim() || null,
          }),
        })

        if (!response.ok) {
          throw new Error(await parseResponseError(response))
        }

        toastSuccess(`Attendance request ${action}d`)
        setRequestReviewNote("")
        await loadAll()
      } catch (error) {
        toastError(error instanceof Error ? error.message : "Failed to review attendance request")
      } finally {
        setUpdatingRequestId(null)
      }
    },
    [loadAll, requestReviewNote]
  )

  if (!workspace) {
    return (
      <div className="rounded-[2rem] border border-red-500/20 bg-red-500/5 p-6 text-sm font-medium text-red-600">
        No workspace membership was found, so attendance settings are unavailable.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-10">
      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-low p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MapPin className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                Multi-office geofence
              </p>
              <h3 className="text-xl font-headline font-black tracking-tight text-on-surface">
                Configure office coordinates that unlock attendance
              </h3>
              <p className="text-sm font-medium text-on-surface-variant/65">
                NEXUS will auto-match the nearest active office and only accept check-in or check-out
                when the user stays inside the configured radius.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1.5rem] bg-surface-container-lowest p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
                Workspace
              </p>
              <p className="mt-2 text-lg font-black tracking-tight text-on-surface">{workspace.name}</p>
            </div>
            <div className="rounded-[1.5rem] bg-surface-container-lowest p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
                Active offices
              </p>
              <p className="mt-2 text-lg font-black tracking-tight text-on-surface">
                {offices.filter((office) => office.isActive).length}
              </p>
            </div>
            <div className="rounded-[1.5rem] bg-surface-container-lowest p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
                Attendance rows
              </p>
              <p className="mt-2 text-lg font-black tracking-tight text-on-surface">{records.length}</p>
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-low p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                Ops notes
              </p>
              <h3 className="text-xl font-headline font-black tracking-tight text-on-surface">
                Recommended v1 operating rules
              </h3>
              <p className="text-sm font-medium text-on-surface-variant/65">
                Keep office radiuses realistic, use a stable public office coordinate, and tell the
                team that browser location plus selfie are both required on every submission.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
              Create office
            </p>
            <h3 className="mt-1 text-2xl font-headline font-black tracking-tight text-on-surface">
              Add a new attendance checkpoint
            </h3>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em]"
            onClick={() => void loadAll(true)}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label>Office Name</Label>
            <Input
              value={newOffice.name}
              onChange={(event) => setNewOffice((current) => ({ ...current, name: event.target.value }))}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
              placeholder="Main HQ"
            />
          </div>
          <div className="space-y-2 md:col-span-2 xl:col-span-3">
            <Label>Address</Label>
            <Input
              value={newOffice.address}
              onChange={(event) => setNewOffice((current) => ({ ...current, address: event.target.value }))}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
              placeholder="Alamat kantor akan otomatis terisi dari map picker, tapi tetap bisa kamu edit."
            />
          </div>
          <div className="space-y-2">
            <Label>Latitude</Label>
            <Input
              value={newOffice.latitude}
              onChange={(event) => setNewOffice((current) => ({ ...current, latitude: event.target.value }))}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
              placeholder="-6.20876"
            />
          </div>
          <div className="space-y-2">
            <Label>Longitude</Label>
            <Input
              value={newOffice.longitude}
              onChange={(event) => setNewOffice((current) => ({ ...current, longitude: event.target.value }))}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
              placeholder="106.84560"
            />
          </div>
          <div className="space-y-2">
            <Label>Radius (meters)</Label>
            <Input
              value={newOffice.radiusMeters}
              onChange={(event) => setNewOffice((current) => ({ ...current, radiusMeters: event.target.value }))}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
              placeholder="100"
            />
          </div>
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Input
              value={newOffice.timezone}
              onChange={(event) => setNewOffice((current) => ({ ...current, timezone: event.target.value }))}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
              placeholder="Asia/Jakarta"
            />
          </div>
          <div className="space-y-2">
            <Label>Shift Start</Label>
            <Input
              type="time"
              value={newOffice.shiftStartTime}
              onChange={(event) => setNewOffice((current) => ({ ...current, shiftStartTime: event.target.value }))}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
            />
          </div>
          <div className="space-y-2">
            <Label>Shift End</Label>
            <Input
              type="time"
              value={newOffice.shiftEndTime}
              onChange={(event) => setNewOffice((current) => ({ ...current, shiftEndTime: event.target.value }))}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
            />
          </div>
          <div className="space-y-2">
            <Label>Late Grace (minutes)</Label>
            <Input
              type="number"
              value={newOffice.lateGraceMinutes}
              onChange={(event) => setNewOffice((current) => ({ ...current, lateGraceMinutes: event.target.value }))}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
              min={0}
            />
          </div>
          <div className="space-y-2">
            <Label>Early Leave Grace (minutes)</Label>
            <Input
              type="number"
              value={newOffice.earlyLeaveGraceMinutes}
              onChange={(event) =>
                setNewOffice((current) => ({ ...current, earlyLeaveGraceMinutes: event.target.value }))
              }
              className="h-12 rounded-2xl border-none bg-surface-container-low"
              min={0}
            />
          </div>
          <div className="space-y-2 md:col-span-2 xl:col-span-4">
            <Label>Workdays</Label>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                const label = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day - 1]
                const active = newOffice.workdays.includes(day)
                return (
                  <Button
                    key={day}
                    type="button"
                    variant={active ? "default" : "outline"}
                    className="h-10 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]"
                    onClick={() =>
                      setNewOffice((current) => ({
                        ...current,
                        workdays: current.workdays.includes(day)
                          ? current.workdays.filter((value) => value !== day)
                          : [...current.workdays, day].sort((left, right) => left - right),
                      }))
                    }
                  >
                    {label}
                  </Button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <GeofenceMapPicker
            latitude={newOffice.latitude ? Number(newOffice.latitude) : null}
            longitude={newOffice.longitude ? Number(newOffice.longitude) : null}
            radiusMeters={Number(newOffice.radiusMeters) || 100}
            onChange={(coords) => {
              void handleNewOfficeMapChange(coords)
            }}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-[1.5rem] bg-surface-container-low p-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={newOffice.isActive}
              onCheckedChange={(checked) => setNewOffice((current) => ({ ...current, isActive: checked }))}
            />
            <div>
              <p className="text-sm font-bold text-on-surface">Mark active immediately</p>
              <p className="text-xs font-medium text-on-surface-variant/55">
                Active offices are eligible for strict geofence validation right away.
              </p>
            </div>
          </div>
          <Button
            type="button"
            className="h-12 rounded-2xl px-6 text-xs font-black uppercase tracking-[0.18em]"
            onClick={() => void handleCreateOffice()}
            disabled={
              savingNewOffice ||
              !newOffice.name.trim() ||
              !newOffice.latitude.trim() ||
              !newOffice.longitude.trim() ||
              !newOffice.radiusMeters.trim() ||
              !newOffice.timezone.trim() ||
              newOffice.workdays.length === 0
            }
          >
            {savingNewOffice ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}
            Create Office
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {offices.map((office) => {
          const draft = officeDrafts[office.id]
          if (!draft) return null

          return (
            <div
              key={office.id}
              className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm sm:p-6"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <h4 className="text-xl font-headline font-black tracking-tight text-on-surface">
                      {office.name}
                    </h4>
                    <Badge variant={office.isActive ? "success" : "outline"}>
                      {office.isActive ? "ACTIVE" : "INACTIVE"}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium text-on-surface-variant/60">
                    Exact coordinate and radius used for automatic office detection.
                  </p>
                </div>
                <Button
                  type="button"
                  className="h-11 rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em]"
                  onClick={() => void handleSaveOffice(office.id)}
                  disabled={savingOfficeId === office.id}
                >
                  {savingOfficeId === office.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save office
                </Button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={draft.name}
                    onChange={(event) =>
                      setOfficeDrafts((current) => ({
                        ...current,
                        [office.id]: { ...current[office.id], name: event.target.value },
                      }))
                    }
                    className="h-12 rounded-2xl border-none bg-surface-container-low"
                  />
                </div>
                <div className="space-y-2 md:col-span-2 xl:col-span-3">
                  <Label>Address</Label>
                  <Input
                    value={draft.address}
                    onChange={(event) =>
                      setOfficeDrafts((current) => ({
                        ...current,
                        [office.id]: { ...current[office.id], address: event.target.value },
                      }))
                    }
                    className="h-12 rounded-2xl border-none bg-surface-container-low"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Latitude</Label>
                  <Input
                    value={draft.latitude}
                    onChange={(event) =>
                      setOfficeDrafts((current) => ({
                        ...current,
                        [office.id]: { ...current[office.id], latitude: event.target.value },
                      }))
                    }
                    className="h-12 rounded-2xl border-none bg-surface-container-low"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Longitude</Label>
                  <Input
                    value={draft.longitude}
                    onChange={(event) =>
                      setOfficeDrafts((current) => ({
                        ...current,
                        [office.id]: { ...current[office.id], longitude: event.target.value },
                      }))
                    }
                    className="h-12 rounded-2xl border-none bg-surface-container-low"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Radius</Label>
                  <Input
                    value={draft.radiusMeters}
                    onChange={(event) =>
                      setOfficeDrafts((current) => ({
                        ...current,
                        [office.id]: { ...current[office.id], radiusMeters: event.target.value },
                      }))
                    }
                    className="h-12 rounded-2xl border-none bg-surface-container-low"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Input
                    value={draft.timezone}
                    onChange={(event) =>
                      setOfficeDrafts((current) => ({
                        ...current,
                        [office.id]: { ...current[office.id], timezone: event.target.value },
                      }))
                    }
                    className="h-12 rounded-2xl border-none bg-surface-container-low"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Shift Start</Label>
                  <Input
                    type="time"
                    value={draft.shiftStartTime}
                    onChange={(event) =>
                      setOfficeDrafts((current) => ({
                        ...current,
                        [office.id]: { ...current[office.id], shiftStartTime: event.target.value },
                      }))
                    }
                    className="h-12 rounded-2xl border-none bg-surface-container-low"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Shift End</Label>
                  <Input
                    type="time"
                    value={draft.shiftEndTime}
                    onChange={(event) =>
                      setOfficeDrafts((current) => ({
                        ...current,
                        [office.id]: { ...current[office.id], shiftEndTime: event.target.value },
                      }))
                    }
                    className="h-12 rounded-2xl border-none bg-surface-container-low"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Late Grace</Label>
                  <Input
                    type="number"
                    value={draft.lateGraceMinutes}
                    onChange={(event) =>
                      setOfficeDrafts((current) => ({
                        ...current,
                        [office.id]: { ...current[office.id], lateGraceMinutes: event.target.value },
                      }))
                    }
                    className="h-12 rounded-2xl border-none bg-surface-container-low"
                    min={0}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Early Leave Grace</Label>
                  <Input
                    type="number"
                    value={draft.earlyLeaveGraceMinutes}
                    onChange={(event) =>
                      setOfficeDrafts((current) => ({
                        ...current,
                        [office.id]: { ...current[office.id], earlyLeaveGraceMinutes: event.target.value },
                      }))
                    }
                    className="h-12 rounded-2xl border-none bg-surface-container-low"
                    min={0}
                  />
                </div>
                <div className="space-y-2 md:col-span-2 xl:col-span-4">
                  <Label>Workdays</Label>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                      const label = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day - 1]
                      const active = draft.workdays.includes(day)
                      return (
                        <Button
                          key={`${office.id}-${day}`}
                          type="button"
                          variant={active ? "default" : "outline"}
                          className="h-10 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]"
                          onClick={() =>
                            setOfficeDrafts((current) => ({
                              ...current,
                              [office.id]: {
                                ...current[office.id],
                                workdays: current[office.id].workdays.includes(day)
                                  ? current[office.id].workdays.filter((value) => value !== day)
                                  : [...current[office.id].workdays, day].sort((left, right) => left - right),
                              },
                            }))
                          }
                        >
                          {label}
                        </Button>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <GeofenceMapPicker
                  latitude={draft.latitude ? Number(draft.latitude) : null}
                  longitude={draft.longitude ? Number(draft.longitude) : null}
                  radiusMeters={Number(draft.radiusMeters) || office.radiusMeters}
                  onChange={(coords) => {
                    void handleExistingOfficeMapChange(office.id, coords)
                  }}
                />
              </div>

              <div className="mt-5 flex items-center gap-3 rounded-[1.5rem] bg-surface-container-low p-4">
                <Switch
                  checked={draft.isActive}
                  onCheckedChange={(checked) =>
                    setOfficeDrafts((current) => ({
                      ...current,
                      [office.id]: { ...current[office.id], isActive: checked },
                    }))
                  }
                />
                <div>
                  <p className="text-sm font-bold text-on-surface">Office is active</p>
                  <p className="text-xs font-medium text-on-surface-variant/55">
                    Only active offices can be matched by the attendance API.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-[1.5rem] bg-surface-container-low p-4 text-xs font-medium text-on-surface-variant/65">
                Shift policy: {draft.shiftStartTime} - {draft.shiftEndTime} · TZ {draft.timezone} · Grace late{" "}
                {draft.lateGraceMinutes}m · Early leave grace {draft.earlyLeaveGraceMinutes}m · Workdays{" "}
                {formatWorkdays(draft.workdays)}
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
              Approval queue
            </p>
            <h3 className="mt-1 text-2xl font-headline font-black tracking-tight text-on-surface">
              Review attendance requests
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Pending {requestSummary.pending}</Badge>
            <Badge variant="outline">Approved {requestSummary.approved}</Badge>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-5">
          <div className="space-y-2 md:col-span-5">
            <Label>Search</Label>
            <Input
              value={requestSearch}
              onChange={(event) => setRequestSearch(event.target.value)}
              className="h-11 rounded-2xl border-none bg-surface-container-low"
              placeholder="Search by name, email, team, type, or reason..."
            />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <select
              value={requestFilters.status}
              onChange={(event) => setRequestFilters((current) => ({ ...current, status: event.target.value }))}
              className="h-11 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-semibold text-on-surface outline-none"
            >
              <option value="all">All status</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELED">Canceled</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <select
              value={requestFilters.type}
              onChange={(event) => setRequestFilters((current) => ({ ...current, type: event.target.value }))}
              className="h-11 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-semibold text-on-surface outline-none"
            >
              <option value="all">All type</option>
              <option value="LEAVE">Leave</option>
              <option value="SICK">Sick</option>
              <option value="PERMIT">Permit</option>
              <option value="DAY_OFF">Day-Off</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Month</Label>
            <Input
              type="month"
              value={requestFilters.month}
              onChange={(event) => setRequestFilters((current) => ({ ...current, month: event.target.value || currentMonthKey }))}
              className="h-11 rounded-2xl border-none bg-surface-container-low"
            />
          </div>
          <div className="space-y-2">
            <Label>User</Label>
            <select
              value={requestFilters.userId}
              onChange={(event) => setRequestFilters((current) => ({ ...current, userId: event.target.value }))}
              className="h-11 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-semibold text-on-surface outline-none"
            >
              <option value="all">All users</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Review Note</Label>
            <Input
              value={requestReviewNote}
              onChange={(event) => setRequestReviewNote(event.target.value)}
              className="h-11 rounded-2xl border-none bg-surface-container-low"
              placeholder="Optional note..."
            />
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {filteredRequests.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-on-surface-variant/15 bg-surface-container p-5 text-sm font-medium text-on-surface-variant/55">
              No attendance requests matched the current filters.
            </div>
          ) : (
            filteredRequests.map((request) => (
              <div key={request.id} className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-on-surface">{request.user.name} · {request.type.replaceAll("_", " ")}</p>
                    <p className="mt-1 text-xs font-medium text-on-surface-variant/55">
                      {formatDateKey(request.startDate)}{request.endDate.slice(0, 10) !== request.startDate.slice(0, 10) ? ` - ${formatDateKey(request.endDate)}` : ""}
                    </p>
                    {request.team && (
                      <p className="mt-1 text-xs font-medium text-on-surface-variant/45">
                        Team: {request.team.name}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={request.status === "APPROVED" ? "success" : request.status === "REJECTED" ? "destructive" : request.status === "CANCELED" ? "outline" : "warning"}>
                      {request.status}
                    </Badge>
                    {request.approvalSource && <Badge variant="outline">{request.approvalSource.replaceAll("_", " ")}</Badge>}
                  </div>
                </div>
                <p className="mt-3 text-sm font-medium text-on-surface-variant/65">{request.reason}</p>
                {request.supportingDocumentUrl && (
                  <Button asChild variant="outline" className="mt-3 h-9 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]">
                    <Link href={request.supportingDocumentUrl} target="_blank">Open Document</Link>
                  </Button>
                )}
                {request.status === "PENDING" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      className="h-10 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]"
                      onClick={() => void handleReviewRequest(request.id, "approve")}
                      disabled={updatingRequestId === request.id}
                    >
                      {updatingRequestId === request.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]"
                      onClick={() => void handleReviewRequest(request.id, "reject")}
                      disabled={updatingRequestId === request.id}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
              Daily recap
            </p>
            <h3 className="mt-1 text-2xl font-headline font-black tracking-tight text-on-surface">
              Review attendance activity
            </h3>
          </div>
          <Button asChild variant="outline" className="h-11 rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em]">
            <a href={exportHref}>
              <Download className="mr-2 h-4 w-4" />
              Export Sheet
            </a>
          </Button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[1.5rem] bg-surface-container-low p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
              Total rows
            </p>
            <p className="mt-2 text-lg font-black tracking-tight text-on-surface">{recapSummary.total}</p>
          </div>
          <div className="rounded-[1.5rem] bg-surface-container-low p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
              On time
            </p>
            <p className="mt-2 text-lg font-black tracking-tight text-on-surface">{recapSummary.onTime}</p>
          </div>
          <div className="rounded-[1.5rem] bg-surface-container-low p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
              Late
            </p>
            <p className="mt-2 text-lg font-black tracking-tight text-on-surface">{recapSummary.late}</p>
          </div>
          <div className="rounded-[1.5rem] bg-surface-container-low p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
              Early leave
            </p>
            <p className="mt-2 text-lg font-black tracking-tight text-on-surface">{recapSummary.earlyLeave}</p>
          </div>
          <div className="rounded-[1.5rem] bg-surface-container-low p-4 md:col-span-2 xl:col-span-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
              Worked time total
            </p>
            <p className="mt-2 text-lg font-black tracking-tight text-on-surface">{formatMinutes(recapSummary.workedMinutes)}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2 md:col-span-2 xl:col-span-4">
            <Label>Search</Label>
            <Input
              value={recapSearch}
              onChange={(event) => setRecapSearch(event.target.value)}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
              placeholder="Search by personnel name, email, office, team, or attendance type..."
            />
          </div>
          <div className="space-y-2">
            <Label>Month</Label>
            <Input
              type="month"
              value={filters.month}
              onChange={(event) => {
                const month = event.target.value || currentMonthKey
                const range = monthToDateRange(month)
                setFilters((current) => ({
                  ...current,
                  month,
                  dateFrom: range.dateFrom,
                  dateTo: range.dateTo,
                }))
              }}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
            />
          </div>
          <div className="space-y-2">
            <Label>Date From</Label>
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
            />
          </div>
          <div className="space-y-2">
            <Label>Date To</Label>
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
              className="h-12 rounded-2xl border-none bg-surface-container-low"
            />
          </div>
          <div className="space-y-2">
            <Label>Office Filter</Label>
            <select
              value={filters.officeLocationId}
              onChange={(event) => setFilters((current) => ({ ...current, officeLocationId: event.target.value }))}
              className="h-12 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-semibold text-on-surface outline-none"
            >
              <option value="all">All offices</option>
              {offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>User Filter</Label>
            <select
              value={filters.userId}
              onChange={(event) => setFilters((current) => ({ ...current, userId: event.target.value }))}
              className="h-12 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-semibold text-on-surface outline-none"
            >
              <option value="all">All personnel</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Status Filter</Label>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              className="h-12 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-semibold text-on-surface outline-none"
            >
              <option value="all">All status</option>
              <option value="COMPLETED">Completed</option>
              <option value="CHECKED_IN">Checked In</option>
              <option value="INCOMPLETE">Incomplete</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Check In Status</Label>
            <select
              value={filters.checkInStatus}
              onChange={(event) => setFilters((current) => ({ ...current, checkInStatus: event.target.value }))}
              className="h-12 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-semibold text-on-surface outline-none"
            >
              <option value="all">All check in</option>
              <option value="ON_TIME">On time</option>
              <option value="LATE">Late</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Check Out Status</Label>
            <select
              value={filters.checkOutStatus}
              onChange={(event) => setFilters((current) => ({ ...current, checkOutStatus: event.target.value }))}
              className="h-12 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-semibold text-on-surface outline-none"
            >
              <option value="all">All check out</option>
              <option value="ON_TIME">On time</option>
              <option value="EARLY_LEAVE">Early leave</option>
              <option value="OVERTIME">Overtime</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Correction</Label>
            <select
              value={filters.isCorrected}
              onChange={(event) => setFilters((current) => ({ ...current, isCorrected: event.target.value }))}
              className="h-12 w-full rounded-2xl border-none bg-surface-container-low px-4 text-sm font-semibold text-on-surface outline-none"
            >
              <option value="all">All records</option>
              <option value="true">Corrected only</option>
              <option value="false">Not corrected</option>
            </select>
          </div>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <div className="rounded-[1.5rem] bg-surface-container-low p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
              Breakdown by office
            </p>
            <div className="mt-3 space-y-3">
              {officeBreakdown.length === 0 ? (
                <p className="text-sm font-medium text-on-surface-variant/55">No office data for this filter set.</p>
              ) : (
                officeBreakdown.map((item) => (
                  <div key={item.name} className="flex items-center justify-between rounded-2xl bg-surface-container px-4 py-3">
                    <div>
                      <p className="text-sm font-black text-on-surface">{item.name}</p>
                      <p className="text-xs font-medium text-on-surface-variant/55">
                        {item.count} rows · {item.late} late
                      </p>
                    </div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-on-surface-variant/55">
                      {formatMinutes(item.workedMinutes)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[1.5rem] bg-surface-container-low p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
              Breakdown by person
            </p>
            <div className="mt-3 space-y-3">
              {personBreakdown.length === 0 ? (
                <p className="text-sm font-medium text-on-surface-variant/55">No person data for this filter set.</p>
              ) : (
                personBreakdown.map((item) => (
                  <div key={item.name} className="flex items-center justify-between rounded-2xl bg-surface-container px-4 py-3">
                    <div>
                      <p className="text-sm font-black text-on-surface">{item.name}</p>
                      <p className="text-xs font-medium text-on-surface-variant/55">
                        {item.count} rows · {item.late} late · {item.earlyLeave} early leave
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {deferredRecapSearch ? (
            groupedSearchResults.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-on-surface-variant/15 bg-surface-container p-5 text-sm font-medium text-on-surface-variant/55">
                No personnel matched the current search.
              </div>
            ) : (
              groupedSearchResults.map((result) => (
                <div
                  key={result.user.id}
                  className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <h4 className="text-lg font-black tracking-tight text-on-surface">{result.user.name}</h4>
                        <Badge variant="outline">{result.totalRows} rows</Badge>
                        {result.absentRows > 0 ? <Badge variant="destructive">Absent {result.absentRows}</Badge> : null}
                        {result.requestRows > 0 ? <Badge variant="outline">Requests {result.requestRows}</Badge> : null}
                        {result.presentRows > 0 ? <Badge variant="success">Present {result.presentRows}</Badge> : null}
                      </div>
                      <p className="text-xs font-medium text-on-surface-variant/55">{result.user.email}</p>
                      <p className="text-xs font-medium text-on-surface-variant/50">
                        Latest record: {formatDateKey(result.latestDate)}
                      </p>
                      <p className="text-xs font-medium text-on-surface-variant/50">
                        Offices: {Array.from(result.officeNames).join(", ")}
                      </p>
                      {result.teamNames.size > 0 ? (
                        <p className="text-xs font-medium text-on-surface-variant/50">
                          Teams: {Array.from(result.teamNames).join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="rounded-full bg-surface-container-low px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant/50">
                      Grouped search result
                    </div>
                  </div>
                </div>
              ))
            )
          ) : filteredRecords.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-on-surface-variant/15 bg-surface-container p-5 text-sm font-medium text-on-surface-variant/55">
              No attendance records matched the current filters.
            </div>
          ) : (
            filteredRecords.map((record) => (
              <div
                key={record.id}
                className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h4 className="text-lg font-black tracking-tight text-on-surface">{record.user.name}</h4>
                      {record.attendanceDayType && record.attendanceDayType !== "PRESENT" ? (
                        <Badge variant={record.attendanceDayType === "ABSENT" ? "destructive" : "outline"}>
                          {record.attendanceDayType.replaceAll("_", " ")}
                        </Badge>
                      ) : (
                        <Badge variant={getStatusVariant(record.status)}>{record.status.replace("_", " ")}</Badge>
                      )}
                      {record.effectiveShiftSource === "TEAM" && record.effectiveTeamName && (
                        <Badge variant="outline">Team Shift · {record.effectiveTeamName}</Badge>
                      )}
                      {record.recordKind === "ATTENDANCE" && record.checkInStatus && (
                        <Badge variant={getCheckInVariant(record.checkInStatus)}>
                          In: {record.checkInStatus.replace("_", " ")}
                        </Badge>
                      )}
                      {record.recordKind === "ATTENDANCE" && record.checkOutStatus && (
                        <Badge variant={getCheckOutVariant(record.checkOutStatus)}>
                          Out: {record.checkOutStatus.replace("_", " ")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs font-medium text-on-surface-variant/55">
                      {record.user.email} · {record.officeLocation.name} · {formatDateKey(record.attendanceDate)}
                    </p>
                    {record.officeLocation.address && (
                      <p className="text-xs font-medium text-on-surface-variant/50">
                        {record.officeLocation.address}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 rounded-full bg-surface-container-low px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant/50">
                    <Users className="h-3.5 w-3.5" />
                    Radius {record.officeLocation.radiusMeters}m
                  </div>
                </div>

                {record.recordKind === "ATTENDANCE" ? (
                  <div className="mt-4 grid gap-2 text-xs font-medium text-on-surface-variant/60 sm:grid-cols-2 xl:grid-cols-4">
                    <p>Check in: {formatDateTime(record.checkInAt)}</p>
                    <p>Check out: {formatDateTime(record.checkOutAt)}</p>
                    <p>Worked: {formatMinutes(record.workedMinutes)}</p>
                    <p>Late: {formatMinutes(record.lateMinutes)}</p>
                    <p>Early leave: {formatMinutes(record.earlyLeaveMinutes)}</p>
                    <p>In distance: {formatDistance(record.checkInDistanceMeters)}</p>
                    <p>Out distance: {formatDistance(record.checkOutDistanceMeters)}</p>
                    {record.effectiveShiftStartTime && record.effectiveShiftEndTime && (
                      <p>Shift: {record.effectiveShiftStartTime} - {record.effectiveShiftEndTime}</p>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 grid gap-2 text-xs font-medium text-on-surface-variant/60 sm:grid-cols-2 xl:grid-cols-4">
                    <p>Type: {record.requestType?.replaceAll("_", " ") ?? "Absent"}</p>
                    <p>Approval: {record.approvalSource?.replaceAll("_", " ") ?? "System"}</p>
                    {record.reviewedBy && <p>Reviewed by: {record.reviewedBy.name}</p>}
                    {record.reviewedAt && <p>Reviewed at: {formatDateTime(record.reviewedAt)}</p>}
                  </div>
                )}
                {record.isCorrected && (
                  <div className="mt-3 rounded-2xl bg-surface-container-low px-3 py-3 text-xs font-medium text-on-surface-variant/70">
                    <p className="font-black uppercase tracking-[0.18em] text-on-surface-variant/45">Corrected</p>
                    <p className="mt-1">
                      {record.correctedBy?.name ?? "Admin"} · {formatDateTime(record.correctedAt)}
                    </p>
                    {record.correctionReason && <p className="mt-1">{record.correctionReason}</p>}
                  </div>
                )}
                {record.notes && (
                  <p className="mt-3 rounded-2xl bg-surface-container-low px-3 py-2 text-xs font-medium text-on-surface-variant/70">
                    {record.notes}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]"
                    onClick={() => setSelectedRecapRecord(record)}
                  >
                    View Report
                  </Button>
                  {record.recordKind === "ATTENDANCE" ? (
                    <Button asChild variant="outline" className="h-10 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]">
                      <Link href={`/attendance/${record.id}`}>Open Detail Page</Link>
                    </Button>
                  ) : record.supportingDocumentUrl ? (
                    <Button asChild variant="outline" className="h-10 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]">
                      <Link href={record.supportingDocumentUrl} target="_blank">Open Document</Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Dialog open={Boolean(selectedRecapRecord)} onOpenChange={(open) => !open && setSelectedRecapRecord(null)}>
        <DialogContent className="max-h-[calc(100dvh_-_1rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] overflow-y-auto rounded-[2rem] border-none bg-surface-container-lowest p-0 shadow-2xl sm:max-w-4xl">
          {selectedRecapRecord ? (
            <div className="p-6 sm:p-8">
              <DialogHeader className="space-y-3 text-left">
                <DialogTitle className="text-2xl font-headline font-black tracking-tight text-on-surface">
                  {selectedRecapRecord.user.name}
                </DialogTitle>
                <DialogDescription className="text-sm font-medium text-on-surface-variant/60">
                  {selectedRecapRecord.user.email} · {selectedRecapRecord.officeLocation.name} · {formatDateKey(selectedRecapRecord.attendanceDate)}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {selectedRecapRecord.attendanceDayType && selectedRecapRecord.attendanceDayType !== "PRESENT" ? (
                  <Badge variant={selectedRecapRecord.attendanceDayType === "ABSENT" ? "destructive" : "outline"}>
                    {selectedRecapRecord.attendanceDayType.replaceAll("_", " ")}
                  </Badge>
                ) : (
                  <Badge variant={getStatusVariant(selectedRecapRecord.status)}>
                    {selectedRecapRecord.status.replaceAll("_", " ")}
                  </Badge>
                )}
                {selectedRecapRecord.effectiveShiftSource === "TEAM" && selectedRecapRecord.effectiveTeamName ? (
                  <Badge variant="outline">Team Shift · {selectedRecapRecord.effectiveTeamName}</Badge>
                ) : null}
                {selectedRecapRecord.recordKind === "ATTENDANCE" && selectedRecapRecord.checkInStatus ? (
                  <Badge variant={getCheckInVariant(selectedRecapRecord.checkInStatus)}>
                    In: {selectedRecapRecord.checkInStatus.replaceAll("_", " ")}
                  </Badge>
                ) : null}
                {selectedRecapRecord.recordKind === "ATTENDANCE" && selectedRecapRecord.checkOutStatus ? (
                  <Badge variant={getCheckOutVariant(selectedRecapRecord.checkOutStatus)}>
                    Out: {selectedRecapRecord.checkOutStatus.replaceAll("_", " ")}
                  </Badge>
                ) : null}
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-[1.5rem] bg-surface-container p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Office</p>
                  <p className="mt-2 text-sm font-black text-on-surface">{selectedRecapRecord.officeLocation.name}</p>
                </div>
                <div className="rounded-[1.5rem] bg-surface-container p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Radius</p>
                  <p className="mt-2 text-sm font-black text-on-surface">{selectedRecapRecord.officeLocation.radiusMeters}m</p>
                </div>
                <div className="rounded-[1.5rem] bg-surface-container p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Shift Source</p>
                  <p className="mt-2 text-sm font-black text-on-surface">
                    {selectedRecapRecord.effectiveShiftSource === "TEAM" ? "Team Override" : "Office Default"}
                  </p>
                </div>
              </div>

              {selectedRecapRecord.officeLocation.address ? (
                <div className="mt-4 rounded-[1.5rem] bg-surface-container p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Office Address</p>
                  <p className="mt-2 text-sm font-medium text-on-surface-variant/70">{selectedRecapRecord.officeLocation.address}</p>
                </div>
              ) : null}

              {selectedRecapRecord.recordKind === "ATTENDANCE" ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-[1.5rem] bg-surface-container p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Check In</p>
                    <p className="mt-2 text-sm font-black text-on-surface">{formatDateTime(selectedRecapRecord.checkInAt)}</p>
                  </div>
                  <div className="rounded-[1.5rem] bg-surface-container p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Check Out</p>
                    <p className="mt-2 text-sm font-black text-on-surface">{formatDateTime(selectedRecapRecord.checkOutAt)}</p>
                  </div>
                  <div className="rounded-[1.5rem] bg-surface-container p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Worked Time</p>
                    <p className="mt-2 text-sm font-black text-on-surface">{formatMinutes(selectedRecapRecord.workedMinutes)}</p>
                  </div>
                  <div className="rounded-[1.5rem] bg-surface-container p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Late</p>
                    <p className="mt-2 text-sm font-black text-on-surface">{formatMinutes(selectedRecapRecord.lateMinutes)}</p>
                  </div>
                  <div className="rounded-[1.5rem] bg-surface-container p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Early Leave</p>
                    <p className="mt-2 text-sm font-black text-on-surface">{formatMinutes(selectedRecapRecord.earlyLeaveMinutes)}</p>
                  </div>
                  <div className="rounded-[1.5rem] bg-surface-container p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Shift Window</p>
                    <p className="mt-2 text-sm font-black text-on-surface">
                      {selectedRecapRecord.effectiveShiftStartTime && selectedRecapRecord.effectiveShiftEndTime
                        ? `${selectedRecapRecord.effectiveShiftStartTime} - ${selectedRecapRecord.effectiveShiftEndTime}`
                        : "Not recorded"}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] bg-surface-container p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Check In Distance</p>
                    <p className="mt-2 text-sm font-black text-on-surface">{formatDistance(selectedRecapRecord.checkInDistanceMeters)}</p>
                  </div>
                  <div className="rounded-[1.5rem] bg-surface-container p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Check Out Distance</p>
                    <p className="mt-2 text-sm font-black text-on-surface">{formatDistance(selectedRecapRecord.checkOutDistanceMeters)}</p>
                  </div>
                  <div className="rounded-[1.5rem] bg-surface-container p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Status</p>
                    <p className="mt-2 text-sm font-black text-on-surface">{selectedRecapRecord.status.replaceAll("_", " ")}</p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-[1.5rem] bg-surface-container p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Record Type</p>
                    <p className="mt-2 text-sm font-black text-on-surface">{selectedRecapRecord.requestType?.replaceAll("_", " ") ?? "Absent"}</p>
                  </div>
                  <div className="rounded-[1.5rem] bg-surface-container p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Approval</p>
                    <p className="mt-2 text-sm font-black text-on-surface">{selectedRecapRecord.approvalSource?.replaceAll("_", " ") ?? "System"}</p>
                  </div>
                  <div className="rounded-[1.5rem] bg-surface-container p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Reviewed At</p>
                    <p className="mt-2 text-sm font-black text-on-surface">{formatDateTime(selectedRecapRecord.reviewedAt ?? null)}</p>
                  </div>
                  {selectedRecapRecord.reviewedBy ? (
                    <div className="rounded-[1.5rem] bg-surface-container p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Reviewed By</p>
                      <p className="mt-2 text-sm font-black text-on-surface">{selectedRecapRecord.reviewedBy.name}</p>
                    </div>
                  ) : null}
                </div>
              )}

              {selectedRecapRecord.checkInAddress || selectedRecapRecord.checkOutAddress ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {selectedRecapRecord.checkInAddress ? (
                    <div className="rounded-[1.5rem] bg-surface-container p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Check In Address</p>
                      <p className="mt-2 text-sm font-medium text-on-surface-variant/70">{selectedRecapRecord.checkInAddress}</p>
                    </div>
                  ) : null}
                  {selectedRecapRecord.checkOutAddress ? (
                    <div className="rounded-[1.5rem] bg-surface-container p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Check Out Address</p>
                      <p className="mt-2 text-sm font-medium text-on-surface-variant/70">{selectedRecapRecord.checkOutAddress}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {selectedRecapRecord.supportingDocumentUrl ? (
                <div className="mt-4">
                  <Button asChild variant="outline" className="h-10 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]">
                    <Link href={selectedRecapRecord.supportingDocumentUrl} target="_blank">Open Document</Link>
                  </Button>
                </div>
              ) : null}

              {selectedRecapRecord.notes ? (
                <div className="mt-4 rounded-[1.5rem] bg-surface-container p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Notes</p>
                  <p className="mt-2 text-sm font-medium text-on-surface-variant/70">{selectedRecapRecord.notes}</p>
                </div>
              ) : null}

              {selectedRecapRecord.isCorrected ? (
                <div className="mt-4 rounded-[1.5rem] bg-surface-container p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">Correction Log</p>
                  <p className="mt-2 text-sm font-medium text-on-surface-variant/70">
                    {selectedRecapRecord.correctedBy?.name ?? "Admin"} · {formatDateTime(selectedRecapRecord.correctedAt)}
                  </p>
                  {selectedRecapRecord.correctionReason ? (
                    <p className="mt-2 text-sm font-medium text-on-surface-variant/70">{selectedRecapRecord.correctionReason}</p>
                  ) : null}
                </div>
              ) : null}

              {selectedRecapRecord.recordKind === "ATTENDANCE" ? (
                <div className="mt-5">
                  <Button asChild variant="outline" className="h-10 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]">
                    <Link href={`/attendance/${selectedRecapRecord.id}`}>Open Detail Page</Link>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
