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
