"use client"

import { useEffect, useMemo, useState } from "react"
import {
  addMonths,
  addQuarters,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  subMonths,
  subQuarters,
  subWeeks,
} from "date-fns"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  Users2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Checkbox } from "@/components/ui/checkbox"
import { UserAvatar } from "@/components/ui/user-avatar"
import { cn } from "@/lib/utils"
import { toastError, toastSuccess } from "@/lib/toast"

type CalendarDisplayMode = "week" | "month" | "quarter"

type TeamOption = {
  id: string
  name: string
  color: string
  workspaceId: string
  workspaceName: string
}

type EventAttendee = {
  id: string
  name: string
  email: string
  avatar: string | null
}

type EventItem = {
  id: string
  title: string
  description: string | null
  location: string | null
  startsAt: string | null
  endsAt: string | null
  isAllDay: boolean
  status: "ACTIVE" | "CANCELLED"
  team: {
    id: string
    name: string
    color: string
  }
  attendees: Array<{
    user: EventAttendee
  }>
}

type AvailabilityAttendee = EventAttendee & {
  available: boolean
  reason: string | null
  role: string
}

type EventFormState = {
  title: string
  teamId: string
  date: string
  isAllDay: boolean
  startTime: string
  endTime: string
  attendeeIds: string[]
  location: string
  description: string
}

const DEFAULT_FORM: EventFormState = {
  title: "",
  teamId: "",
  date: format(new Date(), "yyyy-MM-dd"),
  isAllDay: false,
  startTime: "09:00",
  endTime: "10:00",
  attendeeIds: [],
  location: "",
  description: "",
}

function getRangeForMode(currentDate: Date, displayMode: CalendarDisplayMode) {
  if (displayMode === "week") {
    return { start: startOfWeek(currentDate), end: endOfWeek(currentDate) }
  }

  if (displayMode === "quarter") {
    return {
      start: startOfWeek(startOfQuarter(currentDate)),
      end: endOfWeek(endOfQuarter(currentDate)),
    }
  }

  return {
    start: startOfWeek(startOfMonth(currentDate)),
    end: endOfWeek(endOfMonth(currentDate)),
  }
}

function buildHeaderLabel(currentDate: Date, displayMode: CalendarDisplayMode, range: { start: Date; end: Date }) {
  if (displayMode === "week") {
    const startLabel = format(range.start, "MMM d")
    const endLabel =
      format(range.start, "MMM") === format(range.end, "MMM")
        ? format(range.end, "d, yyyy")
        : format(range.end, "MMM d, yyyy")
    return `${startLabel} - ${endLabel}`
  }

  if (displayMode === "quarter") {
    return `Q${Math.floor(currentDate.getMonth() / 3) + 1} ${format(currentDate, "yyyy")}`
  }

  return format(currentDate, "MMMM yyyy")
}

function getEventTimeLabel(event: EventItem) {
  if (event.isAllDay) return "All day"
  if (!event.startsAt || !event.endsAt) return "Time TBD"

  return `${format(new Date(event.startsAt), "HH:mm")} - ${format(new Date(event.endsAt), "HH:mm")}`
}

export function MasterCalendarPageClient({
  initialTeams,
  initialTeamId,
}: {
  initialTeams: TeamOption[]
  initialTeamId: string | null
}) {
  const [displayMode, setDisplayMode] = useState<CalendarDisplayMode>("month")
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedTeamId, setSelectedTeamId] = useState(initialTeamId)
  const [events, setEvents] = useState<EventItem[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [expandedDateKey, setExpandedDateKey] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [form, setForm] = useState<EventFormState>(() => ({
    ...DEFAULT_FORM,
    teamId: initialTeamId ?? "",
  }))
  const [availability, setAvailability] = useState<AvailabilityAttendee[]>([])
  const [loadingAvailability, setLoadingAvailability] = useState(false)
  const [attendeePickerOpen, setAttendeePickerOpen] = useState(false)
  const [teamPickerOpen, setTeamPickerOpen] = useState(false)

  const selectedTeam = useMemo(
    () => initialTeams.find((team) => team.id === selectedTeamId) ?? null,
    [initialTeams, selectedTeamId]
  )

  const visibleRange = useMemo(
    () => getRangeForMode(currentDate, displayMode),
    [currentDate, displayMode]
  )

  const calendarDays = useMemo(
    () => eachDayOfInterval(visibleRange),
    [visibleRange]
  )

  const headerLabel = useMemo(
    () => buildHeaderLabel(currentDate, displayMode, visibleRange),
    [currentDate, displayMode, visibleRange]
  )

  const eventsByDate = useMemo(() => {
    const map: Record<string, EventItem[]> = {}
    for (const event of events) {
      if (!event.startsAt) continue
      const key = format(new Date(event.startsAt), "yyyy-MM-dd")
      if (!map[key]) map[key] = []
      map[key].push(event)
    }

    Object.values(map).forEach((items) => {
      items.sort((left, right) => {
        if (!left.startsAt || !right.startsAt) return 0
        return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
      })
    })

    return map
  }, [events])

  async function fetchEvents() {
    if (!selectedTeamId) {
      setEvents([])
      return
    }

    setLoadingEvents(true)
    try {
      const params = new URLSearchParams({
        teamId: selectedTeamId,
        rangeStart: visibleRange.start.toISOString(),
        rangeEnd: visibleRange.end.toISOString(),
      })

      const response = await fetch(`/api/master-calendar?${params.toString()}`, {
        cache: "no-store",
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || "Failed to fetch master calendar")
      }

      setEvents(Array.isArray(data.events) ? data.events : [])
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Failed to load events")
    } finally {
      setLoadingEvents(false)
    }
  }

  useEffect(() => {
    void fetchEvents()
  }, [selectedTeamId, visibleRange.start.getTime(), visibleRange.end.getTime()])

  useEffect(() => {
    if (!dialogOpen || !form.teamId || !form.date) {
      setAvailability([])
      return
    }

    if (!form.isAllDay && (!form.startTime || !form.endTime)) {
      setAvailability([])
      return
    }

    let cancelled = false
    const params = new URLSearchParams({
      teamId: form.teamId,
      date: form.date,
      isAllDay: String(form.isAllDay),
    })
    if (!form.isAllDay) {
      params.set("startTime", form.startTime)
      params.set("endTime", form.endTime)
    }
    if (editingEventId) {
      params.set("excludeEventId", editingEventId)
    }

    setLoadingAvailability(true)

    fetch(`/api/master-calendar/availability?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.error || "Failed to check attendee availability")
        }
        if (!cancelled) {
          setAvailability(Array.isArray(data.attendees) ? data.attendees : [])
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAvailability([])
          toastError(error instanceof Error ? error.message : "Failed to check attendee availability")
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAvailability(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [dialogOpen, form.teamId, form.date, form.isAllDay, form.startTime, form.endTime, editingEventId])

  function handleOpenCreate(day?: Date) {
    setEditingEventId(null)
    setForm({
      ...DEFAULT_FORM,
      teamId: selectedTeamId ?? initialTeams[0]?.id ?? "",
      date: day ? format(day, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
    })
    setDialogOpen(true)
  }

  function handleOpenEdit(event: EventItem) {
    setEditingEventId(event.id)
    setForm({
      title: event.title,
      teamId: event.team.id,
      date: event.startsAt ? format(new Date(event.startsAt), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
      isAllDay: event.isAllDay,
      startTime: event.startsAt ? format(new Date(event.startsAt), "HH:mm") : "09:00",
      endTime: event.endsAt ? format(new Date(event.endsAt), "HH:mm") : "10:00",
      attendeeIds: event.attendees.map((attendee) => attendee.user.id),
      location: event.location ?? "",
      description: event.description ?? "",
    })
    setDialogOpen(true)
  }

  function resetDialogState(nextOpen: boolean) {
    setDialogOpen(nextOpen)
    if (!nextOpen) {
      setEditingEventId(null)
      setSaving(false)
      setDeleting(false)
      setAttendeePickerOpen(false)
      setForm({
        ...DEFAULT_FORM,
        teamId: selectedTeamId ?? initialTeams[0]?.id ?? "",
      })
    }
  }

  async function handleSaveEvent() {
    if (!form.title.trim()) {
      toastError("Title is required")
      return
    }

    setSaving(true)
    try {
      const payload = {
        title: form.title.trim(),
        teamId: form.teamId,
        date: form.date,
        isAllDay: form.isAllDay,
        startTime: form.isAllDay ? null : form.startTime,
        endTime: form.isAllDay ? null : form.endTime,
        attendeeIds: form.attendeeIds,
        location: form.location.trim() || null,
        description: form.description.trim() || null,
      }

      const response = await fetch(
        editingEventId ? `/api/master-calendar/${editingEventId}` : "/api/master-calendar",
        {
          method: editingEventId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      )
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || "Failed to save event")
      }

      toastSuccess(editingEventId ? "Event updated" : "Event created")
      resetDialogState(false)
      await fetchEvents()
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Failed to save event")
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteEvent() {
    if (!editingEventId) return

    setDeleting(true)
    try {
      const response = await fetch(`/api/master-calendar/${editingEventId}`, {
        method: "DELETE",
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || "Failed to cancel event")
      }

      toastSuccess("Event cancelled")
      resetDialogState(false)
      await fetchEvents()
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Failed to cancel event")
    } finally {
      setDeleting(false)
    }
  }

  function toggleAttendee(attendeeId: string) {
    setForm((current) => ({
      ...current,
      attendeeIds: current.attendeeIds.includes(attendeeId)
        ? current.attendeeIds.filter((value) => value !== attendeeId)
        : [...current.attendeeIds, attendeeId],
    }))
  }

  function navigate(direction: "previous" | "next") {
    if (displayMode === "week") {
      setCurrentDate(direction === "next" ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1))
      return
    }
    if (displayMode === "quarter") {
      setCurrentDate(direction === "next" ? addQuarters(currentDate, 1) : subQuarters(currentDate, 1))
      return
    }
    setCurrentDate(direction === "next" ? addMonths(currentDate, 1) : subMonths(currentDate, 1))
  }

  const selectedAttendeeDetails = availability.filter((attendee) => form.attendeeIds.includes(attendee.id))

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-[32px] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-surface-container px-3 py-1 text-[10px] font-black uppercase tracking-[0.28em] text-on-surface-variant/50">
              <CalendarDays className="h-3.5 w-3.5" />
              Team Calendar
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-primary sm:text-4xl">Team Calendar</h1>
              <p className="text-sm font-medium text-on-surface-variant/60">
                Cross-team scheduling with hard-block conflict detection, so people who are already booked cannot be assigned again in overlapping time slots.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Popover open={teamPickerOpen} onOpenChange={setTeamPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between rounded-2xl px-4 sm:w-auto">
                  <span className="truncate">
                    {selectedTeam ? selectedTeam.name : "Select team"}
                  </span>
                  <span
                    className="ml-3 inline-flex h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: selectedTeam?.color ?? "#CBD5E1" }}
                  />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[calc(100vw_-_2rem)] max-w-[320px] rounded-2xl border-none p-0 shadow-2xl">
                <Command>
                  <CommandInput placeholder="Search team..." />
                  <CommandList>
                    <CommandEmpty>No team found.</CommandEmpty>
                    <CommandGroup>
                      {initialTeams.map((team) => (
                        <CommandItem
                          key={team.id}
                          value={`${team.name} ${team.workspaceName}`}
                          onSelect={() => {
                            setSelectedTeamId(team.id)
                            setTeamPickerOpen(false)
                          }}
                          className="flex items-center justify-between gap-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className="inline-flex h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: team.color }}
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-primary">{team.name}</p>
                              <p className="truncate text-[11px] font-medium text-on-surface-variant/50">
                                {team.workspaceName}
                              </p>
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <Button
              onClick={() => handleOpenCreate()}
              className="rounded-2xl bg-primary px-5 text-primary-foreground shadow-lg shadow-primary/20"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Event
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-[28px] border border-on-surface-variant/10 bg-surface p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-flex rounded-2xl bg-surface-container p-1">
              {(["week", "month", "quarter"] as CalendarDisplayMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDisplayMode(mode)}
                  className={cn(
                    "rounded-2xl px-4 py-2 text-[11px] font-black uppercase tracking-[0.28em] transition-all",
                    displayMode === mode
                      ? "bg-surface-container-lowest text-primary shadow-sm"
                      : "text-on-surface-variant/45 hover:text-on-surface"
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="rounded-2xl" onClick={() => navigate("previous")}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" className="rounded-2xl px-5" onClick={() => setCurrentDate(new Date())}>
                Today
              </Button>
              <Button variant="ghost" size="icon" className="rounded-2xl" onClick={() => navigate("next")}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-on-surface-variant/35">
                Visible Window
              </p>
              <h2 className="text-2xl font-black tracking-tight text-primary">{headerLabel}</h2>
            </div>
            <div className="text-sm font-medium text-on-surface-variant/60">
              {loadingEvents ? "Loading events..." : `${events.length} active event${events.length === 1 ? "" : "s"}`}
            </div>
          </div>

          {initialTeams.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-on-surface-variant/15 bg-surface-container-low p-10 text-center">
              <h3 className="text-lg font-black tracking-tight text-primary">No team calendar available yet</h3>
              <p className="mt-2 text-sm font-medium text-on-surface-variant/60">
                Kamu belum tergabung di team mana pun, jadi belum ada master calendar yang bisa dibuka.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[28px] border border-on-surface-variant/10 bg-surface-container-lowest">
              <div className="grid grid-cols-7 border-b border-on-surface-variant/10">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
                  <div
                    key={label}
                    className="px-3 py-3 text-center text-[11px] font-black uppercase tracking-[0.28em] text-on-surface-variant/35"
                  >
                    {label}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7">
                {calendarDays.map((day) => {
                  const dateKey = format(day, "yyyy-MM-dd")
                  const dayEvents = eventsByDate[dateKey] ?? []
                  const isExpanded = expandedDateKey === dateKey
                  const visibleEvents = isExpanded ? dayEvents : dayEvents.slice(0, 3)
                  const canAdd = Boolean(selectedTeamId)

                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      key={dateKey}
                      onClick={() => handleOpenCreate(day)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          handleOpenCreate(day)
                        }
                      }}
                      className={cn(
                        "group min-h-[180px] border-b border-r border-on-surface-variant/10 p-3 text-left align-top transition-colors hover:bg-surface-container-low last:border-r-0",
                        !isSameMonth(day, currentDate) && displayMode === "month" && "bg-surface-container-low/60 text-on-surface-variant/35",
                        isToday(day) && "bg-primary/[0.03]"
                      )}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-full text-sm font-black",
                              isToday(day)
                                ? "bg-primary text-primary-foreground"
                                : "text-on-surface-variant/70"
                            )}
                          >
                            {format(day, "d")}
                          </div>
                          {dayEvents.length > 0 ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                          ) : null}
                        </div>

                        {canAdd ? (
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-container text-on-surface-variant/40 opacity-0 transition-all group-hover:opacity-100">
                            <Plus className="h-4 w-4" />
                          </span>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        {visibleEvents.map((event) => (
                          <div
                            key={event.id}
                            role="button"
                            tabIndex={0}
                            onClick={(eventClick) => {
                              eventClick.stopPropagation()
                              handleOpenEdit(event)
                            }}
                            onKeyDown={(eventKey) => {
                              if (eventKey.key === "Enter" || eventKey.key === " ") {
                                eventKey.preventDefault()
                                eventKey.stopPropagation()
                                handleOpenEdit(event)
                              }
                            }}
                            className="rounded-2xl bg-surface-container p-3 shadow-sm transition-transform hover:-translate-y-0.5 hover:bg-surface-container-high"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="line-clamp-2 text-[13px] font-black uppercase tracking-tight text-primary">
                                {event.title}
                              </p>
                              <span
                                className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-surface-container-low px-2 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/60"
                              >
                                {event.attendees[0]?.user.name?.slice(0, 2).toUpperCase() ?? "EV"}
                              </span>
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-on-surface-variant/60">
                              <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-low px-2 py-1">
                                <Clock3 className="h-3 w-3" />
                                {getEventTimeLabel(event)}
                              </span>
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {event.attendees.slice(0, 2).map((attendee) => (
                                <span
                                  key={attendee.user.id}
                                  className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-low px-2 py-1 text-[11px] font-semibold text-on-surface-variant/65"
                                >
                                  <UserAvatar
                                    user={{ name: attendee.user.name, image: attendee.user.avatar }}
                                    size="xs"
                                    className="h-4 w-4"
                                  />
                                  {attendee.user.name}
                                </span>
                              ))}
                              {event.attendees.length > 2 ? (
                                <Badge variant="ghost">+{event.attendees.length - 2}</Badge>
                              ) : null}
                            </div>
                          </div>
                        ))}

                        {dayEvents.length > 3 ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setExpandedDateKey(isExpanded ? null : dateKey)
                            }}
                            className="text-xs font-black uppercase tracking-[0.24em] text-on-surface-variant/45 hover:text-primary"
                          >
                            {isExpanded ? "Show less" : `+ ${dayEvents.length - 3} more`}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={resetDialogState}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editingEventId ? "Edit Team Event" : "Create Team Event"}</DialogTitle>
            <DialogDescription>
              This schedule is separate from project calendars. Attendee slots are hard-blocked across all teams in the workspace whenever a time conflict exists.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-5 rounded-[28px] border border-on-surface-variant/10 bg-surface p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.28em] text-on-surface-variant/40">
                    Title
                  </label>
                  <Input
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="e.g. Weekly content alignment"
                    className="rounded-2xl border-on-surface-variant/15 bg-surface-container-lowest"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.28em] text-on-surface-variant/40">
                    Team
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between rounded-2xl border-on-surface-variant/15 bg-surface-container-lowest">
                        <span className="truncate">
                          {initialTeams.find((team) => team.id === form.teamId)?.name ?? "Select team"}
                        </span>
                        <span
                          className="ml-3 inline-flex h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: initialTeams.find((team) => team.id === form.teamId)?.color ?? "#CBD5E1" }}
                        />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[calc(100vw_-_2rem)] max-w-[320px] rounded-2xl border-none p-0 shadow-2xl">
                      <Command>
                        <CommandInput placeholder="Search team..." />
                        <CommandList>
                          <CommandEmpty>No team found.</CommandEmpty>
                          <CommandGroup>
                            {initialTeams.map((team) => (
                              <CommandItem
                                key={team.id}
                                value={`${team.name} ${team.workspaceName}`}
                                onSelect={() => setForm((current) => ({ ...current, teamId: team.id, attendeeIds: [] }))}
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: team.color }} />
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-primary">{team.name}</p>
                                    <p className="truncate text-[11px] font-medium text-on-surface-variant/50">{team.workspaceName}</p>
                                  </div>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.28em] text-on-surface-variant/40">
                    Date
                  </label>
                  <Input
                    type="date"
                    value={form.date}
                    onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                    className="rounded-2xl border-on-surface-variant/15 bg-surface-container-lowest"
                  />
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-on-surface-variant/10 bg-surface-container-lowest px-4 py-3 sm:col-span-2">
                  <div>
                    <p className="text-sm font-black tracking-tight text-primary">All-day event</p>
                    <p className="text-xs font-medium text-on-surface-variant/55">
                      When enabled, attendees are blocked for the full day on that date.
                    </p>
                  </div>
                  <Switch
                    checked={form.isAllDay}
                    onCheckedChange={(checked) => setForm((current) => ({ ...current, isAllDay: checked }))}
                  />
                </div>

                {!form.isAllDay ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase tracking-[0.28em] text-on-surface-variant/40">
                        Start Time
                      </label>
                      <Input
                        type="time"
                        value={form.startTime}
                        onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))}
                        className="rounded-2xl border-on-surface-variant/15 bg-surface-container-lowest"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase tracking-[0.28em] text-on-surface-variant/40">
                        End Time
                      </label>
                      <Input
                        type="time"
                        value={form.endTime}
                        onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))}
                        className="rounded-2xl border-on-surface-variant/15 bg-surface-container-lowest"
                      />
                    </div>
                  </>
                ) : null}

                <div className="space-y-2 sm:col-span-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.28em] text-on-surface-variant/40">
                    Location
                  </label>
                  <Input
                    value={form.location}
                    onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                    placeholder="Optional location"
                    className="rounded-2xl border-on-surface-variant/15 bg-surface-container-lowest"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.28em] text-on-surface-variant/40">
                    Description
                  </label>
                  <Textarea
                    value={form.description}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Optional notes for the team"
                    className="min-h-[100px] rounded-2xl border-on-surface-variant/15 bg-surface-container-lowest"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-5 rounded-[28px] border border-on-surface-variant/10 bg-surface p-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-black uppercase tracking-[0.28em] text-on-surface-variant/40">
                    Attendees
                  </label>
                  {loadingAvailability ? (
                    <span className="text-[11px] font-medium text-on-surface-variant/45">Checking availability...</span>
                  ) : (
                    <span className="text-[11px] font-medium text-on-surface-variant/45">
                      {availability.filter((attendee) => attendee.available).length} available
                    </span>
                  )}
                </div>

                <Popover open={attendeePickerOpen} onOpenChange={setAttendeePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between rounded-2xl border-on-surface-variant/15 bg-surface-container-lowest">
                      <span className="truncate">
                        {form.attendeeIds.length > 0 ? `${form.attendeeIds.length} attendee${form.attendeeIds.length === 1 ? "" : "s"} selected` : "Select attendees"}
                      </span>
                      <Users2 className="ml-3 h-4 w-4 text-on-surface-variant/40" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[calc(100vw_-_2rem)] max-w-[360px] rounded-2xl border-none p-0 shadow-2xl">
                    <Command>
                      <CommandInput placeholder="Search team member..." />
                      <CommandList>
                        <CommandEmpty>No member found.</CommandEmpty>
                        <CommandGroup>
                          {availability.map((attendee) => {
                            const selected = form.attendeeIds.includes(attendee.id)
                            return (
                              <CommandItem
                                key={attendee.id}
                                value={`${attendee.name} ${attendee.email}`}
                                disabled={!attendee.available && !selected}
                                onSelect={() => toggleAttendee(attendee.id)}
                                className="items-start gap-3 py-3"
                              >
                                <Checkbox
                                  checked={selected}
                                  className="mt-0.5"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <UserAvatar
                                      user={{ name: attendee.name, image: attendee.avatar }}
                                      size="xs"
                                      className="h-5 w-5"
                                    />
                                    <span className="truncate text-sm font-semibold text-primary">{attendee.name}</span>
                                  </div>
                                  <p className="truncate text-[11px] font-medium text-on-surface-variant/50">{attendee.email}</p>
                                  {!attendee.available && !selected ? (
                                    <p className="mt-1 text-[11px] font-semibold text-red-500">{attendee.reason}</p>
                                  ) : null}
                                </div>
                              </CommandItem>
                            )
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-3 rounded-[24px] border border-on-surface-variant/10 bg-surface-container-low p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black tracking-tight text-primary">Booked-aware Selection</p>
                  <Badge variant="outline">Hard Block</Badge>
                </div>
                <p className="text-xs font-medium leading-relaxed text-on-surface-variant/55">
                  Team members who are already booked in another overlapping event are automatically disabled in the attendee picker.
                </p>
              </div>

              <div className="space-y-3 rounded-[24px] border border-on-surface-variant/10 bg-surface-container-low p-4">
                <p className="text-sm font-black tracking-tight text-primary">Selected Attendees</p>
                {selectedAttendeeDetails.length === 0 ? (
                  <p className="text-sm font-medium text-on-surface-variant/50">
                    No attendees have been selected for this event yet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {selectedAttendeeDetails.map((attendee) => (
                      <button
                        key={attendee.id}
                        type="button"
                        onClick={() => toggleAttendee(attendee.id)}
                        className="inline-flex items-center gap-2 rounded-full bg-surface-container-lowest px-3 py-2 text-xs font-semibold text-primary shadow-sm"
                      >
                        <UserAvatar user={{ name: attendee.name, image: attendee.avatar }} size="xs" className="h-5 w-5" />
                        {attendee.name}
                        <X className="h-3.5 w-3.5 text-on-surface-variant/45" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3 rounded-[24px] border border-on-surface-variant/10 bg-surface-container-low p-4 text-sm font-medium text-on-surface-variant/60">
                <div className="flex items-center gap-2 text-primary">
                  <Clock3 className="h-4 w-4" />
                  <span>{form.isAllDay ? "All-day booking" : `${form.startTime} - ${form.endTime}`}</span>
                </div>
                {form.location ? (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-on-surface-variant/45" />
                    <span>{form.location}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <div className="flex w-full justify-start">
              {editingEventId ? (
                <Button variant="destructive" onClick={handleDeleteEvent} disabled={deleting || saving}>
                  {deleting ? "Cancelling..." : "Cancel Event"}
                </Button>
              ) : (
                <span />
              )}
            </div>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <Button variant="outline" onClick={() => resetDialogState(false)} disabled={saving || deleting}>
                Close
              </Button>
              <Button onClick={handleSaveEvent} disabled={saving || deleting}>
                {saving ? "Saving..." : editingEventId ? "Save Changes" : "Create Event"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
