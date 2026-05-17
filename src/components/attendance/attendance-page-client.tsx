"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  Building2,
  Camera,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  LocateFixed,
  MapPin,
  Paperclip,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toastError, toastSuccess } from "@/lib/toast"
import { cn } from "@/lib/utils"

type AttendanceStatus = "CHECKED_IN" | "COMPLETED" | "INCOMPLETE"

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
  checkInLat: number | null
  checkInLng: number | null
  checkOutLat: number | null
  checkOutLng: number | null
  checkInAddress: string | null
  checkOutAddress: string | null
  checkInPhotoUrl: string | null
  checkOutPhotoUrl: string | null
  checkInDistanceMeters: number | null
  checkOutDistanceMeters: number | null
  notes: string | null
  status: AttendanceStatus
  correctedAt: string | null
  correctionReason: string | null
  effectiveShiftSource: "OFFICE" | "TEAM"
  effectiveTeamId: string | null
  effectiveTeamName: string | null
  effectiveShiftStartTime: string | null
  effectiveShiftEndTime: string | null
  officeLocation: {
    id: string
    name: string
    address: string | null
    latitude: number
    longitude: number
    radiusMeters: number
    isActive: boolean
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
  attendanceDayType: "LEAVE_APPROVED" | "SICK_APPROVED" | "PERMIT_APPROVED" | "DAY_OFF_APPROVED" | null
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

type TodayResponse = {
  attendanceDateKey: string
  workspace: { id: string; name: string; slug: string } | null
  activeOfficeCount: number
  today: AttendanceRecord | null
  todayRequest: AttendanceRequest | null
  dayOffUsedThisMonth: number
  canManageAttendance: boolean
  canReviewAttendanceRequests?: boolean
}

type HistoryResponse = {
  records: AttendanceRecord[]
}

type RequestsResponse = {
  requests: AttendanceRequest[]
  dayOffUsedThisMonth: number
}

type AttendancePageClientProps = {
  user: {
    id: string
    name: string
    email: string
  }
  workspace: { id: string; name: string; slug: string } | null
}

type GeoState = {
  lat: number
  lng: number
  accuracy: number | null
  capturedAt: number
}
const ATTENDANCE_TIMEZONE = "Asia/Jakarta"
const GPS_FRESHNESS_MS = 3 * 60 * 1000

const GEOLOCATION_ERROR_MESSAGES: Record<number, string> = {
  1: "Browser denied location access for this tab. If Nexus is already allowed, fully reload this page or reopen Safari, then tap Capture GPS again.",
  2: "GPS signal is unavailable right now. Move near a window or open area, then try Capture GPS again.",
  3: "GPS capture timed out. Keep Safari open on this page and try again.",
}

function isGeolocationPositionError(error: unknown): error is GeolocationPositionError {
  return typeof error === "object" && error !== null && "code" in error
}

function getGeolocationErrorMessage(error: unknown) {
  if (isGeolocationPositionError(error)) {
    return GEOLOCATION_ERROR_MESSAGES[error.code] || error.message || "Unable to resolve location"
  }

  return error instanceof Error ? error.message : "Unable to resolve location"
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function getGeolocationPermissionState(): Promise<PermissionState | "unsupported" | "unknown"> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unsupported"
  }

  try {
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    })
    return status.state
  } catch {
    return "unknown"
  }
}

function getCurrentPosition(options: PositionOptions) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options)
  })
}

function watchPositionOnce(options: PositionOptions, targetAccuracyMeters = 150) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    let bestPosition: GeolocationPosition | null = null
    let watchId: number | null = null
    let settled = false

    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId)
      }
      callback()
    }

    const timeout = window.setTimeout(() => {
      settle(() => {
        if (bestPosition) {
          resolve(bestPosition)
          return
        }

        reject(new Error("GPS capture timed out. Keep Safari open on this page and try again."))
      })
    }, options.timeout ?? 25000)

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const accuracy = position.coords.accuracy ?? Number.POSITIVE_INFINITY
        const bestAccuracy = bestPosition?.coords.accuracy ?? Number.POSITIVE_INFINITY

        if (!bestPosition || accuracy < bestAccuracy) {
          bestPosition = position
        }

        if (accuracy <= targetAccuracyMeters) {
          window.clearTimeout(timeout)
          settle(() => resolve(position))
        }
      },
      (error) => {
        window.clearTimeout(timeout)
        settle(() => reject(error))
      },
      options
    )
  })
}

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

function formatDay(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: ATTENDANCE_TIMEZONE,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value))
}

function formatDistance(value: number | null) {
  if (value === null || Number.isNaN(value)) return "Unknown"
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`
  return `${Math.round(value)} m`
}

function statusBadgeVariant(status: AttendanceStatus) {
  switch (status) {
    case "COMPLETED":
      return "success" as const
    case "INCOMPLETE":
      return "destructive" as const
    default:
      return "warning" as const
  }
}

function attendanceMetricVariant(status: AttendanceRecord["checkInStatus"] | AttendanceRecord["checkOutStatus"]) {
  if (status === "LATE" || status === "EARLY_LEAVE") return "destructive" as const
  if (status === "OVERTIME") return "warning" as const
  if (status === "ON_TIME") return "success" as const
  return "outline" as const
}

function shouldUseNativeCameraPicker() {
  if (typeof navigator === "undefined") return false
  const userAgent = navigator.userAgent || ""
  const isTouchDevice = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
  return isTouchDevice || /iPad|iPhone|iPod|Android/i.test(userAgent)
}

async function parseResponseError(response: Response) {
  try {
    const payload = await response.json()
    if (payload?.error) return payload.error as string
    if (payload?.details) return "Validation failed"
  } catch {
    // noop
  }
  return "Request failed"
}

export function AttendancePageClient({ user, workspace }: AttendancePageClientProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const requestDocumentInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [todayData, setTodayData] = useState<TodayResponse | null>(null)
  const [history, setHistory] = useState<AttendanceRecord[]>([])
  const [requests, setRequests] = useState<AttendanceRequest[]>([])
  const [approvalRequests, setApprovalRequests] = useState<AttendanceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [submittingAction, setSubmittingAction] = useState<"check-in" | "check-out" | null>(null)
  const [submittingRequest, setSubmittingRequest] = useState(false)
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraStarting, setCameraStarting] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [requestForm, setRequestForm] = useState({
    type: "LEAVE" as "LEAVE" | "SICK" | "PERMIT" | "DAY_OFF",
    startDate: new Date().toLocaleDateString("en-CA", { timeZone: ATTENDANCE_TIMEZONE }),
    endDate: new Date().toLocaleDateString("en-CA", { timeZone: ATTENDANCE_TIMEZONE }),
    reason: "",
  })
  const [requestDocument, setRequestDocument] = useState<File | null>(null)
  const [geoState, setGeoState] = useState<GeoState | null>(null)
  const [locationCapturing, setLocationCapturing] = useState(false)
  const [locationMessage, setLocationMessage] = useState("Current location not captured yet.")
  const [historyFilters, setHistoryFilters] = useState({
    month: currentMonthKey,
    status: "all",
  })

  const fetchAttendanceData = useCallback(async (showLoader = false) => {
    if (showLoader) setRefreshing(true)
    try {
      const dateRange = monthToDateRange(historyFilters.month)
      const historySearchParams = new URLSearchParams({
        scope: "me",
        month: historyFilters.month,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
      })

      if (historyFilters.status !== "all") {
        historySearchParams.set("status", historyFilters.status)
      }

      const [todayResponse, historyResponse, requestsResponse] = await Promise.all([
        fetch("/api/attendance/today", { cache: "no-store" }),
        fetch(`/api/attendance/history?${historySearchParams.toString()}`, { cache: "no-store" }),
        fetch(`/api/attendance/requests?scope=me&month=${historyFilters.month}`, { cache: "no-store" }),
      ])

      if (!todayResponse.ok) {
        throw new Error(await parseResponseError(todayResponse))
      }

      if (!historyResponse.ok) {
        throw new Error(await parseResponseError(historyResponse))
      }

      if (!requestsResponse.ok) {
        throw new Error(await parseResponseError(requestsResponse))
      }

      const todayPayload = (await todayResponse.json()) as TodayResponse
      const historyPayload = (await historyResponse.json()) as HistoryResponse
      const requestsPayload = (await requestsResponse.json()) as RequestsResponse

      setTodayData(todayPayload)
      setHistory(historyPayload.records ?? [])
      setRequests(requestsPayload.requests ?? [])

      if (todayPayload.canReviewAttendanceRequests) {
        const approvalResponse = await fetch(
          `/api/attendance/requests?scope=approvals&status=PENDING&month=${historyFilters.month}`,
          { cache: "no-store" }
        )
        if (!approvalResponse.ok) {
          throw new Error(await parseResponseError(approvalResponse))
        }
        const approvalPayload = (await approvalResponse.json()) as RequestsResponse
        setApprovalRequests(approvalPayload.requests ?? [])
      } else {
        setApprovalRequests([])
      }
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Failed to load attendance state")
    } finally {
      setLoading(false)
      if (showLoader) setRefreshing(false)
    }
  }, [historyFilters.month, historyFilters.status])

  useEffect(() => {
    void fetchAttendanceData()
  }, [fetchAttendanceData])

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null)
      return
    }

    const nextPreviewUrl = URL.createObjectURL(selectedFile)
    setPreviewUrl(nextPreviewUrl)

    return () => {
      URL.revokeObjectURL(nextPreviewUrl)
    }
  }, [selectedFile])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setCameraOpen(false)
    setCameraStarting(false)
  }, [])

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  useEffect(() => {
    if (!cameraOpen || !streamRef.current || !videoRef.current) return

    try {
      videoRef.current.srcObject = streamRef.current
      const playPromise = videoRef.current.play()
      if (playPromise) {
        void playPromise.catch(() => {
          setCameraError("Camera preview could not start. Please use the camera upload fallback.")
        })
      }
    } catch {
      setCameraError("Camera preview could not start. Please use the camera upload fallback.")
    }
  }, [cameraOpen])

  const captureLocation = useCallback(async () => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      throw new Error("Location services are not available on this device")
    }

    setLocationCapturing(true)
    setLocationMessage("Resolving your live GPS location...")

    try {
      let position: GeolocationPosition
      const permissionState = await getGeolocationPermissionState()
      if (permissionState === "denied") {
        setLocationMessage("Safari reports location as denied for this tab. Trying a fresh GPS request anyway...")
      }

      try {
        position = await getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0,
        })
      } catch (firstError) {
        if (isGeolocationPositionError(firstError) && firstError.code === firstError.PERMISSION_DENIED) {
          setLocationMessage("Safari denied the high-accuracy request. Trying a lower-accuracy permission refresh...")

          try {
            await wait(700)
            position = await getCurrentPosition({
              enableHighAccuracy: false,
              timeout: 12000,
              maximumAge: 120000,
            })
          } catch (permissionRetryError) {
            throw permissionRetryError
          }
        } else {
          setLocationMessage("GPS is taking longer than usual. Trying Safari-compatible live tracking...")

          try {
            position = await watchPositionOnce({
              enableHighAccuracy: true,
              timeout: 30000,
              maximumAge: 0,
            })
          } catch (secondError) {
            if (isGeolocationPositionError(secondError) && secondError.code === secondError.PERMISSION_DENIED) {
              setLocationMessage("Safari denied live GPS tracking. Trying lower-accuracy GPS fallback...")

              await wait(700)
              position = await getCurrentPosition({
                enableHighAccuracy: false,
                timeout: 12000,
                maximumAge: 120000,
              })
            } else {
              setLocationMessage("Trying a lower-accuracy GPS fallback...")
              position = await getCurrentPosition({
                enableHighAccuracy: false,
                timeout: 15000,
                maximumAge: 60000,
              })
            }
          }
        }
      }

      const lat = position.coords.latitude
      const lng = position.coords.longitude

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error("Browser returned an invalid GPS coordinate. Please try Capture GPS again.")
      }

      const nextGeoState = {
        lat,
        lng,
        accuracy: position.coords.accuracy ?? null,
        capturedAt: Date.now(),
      }

      setGeoState(nextGeoState)
      setLocationMessage(
        `GPS ready at ${nextGeoState.lat.toFixed(5)}, ${nextGeoState.lng.toFixed(5)}${
          nextGeoState.accuracy ? ` (accuracy ~${Math.round(nextGeoState.accuracy)}m)` : ""
        }`
      )

      return nextGeoState
    } catch (error) {
      const message = getGeolocationErrorMessage(error)
      setLocationMessage(message)
      throw new Error(message)
    } finally {
      setLocationCapturing(false)
    }
  }, [])

  const handlePickSelfie = useCallback(async () => {
    if (shouldUseNativeCameraPicker()) {
      setCameraError(null)
      stopCamera()
      cameraInputRef.current?.click()
      return
    }

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      cameraInputRef.current?.click()
      return
    }

    setCameraError(null)
    setCameraStarting(true)

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })

      streamRef.current = mediaStream
      setCameraOpen(true)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Camera access could not be started. You can still upload a selfie manually."
      setCameraError(message)
      cameraInputRef.current?.click()
    } finally {
      setCameraStarting(false)
    }
  }, [stopCamera])

  const captureSelfieFromCamera = useCallback(async () => {
    try {
      const video = videoRef.current
      if (!video || video.readyState < 2) {
        toastError("Camera preview is not ready yet")
        return
      }

      const width = video.videoWidth || 1280
      const height = video.videoHeight || 720
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height

      const context = canvas.getContext("2d")
      if (!context) {
        toastError("Failed to prepare camera capture")
        return
      }

      context.drawImage(video, 0, 0, width, height)

      const blob = await new Promise<Blob | null>((resolve) => {
        if (canvas.toBlob) {
          canvas.toBlob(resolve, "image/jpeg", 0.92)
          return
        }

        fetch(canvas.toDataURL("image/jpeg", 0.92))
          .then((response) => response.blob())
          .then(resolve)
          .catch(() => resolve(null))
      })

      if (!blob) {
        toastError("Failed to capture selfie from camera")
        return
      }

      const file = new File([blob], `attendance-selfie-${Date.now()}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      })

      setSelectedFile(file)
      stopCamera()
      toastSuccess("Selfie captured from camera")
    } catch {
      toastError("Camera capture failed. Please use Upload file instead.")
      stopCamera()
    }
  }, [stopCamera])

  const handleSelfieFileChange = useCallback((file: File | null) => {
    setSelectedFile(file)
    if (file) {
      setCameraError(null)
      stopCamera()
    }
  }, [stopCamera])

  const clearCapture = useCallback(() => {
    setSelectedFile(null)
    setNotes("")
    setCameraError(null)
    stopCamera()
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [stopCamera])

  const clearRequestDraft = useCallback(() => {
    setRequestForm((current) => ({
      ...current,
      reason: "",
    }))
    setRequestDocument(null)
    if (requestDocumentInputRef.current) {
      requestDocumentInputRef.current.value = ""
    }
  }, [])

  const submitAttendance = useCallback(
    async (action: "check-in" | "check-out") => {
      if (!selectedFile) {
        toastError("Selfie is required before sending attendance")
        return
      }

      setSubmittingAction(action)
      try {
        const hasFreshLocation = geoState && Date.now() - geoState.capturedAt <= GPS_FRESHNESS_MS
        const currentLocation = hasFreshLocation ? geoState : await captureLocation()

        const formData = new FormData()
        formData.append("selfie", selectedFile)
        formData.append("lat", String(currentLocation.lat))
        formData.append("lng", String(currentLocation.lng))
        if (notes.trim()) {
          formData.append("notes", notes.trim())
        }

        const response = await fetch(`/api/attendance/${action}`, {
          method: "POST",
          body: formData,
        })

        if (!response.ok) {
          throw new Error(await parseResponseError(response))
        }

        const payload = await response.json()
        toastSuccess(
          action === "check-in"
            ? `Check-in recorded for ${payload.record.officeLocation.name}`
            : `Check-out recorded for ${payload.record.officeLocation.name}`
        )

        clearCapture()
        await fetchAttendanceData()
      } catch (error) {
        toastError(error instanceof Error ? error.message : "Failed to submit attendance")
      } finally {
        setSubmittingAction(null)
      }
    },
    [captureLocation, clearCapture, fetchAttendanceData, geoState, notes, selectedFile]
  )

  const submitAttendanceRequest = useCallback(async () => {
    setSubmittingRequest(true)
    try {
      const formData = new FormData()
      formData.append("type", requestForm.type)
      formData.append("startDate", requestForm.startDate)
      formData.append("endDate", requestForm.endDate)
      formData.append("reason", requestForm.reason.trim())
      if (requestDocument) {
        formData.append("supportingDocument", requestDocument)
      }

      const response = await fetch("/api/attendance/requests", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        throw new Error(await parseResponseError(response))
      }

      toastSuccess(`${requestForm.type.replace("_", " ")} request submitted`)
      clearRequestDraft()
      await fetchAttendanceData()
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Failed to submit attendance request")
    } finally {
      setSubmittingRequest(false)
    }
  }, [clearRequestDraft, fetchAttendanceData, requestDocument, requestForm])

  const updateAttendanceRequest = useCallback(
    async (requestId: string, action: "approve" | "reject" | "cancel") => {
      setUpdatingRequestId(requestId)
      try {
        const response = await fetch(`/api/attendance/requests/${requestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        })

        if (!response.ok) {
          throw new Error(await parseResponseError(response))
        }

        toastSuccess("Attendance request updated")
        await fetchAttendanceData()
      } catch (error) {
        toastError(error instanceof Error ? error.message : "Failed to update attendance request")
      } finally {
        setUpdatingRequestId(null)
      }
    },
    [fetchAttendanceData]
  )

  const latestPhoto = todayData?.today?.checkOutPhotoUrl || todayData?.today?.checkInPhotoUrl || null
  const nextAction = todayData?.today?.status === "CHECKED_IN" ? "check-out" : "check-in"
  const actionLocked = todayData?.today?.status === "COMPLETED" || Boolean(todayData?.todayRequest)
  const todayStatusLabel = todayData?.today?.status
    ? todayData.today.status.replace("_", " ")
    : "NOT CHECKED IN"

  const helperCards = useMemo(
    () => [
      {
        label: "Workspace",
        value: todayData?.workspace?.name ?? workspace?.name ?? "No workspace found",
        icon: Building2,
      },
      {
        label: "Active Offices",
        value: String(todayData?.activeOfficeCount ?? 0),
        icon: MapPin,
      },
      {
        label: "Today",
        value: todayData?.attendanceDateKey ?? "Waiting...",
        icon: Clock3,
      },
    ],
    [todayData, workspace]
  )

  const historySummary = useMemo(() => {
    return history.reduce(
      (accumulator, record) => {
        accumulator.total += 1
        if (record.attendanceDayType === "ABSENT") accumulator.absent += 1
        if (record.recordKind === "REQUEST") accumulator.requests += 1
        if (record.status === "COMPLETED" && record.recordKind === "ATTENDANCE") accumulator.completed += 1
        if (record.status === "CHECKED_IN") accumulator.checkedIn += 1
        if (record.status === "INCOMPLETE") accumulator.incomplete += 1
        return accumulator
      },
      { total: 0, completed: 0, checkedIn: 0, incomplete: 0, absent: 0, requests: 0 }
    )
  }, [history])

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-24 sm:space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] tracking-[0.22em]">
            Attendance
          </Badge>
          {todayData?.today && (
            <Badge variant={statusBadgeVariant(todayData.today.status)} className="rounded-full px-3 py-1">
              {todayStatusLabel}
            </Badge>
          )}
        </div>
        <h1 className="text-3xl font-headline font-black tracking-tight text-on-surface sm:text-5xl">
          Daily Attendance
        </h1>
        <p className="max-w-3xl text-sm font-medium text-on-surface-variant/60 sm:text-base">
          Check in and check out with live GPS plus a selfie. NEXUS will automatically validate the
          nearest office geofence before recording today&apos;s attendance.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {helperCards.map((card) => (
          <div
            key={card.label}
            className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm"
          >
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/8 text-primary">
              <card.icon className="h-5 w-5" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-on-surface-variant/40">
              {card.label}
            </p>
            <p className="mt-2 text-lg font-black tracking-tight text-on-surface">{card.value}</p>
          </div>
        ))}
      </div>

      {!workspace && (
        <div className="rounded-[2rem] border border-red-500/20 bg-red-500/5 p-6 text-sm font-medium text-red-600">
          No workspace membership was found for this account, so attendance cannot be recorded yet.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.9fr]">
        <section className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-on-surface-variant/40">
                Today&apos;s status
              </p>
              <h2 className="text-2xl font-headline font-black tracking-tight text-on-surface">
                {todayData?.today ? formatDay(todayData.today.attendanceDate) : "Ready for first check-in"}
              </h2>
              <p className="max-w-2xl text-sm font-medium text-on-surface-variant/60">
                {todayData?.activeOfficeCount
                  ? "Strict geofence is active. We will use your nearest live office automatically."
                  : "An admin still needs to configure at least one active office before attendance can be used."}
              </p>
              {todayData?.todayRequest && (
                <div className="rounded-2xl border border-primary/10 bg-primary/[0.05] px-4 py-3 text-sm font-medium text-on-surface-variant/70">
                  Today is covered by an approved <span className="font-black text-primary">{todayData.todayRequest.type.replace("_", " ")}</span> request.
                </div>
              )}
            </div>
            <Button
              variant="outline"
              className="touch-target w-full rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em] sm:h-11 sm:w-auto"
              onClick={() => void fetchAttendanceData(true)}
              disabled={refreshing}
            >
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[1.75rem] border border-on-surface-variant/10 bg-surface-container p-5">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                    Check in
                  </p>
                  <p className="text-sm font-bold text-on-surface">
                    {formatDateTime(todayData?.today?.checkInAt ?? null)}
                  </p>
                </div>
              </div>
              <div className="text-sm text-on-surface-variant/65">
                <p className="font-semibold text-on-surface">
                  {todayData?.today?.officeLocation.name ?? "Waiting for office match"}
                </p>
                <p>Distance: {formatDistance(todayData?.today?.checkInDistanceMeters ?? null)}</p>
                {todayData?.today?.effectiveShiftSource === "TEAM" && todayData.today.effectiveTeamName && (
                  <p className="mt-1 text-xs font-semibold text-primary">
                    Team shift override: {todayData.today.effectiveTeamName}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-on-surface-variant/10 bg-surface-container p-5">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Clock3 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                    Check out
                  </p>
                  <p className="text-sm font-bold text-on-surface">
                    {formatDateTime(todayData?.today?.checkOutAt ?? null)}
                  </p>
                </div>
              </div>
              <div className="text-sm text-on-surface-variant/65">
                <p className="font-semibold text-on-surface">
                  {todayData?.today?.checkOutAt ? "Attendance day completed" : "Waiting for checkout"}
                </p>
                <p>Distance: {formatDistance(todayData?.today?.checkOutDistanceMeters ?? null)}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[1.75rem] border border-on-surface-variant/10 bg-surface-container p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                  Action station
                </p>
                <h3 className="mt-1 text-lg font-headline font-black tracking-tight text-on-surface">
                  {todayData?.todayRequest
                    ? `Approved ${todayData.todayRequest.type.replace("_", " ")} request`
                    : actionLocked
                    ? "Your attendance is complete for today"
                    : nextAction === "check-in"
                      ? "Ready to check in"
                      : "Ready to check out"}
                </h3>
              </div>
              <Badge variant="ghost" className="rounded-full px-3 py-1">
                {user.name}
              </Badge>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
              <div className="space-y-4">
                <div className="overflow-hidden rounded-[1.5rem] border border-dashed border-on-surface-variant/15 bg-surface-container-low">
                  {cameraOpen ? (
                    <div className="relative">
                      <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        className="h-56 w-full bg-black object-cover sm:h-64"
                      />
                      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-4">
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/90">
                          Laptop camera is live
                        </p>
                        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex sm:flex-wrap">
                          <Button
                            type="button"
                            variant="outline"
                            className="touch-target rounded-2xl border-white/20 bg-white/10 px-4 text-[11px] font-black uppercase tracking-[0.18em] text-white hover:bg-white/15 sm:h-10 sm:min-h-0"
                            onClick={stopCamera}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            className="touch-target rounded-2xl bg-white px-4 text-[11px] font-black uppercase tracking-[0.18em] text-black hover:bg-white/90 sm:h-10 sm:min-h-0"
                            onClick={() => void captureSelfieFromCamera()}
                          >
                            Capture now
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : previewUrl ? (
                    <Image
                      src={previewUrl}
                      alt="Attendance selfie preview"
                      width={1200}
                      height={900}
                      unoptimized
                      className="h-56 w-full object-cover sm:h-64"
                    />
                  ) : latestPhoto ? (
                    <Image
                      src={latestPhoto}
                      alt="Latest attendance capture"
                      width={1200}
                      height={900}
                      className="h-56 w-full object-cover sm:h-64"
                    />
                  ) : (
                    <div className="flex h-56 flex-col items-center justify-center gap-3 px-6 text-center text-on-surface-variant/50 sm:h-64">
                      <Camera className="h-10 w-10" />
                      <div>
                        <p className="text-sm font-bold text-on-surface">Selfie capture required</p>
                        <p className="mt-1 text-xs font-medium">
                          Use the front camera for check-in and check-out proof.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {cameraError ? (
                  <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 px-4 py-3 text-xs font-medium text-amber-800">
                    {cameraError}
                  </div>
                ) : null}

                <div className="grid gap-3 sm:flex sm:flex-wrap">
                  <Button
                    type="button"
                    className="touch-target rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em] sm:h-11"
                    onClick={handlePickSelfie}
                    disabled={!workspace || actionLocked || cameraStarting}
                  >
                    {cameraStarting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                    {cameraStarting
                      ? "Opening camera"
                      : selectedFile
                        ? "Retake selfie"
                        : "Open camera"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="touch-target rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em] sm:h-11"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!workspace || actionLocked}
                  >
                    <Paperclip className="mr-2 h-4 w-4" />
                    Upload file
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="touch-target rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em] sm:h-11"
                    onClick={() => void captureLocation().catch((error: unknown) => {
                      const message = getGeolocationErrorMessage(error)
                      setLocationMessage(message)
                      toastError(message)
                    })}
                    disabled={!workspace || actionLocked || locationCapturing}
                  >
                    {locationCapturing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LocateFixed className="mr-2 h-4 w-4" />}
                    {locationCapturing ? "Capturing GPS" : "Capture GPS"}
                  </Button>
                </div>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="hidden"
                  onChange={(event) => {
                    handleSelfieFileChange(event.target.files?.[0] ?? null)
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    handleSelfieFileChange(event.target.files?.[0] ?? null)
                  }}
                />
              </div>

              <div className="space-y-4">
                <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container-low p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <MapPin className="h-4 w-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                        Live GPS state
                      </p>
                      <p className="text-sm font-medium text-on-surface-variant/70">{locationMessage}</p>
                      {geoState && (
                        <p className="text-xs font-semibold text-on-surface">
                          {geoState.lat.toFixed(5)}, {geoState.lng.toFixed(5)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container-low p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                    Optional note
                  </p>
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Optional attendance note, field observation, or check-out detail..."
                    rows={5}
                    className="mt-3 rounded-2xl border-none bg-surface-container-lowest text-sm font-medium text-on-surface shadow-none focus-visible:ring-primary/20"
                    disabled={actionLocked}
                  />
                </div>

                <div className="rounded-[1.5rem] border border-amber-500/15 bg-amber-500/5 p-4">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-600" />
                    <div className="space-y-1 text-sm text-amber-800">
                      <p className="font-black">Strict geofence is active.</p>
                      <p className="font-medium">
                        Attendance will be rejected when your live GPS is outside the nearest active office radius.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:flex sm:flex-wrap">
                  <Button
                    type="button"
                    className="touch-target rounded-2xl px-6 text-xs font-black uppercase tracking-[0.18em] sm:h-12"
                    onClick={() => void submitAttendance(nextAction)}
                    disabled={
                      !workspace ||
                      !todayData?.activeOfficeCount ||
                      actionLocked ||
                      submittingAction !== null
                    }
                  >
                    {submittingAction === nextAction ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : nextAction === "check-in" ? (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    ) : (
                      <Clock3 className="mr-2 h-4 w-4" />
                    )}
                    {nextAction === "check-in" ? "Submit check in" : "Submit check out"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="touch-target rounded-2xl px-6 text-xs font-black uppercase tracking-[0.18em] sm:h-12"
                    onClick={clearCapture}
                    disabled={!selectedFile && !notes}
                  >
                    Clear draft
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                  Request attendance status
                </p>
                <h3 className="mt-1 text-lg font-headline font-black tracking-tight text-on-surface">
                  Leave, sick, permit, or day-off
                </h3>
              </div>
              <Badge variant="outline">Day-Off {todayData?.dayOffUsedThisMonth ?? 0}/4</Badge>
            </div>

            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                    Request Type
                  </Label>
                  <select
                    value={requestForm.type}
                    onChange={(event) =>
                      setRequestForm((current) => ({ ...current, type: event.target.value as typeof current.type }))
                    }
                    className="h-11 w-full rounded-2xl border-none bg-surface-container px-4 text-sm font-semibold text-on-surface outline-none"
                  >
                    <option value="LEAVE">Leave</option>
                    <option value="SICK">Sick</option>
                    <option value="PERMIT">Permit</option>
                    <option value="DAY_OFF">Day-Off</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                    Supporting document
                  </Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="touch-target flex-1 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em] sm:h-11"
                      onClick={() => requestDocumentInputRef.current?.click()}
                    >
                      <Paperclip className="mr-2 h-4 w-4" />
                      {requestDocument ? "Replace file" : "Attach file"}
                    </Button>
                    {requestDocument && (
                      <Button
                        type="button"
                        variant="outline"
                        className="touch-target rounded-2xl px-4 sm:h-11"
                        onClick={() => {
                          setRequestDocument(null)
                          if (requestDocumentInputRef.current) requestDocumentInputRef.current.value = ""
                        }}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <input
                    ref={requestDocumentInputRef}
                    type="file"
                    className="hidden"
                    onChange={(event) => setRequestDocument(event.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-on-surface-variant/50">
                    {requestDocument ? requestDocument.name : requestForm.type === "SICK" ? "Attach doctor note if available." : "Optional attachment."}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                    Start Date
                  </Label>
                  <Input
                    type="date"
                    value={requestForm.startDate}
                    onChange={(event) => setRequestForm((current) => ({ ...current, startDate: event.target.value }))}
                    className="h-11 rounded-2xl border-none bg-surface-container"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                    End Date
                  </Label>
                  <Input
                    type="date"
                    value={requestForm.endDate}
                    onChange={(event) => setRequestForm((current) => ({ ...current, endDate: event.target.value }))}
                    className="h-11 rounded-2xl border-none bg-surface-container"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                  Reason
                </Label>
                <Textarea
                  value={requestForm.reason}
                  onChange={(event) => setRequestForm((current) => ({ ...current, reason: event.target.value }))}
                  rows={4}
                  placeholder="Explain the attendance request for the approver..."
                  className="rounded-2xl border-none bg-surface-container text-sm font-medium text-on-surface shadow-none focus-visible:ring-primary/20"
                />
              </div>

              <div className="grid gap-3 sm:flex sm:flex-wrap">
                <Button
                  type="button"
                  className="touch-target rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em] sm:h-11"
                  onClick={() => void submitAttendanceRequest()}
                  disabled={submittingRequest || !requestForm.reason.trim() || !requestForm.startDate || !requestForm.endDate}
                >
                  {submittingRequest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarDays className="mr-2 h-4 w-4" />}
                  Submit request
                </Button>
                <Button type="button" variant="outline" className="touch-target rounded-2xl px-5 text-xs font-black uppercase tracking-[0.18em] sm:h-11" onClick={clearRequestDraft}>
                  Clear draft
                </Button>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {requests.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-on-surface-variant/15 bg-surface-container p-4 text-sm font-medium text-on-surface-variant/55">
                  No attendance requests this month yet.
                </div>
              ) : (
                requests.slice(0, 6).map((request) => (
                  <div key={request.id} className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-on-surface">{request.type.replace("_", " ")}</p>
                        <p className="mt-1 text-xs font-medium text-on-surface-variant/55">
                          {formatDay(request.startDate)}{request.endDate.slice(0, 10) !== request.startDate.slice(0, 10) ? ` - ${formatDay(request.endDate)}` : ""}
                        </p>
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
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-3 h-9 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]"
                        onClick={() => void updateAttendanceRequest(request.id, "cancel")}
                        disabled={updatingRequestId === request.id}
                      >
                        {updatingRequestId === request.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Cancel Request
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {todayData?.canReviewAttendanceRequests && (
            <div className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                    Approval queue
                  </p>
                  <h3 className="mt-1 text-lg font-headline font-black tracking-tight text-on-surface">
                    Pending requests you can review
                  </h3>
                </div>
                <Badge variant="outline">{approvalRequests.length} Pending</Badge>
              </div>

              <div className="mt-4 space-y-3">
                {approvalRequests.length === 0 ? (
                  <div className="rounded-[1.5rem] border border-dashed border-on-surface-variant/15 bg-surface-container p-4 text-sm font-medium text-on-surface-variant/55">
                    No pending requests for your approval right now.
                  </div>
                ) : (
                  approvalRequests.slice(0, 6).map((request) => (
                    <div key={request.id} className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-on-surface">
                            {request.user.name} · {request.type.replaceAll("_", " ")}
                          </p>
                          <p className="mt-1 text-xs font-medium text-on-surface-variant/55">
                            {formatDay(request.startDate)}{request.endDate.slice(0, 10) !== request.startDate.slice(0, 10) ? ` - ${formatDay(request.endDate)}` : ""}
                          </p>
                          {request.team && (
                            <p className="mt-1 text-xs font-medium text-on-surface-variant/45">
                              Team: {request.team.name}
                            </p>
                          )}
                        </div>
                        <Badge variant="warning">PENDING</Badge>
                      </div>
                      <p className="mt-3 text-sm font-medium text-on-surface-variant/65">{request.reason}</p>
                      {request.supportingDocumentUrl && (
                        <Button asChild variant="outline" className="mt-3 h-9 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]">
                          <Link href={request.supportingDocumentUrl} target="_blank">Open Document</Link>
                        </Button>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          className="h-9 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]"
                          onClick={() => void updateAttendanceRequest(request.id, "approve")}
                          disabled={updatingRequestId === request.id}
                        >
                          {updatingRequestId === request.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Approve
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]"
                          onClick={() => void updateAttendanceRequest(request.id, "reject")}
                          disabled={updatingRequestId === request.id}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm sm:p-6">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
              Latest capture
            </p>
            {latestPhoto ? (
              <div className="mt-4 overflow-hidden rounded-[1.5rem] border border-on-surface-variant/10">
                <Image
                  src={latestPhoto}
                  alt="Latest attendance proof"
                  width={1200}
                  height={900}
                  className="h-72 w-full object-cover"
                />
              </div>
            ) : (
              <div className="mt-4 rounded-[1.5rem] border border-dashed border-on-surface-variant/15 bg-surface-container p-6 text-center text-sm font-medium text-on-surface-variant/55">
                No selfie has been recorded for today yet.
              </div>
            )}
          </div>

          <div className="rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm sm:p-6">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
              Recent history
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.5rem] bg-surface-container p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
                  Rows this month
                </p>
                <p className="mt-2 text-lg font-black tracking-tight text-on-surface">{historySummary.total}</p>
              </div>
              <div className="rounded-[1.5rem] bg-surface-container p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
                  Approved Requests
                </p>
                <p className="mt-2 text-lg font-black tracking-tight text-on-surface">{historySummary.requests}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                  Month
                </Label>
                <Input
                  type="month"
                  value={historyFilters.month}
                  onChange={(event) =>
                    setHistoryFilters((current) => ({ ...current, month: event.target.value || currentMonthKey }))
                  }
                  className="h-11 rounded-2xl border-none bg-surface-container"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
                  Status
                </Label>
                <select
                  value={historyFilters.status}
                  onChange={(event) =>
                    setHistoryFilters((current) => ({ ...current, status: event.target.value }))
                  }
                  className="h-11 w-full rounded-2xl border-none bg-surface-container px-4 text-sm font-semibold text-on-surface outline-none"
                >
                  <option value="all">All status</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CHECKED_IN">Checked In</option>
                  <option value="INCOMPLETE">Incomplete</option>
                </select>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {history.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-on-surface-variant/15 bg-surface-container p-5 text-sm font-medium text-on-surface-variant/55">
                  No attendance records yet.
                </div>
              ) : (
                history.map((record) => (
                  <div
                    key={record.id}
                    className="rounded-[1.5rem] border border-on-surface-variant/10 bg-surface-container p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-on-surface">{formatDay(record.attendanceDate)}</p>
                        <p className="mt-1 text-xs font-medium text-on-surface-variant/55">
                          {record.officeLocation.name}
                        </p>
                        {(record.checkInAddress || record.officeLocation.address) && (
                          <p className="mt-1 text-xs font-medium text-on-surface-variant/45">
                            {record.checkInAddress || record.officeLocation.address}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {record.attendanceDayType && record.attendanceDayType !== "PRESENT" && (
                          <Badge variant={record.attendanceDayType === "ABSENT" ? "destructive" : "outline"}>
                            {record.attendanceDayType.replaceAll("_", " ")}
                          </Badge>
                        )}
                        {record.effectiveShiftSource === "TEAM" && record.effectiveTeamName && (
                          <Badge variant="outline">Team Shift · {record.effectiveTeamName}</Badge>
                        )}
                        {record.recordKind === "ATTENDANCE" && (
                          <Badge variant={statusBadgeVariant(record.status)}>{record.status.replace("_", " ")}</Badge>
                        )}
                      </div>
                    </div>
                    {record.recordKind === "ATTENDANCE" ? (
                      <>
                        <div className="mt-3 grid gap-2 text-xs font-medium text-on-surface-variant/60 sm:grid-cols-2">
                          <p>In: {formatDateTime(record.checkInAt)}</p>
                          <p>Out: {formatDateTime(record.checkOutAt)}</p>
                          <p>Check-in distance: {formatDistance(record.checkInDistanceMeters)}</p>
                          <p>Check-out distance: {formatDistance(record.checkOutDistanceMeters)}</p>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {record.checkInStatus && (
                            <Badge variant={attendanceMetricVariant(record.checkInStatus)}>
                              In: {record.checkInStatus.replace("_", " ")}
                            </Badge>
                          )}
                          {record.checkOutStatus && (
                            <Badge variant={attendanceMetricVariant(record.checkOutStatus)}>
                              Out: {record.checkOutStatus.replace("_", " ")}
                            </Badge>
                          )}
                          {record.effectiveShiftStartTime && record.effectiveShiftEndTime && (
                            <Badge variant="ghost">
                              Shift: {record.effectiveShiftStartTime} - {record.effectiveShiftEndTime}
                            </Badge>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="mt-3 grid gap-2 text-xs font-medium text-on-surface-variant/60 sm:grid-cols-2">
                        <p>Request type: {record.requestType?.replaceAll("_", " ") ?? "Absent"}</p>
                        <p>Approval: {record.approvalSource?.replaceAll("_", " ") ?? "System"}</p>
                      </div>
                    )}
                    {(record.correctedAt || record.correctionReason) && (
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
                    {record.recordKind === "ATTENDANCE" && (
                      <Button asChild variant="outline" className="mt-4 h-10 rounded-2xl px-4 text-[11px] font-black uppercase tracking-[0.18em]">
                        <Link href={`/attendance/${record.id}`}>View Report</Link>
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      <div
        className={cn(
          "rounded-[2rem] border p-4 text-sm font-medium",
          todayData?.activeOfficeCount
            ? "border-primary/10 bg-primary/[0.03] text-on-surface-variant/70"
            : "border-amber-500/20 bg-amber-500/5 text-amber-800"
        )}
      >
        {todayData?.activeOfficeCount
          ? "Attendance records use server time and nearest-office geofence validation on every submission."
          : "Admin still needs to create at least one active office in Settings > Attendance before the flow can be used."}
      </div>
    </div>
  )
}
