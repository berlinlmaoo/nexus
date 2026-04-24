import { z } from "zod"

// ── Auth ────────────────────────────────────────────────────────

export const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
})

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
})

export const verifySignupOtpSchema = z.object({
  email: z.string().email("Invalid email address"),
  code: z.string().regex(/^\d{6}$/, "OTP code must be 6 digits"),
})

export const resendSignupOtpSchema = z.object({
  email: z.string().email("Invalid email address"),
})

export const requestPasswordResetSchema = z.object({
  email: z.string().email("Invalid email address"),
})

export const verifyPasswordResetSchema = z.object({
  email: z.string().email("Invalid email address"),
  code: z.string().regex(/^\d{6}$/, "OTP code must be 6 digits"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
})

export const resendPasswordResetSchema = z.object({
  email: z.string().email("Invalid email address"),
})

// ── Attendance ──────────────────────────────────────────────────

export const createOfficeLocationSchema = z.object({
  name: z.string().min(1, "Office name is required").max(120),
  address: z.string().max(300).optional().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(10).max(5000),
  timezone: z.string().min(1).max(100).optional(),
  workdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  shiftStartTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid shift start time").optional(),
  shiftEndTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid shift end time").optional(),
  lateGraceMinutes: z.number().int().min(0).max(180).optional(),
  earlyLeaveGraceMinutes: z.number().int().min(0).max(180).optional(),
  isActive: z.boolean().optional(),
})

export const updateOfficeLocationSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  address: z.string().max(300).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMeters: z.number().int().min(10).max(5000).optional(),
  timezone: z.string().min(1).max(100).optional(),
  workdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  shiftStartTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid shift start time").optional(),
  shiftEndTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid shift end time").optional(),
  lateGraceMinutes: z.number().int().min(0).max(180).optional(),
  earlyLeaveGraceMinutes: z.number().int().min(0).max(180).optional(),
  isActive: z.boolean().optional(),
})

export const attendanceActionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  notes: z.string().max(500).optional(),
})

export const attendanceHistoryQuerySchema = z.object({
  scope: z.enum(["me", "workspace"]).optional(),
  officeLocationId: z.string().cuid().optional(),
  userId: z.string().cuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  status: z.enum(["CHECKED_IN", "COMPLETED", "INCOMPLETE"]).optional(),
  checkInStatus: z.enum(["ON_TIME", "LATE"]).optional(),
  checkOutStatus: z.enum(["ON_TIME", "EARLY_LEAVE", "OVERTIME"]).optional(),
  isCorrected: z.enum(["true", "false"]).optional(),
  attendanceDayType: z.enum(["PRESENT", "LEAVE_APPROVED", "SICK_APPROVED", "PERMIT_APPROVED", "DAY_OFF_APPROVED", "ABSENT"]).optional(),
  requestType: z.enum(["LEAVE", "SICK", "PERMIT", "DAY_OFF"]).optional(),
  requestStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELED"]).optional(),
  format: z.enum(["json", "csv", "xlsx"]).optional(),
})

export const reverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
})

export const attendanceCorrectionSchema = z.object({
  officeLocationId: z.string().cuid().optional(),
  checkInAt: z.string().datetime().nullable().optional(),
  checkOutAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  correctionReason: z.string().min(3, "Correction reason is required").max(500).nullable().optional(),
})

export const attendanceRequestCreateSchema = z.object({
  type: z.enum(["LEAVE", "SICK", "PERMIT", "DAY_OFF"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid start date"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid end date"),
  reason: z.string().min(3, "Reason is required").max(1000),
})

export const attendanceRequestPatchSchema = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
  reviewNote: z.string().max(1000).nullable().optional(),
})

export const attendanceRequestQuerySchema = z.object({
  scope: z.enum(["me", "approvals", "workspace"]).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  userId: z.string().cuid().optional(),
  teamId: z.string().cuid().optional(),
  type: z.enum(["LEAVE", "SICK", "PERMIT", "DAY_OFF"]).optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELED"]).optional(),
})

// ── Tasks ───────────────────────────────────────────────────────

export const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  description: z.string().max(10000).nullable().optional(),
  projectId: z.string().cuid("Invalid project ID"),
  taskListId: z.string().cuid("Invalid task list ID"),
  status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]).optional(),
  priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]).optional(),
  dueDate: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  assigneeIds: z.array(z.string().cuid()).max(50).optional(),
  parentId: z.string().cuid().nullable().optional(),
  estimatedHours: z.number().min(0).max(9999).nullable().optional(),
  taskType: z.enum(["TASK", "MILESTONE", "APPROVAL"]).optional(),
  isRecurring: z.boolean().optional(),
  recurPattern: z.object({
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
    interval: z.number().int().min(1).max(365),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    endDate: z.string().datetime().optional(),
  }).nullable().optional(),
})

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).nullable().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]).optional(),
  priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]).optional(),
  dueDate: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  projectContextId: z.string().cuid().optional(),
  taskListId: z.string().cuid().optional(),
  position: z.number().int().min(0).optional(),
  assigneeIds: z.array(z.string().cuid()).max(50).optional(),
  estimatedHours: z.number().min(0).max(9999).nullable().optional(),
  actualHours: z.number().min(0).max(9999).nullable().optional(),
  taskType: z.enum(["TASK", "MILESTONE", "APPROVAL"]).optional(),
  isRecurring: z.boolean().optional(),
  recurPattern: z.object({
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
    interval: z.number().int().min(1).max(365),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    endDate: z.string().datetime().optional(),
  }).nullable().optional(),
})

// ── Comments ────────────────────────────────────────────────────

export const createCommentSchema = z.object({
  content: z.string().min(1, "Comment cannot be empty").max(10000),
  parentId: z.string().cuid().nullable().optional(),
})

// ── Projects ────────────────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color").optional(),
  icon: z.string().max(50).optional(),
  workspaceId: z.string().cuid("Invalid workspace ID"),
})

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(50).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED", "COMPLETED"]).optional(),
  enableTaskBatchDuplicate: z.boolean().optional(),
  autoAssignEnabled: z.boolean().optional(),
  autoAssignAssigneeIds: z.array(z.string().cuid()).max(50).optional(),
})

// ── Webhooks ────────────────────────────────────────────────────

export const createWebhookSchema = z.object({
  url: z.string().url("Invalid webhook URL"),
  events: z.array(z.string().max(50)).min(1, "At least one event is required").max(20),
  projectId: z.string().cuid().nullable().optional(),
})

// ── Goals ───────────────────────────────────────────────────────

export const createGoalSchema = z.object({
  title: z.string().min(1, "Title is required").max(300),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(["ON_TRACK", "AT_RISK", "BEHIND", "COMPLETED"]).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  workspaceId: z.string().cuid("Invalid workspace ID"),
  parentId: z.string().cuid().nullable().optional(),
})

// ── Master Calendar ────────────────────────────────────────────

export const createMasterCalendarEventSchema = z.object({
  teamId: z.string().cuid("Invalid team ID"),
  title: z.string().min(1, "Title is required").max(300),
  date: z.string().min(1, "Date is required"),
  isAllDay: z.boolean().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  attendeeIds: z.array(z.string().cuid()).max(50).optional(),
  location: z.string().max(300).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
})

export const updateMasterCalendarEventSchema = z.object({
  teamId: z.string().cuid("Invalid team ID").optional(),
  title: z.string().min(1, "Title is required").max(300).optional(),
  date: z.string().min(1, "Date is required").optional(),
  isAllDay: z.boolean().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  attendeeIds: z.array(z.string().cuid()).max(50).optional(),
  location: z.string().max(300).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(["ACTIVE", "CANCELLED"]).optional(),
})

// ── Automations ─────────────────────────────────────────────────

export const createAutomationSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  trigger: z.object({
    type: z.string().min(1),
    value: z.string().optional(),
  }),
  action: z.object({
    type: z.string().min(1),
    value: z.string().optional(),
  }),
  condition: z.object({
    type: z.string(),
    value: z.string().optional(),
  }).nullable().optional(),
  enabled: z.boolean().optional(),
})

// ── Utility ─────────────────────────────────────────────────────

import { NextResponse } from "next/server"

/**
 * Validates request body against a zod schema.
 * Returns parsed data on success, or a NextResponse error on failure.
 */
export function validateBody<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: NextResponse } {
  const result = schema.safeParse(data)
  if (!result.success) {
    const errors = result.error.flatten()
    return {
      success: false,
      error: NextResponse.json(
        {
          error: "Validation failed",
          details: errors.fieldErrors,
        },
        { status: 400 }
      ),
    }
  }
  return { success: true, data: result.data }
}
