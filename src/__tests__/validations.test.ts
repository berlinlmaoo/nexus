import { describe, it, expect } from 'vitest'
import {
  registerSchema,
  loginSchema,
  verifySignupOtpSchema,
  resendSignupOtpSchema,
  requestPasswordResetSchema,
  verifyPasswordResetSchema,
  resendPasswordResetSchema,
  createOfficeLocationSchema,
  updateOfficeLocationSchema,
  attendanceActionSchema,
  attendanceHistoryQuerySchema,
  createTaskSchema,
  updateTaskSchema,
  createProjectSchema,
  createCommentSchema,
  createWebhookSchema,
  validateBody,
} from '@/lib/validations'

describe('registerSchema', () => {
  it('accepts valid registration data', () => {
    const result = registerSchema.safeParse({
      name: 'Berlin Taufik',
      email: 'berlin@patsgroup.id',
      password: 'securepass123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const result = registerSchema.safeParse({
      name: '',
      email: 'test@test.com',
      password: 'securepass123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email', () => {
    const result = registerSchema.safeParse({
      name: 'Test',
      email: 'not-an-email',
      password: 'securepass123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects short password', () => {
    const result = registerSchema.safeParse({
      name: 'Test',
      email: 'test@test.com',
      password: '123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects password over 128 chars', () => {
    const result = registerSchema.safeParse({
      name: 'Test',
      email: 'test@test.com',
      password: 'a'.repeat(129),
    })
    expect(result.success).toBe(false)
  })
})

describe('loginSchema', () => {
  it('accepts valid login', () => {
    const result = loginSchema.safeParse({
      email: 'berlin@patsgroup.id',
      password: 'password123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing password', () => {
    const result = loginSchema.safeParse({
      email: 'berlin@patsgroup.id',
      password: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('verifySignupOtpSchema', () => {
  it('accepts a valid six-digit OTP payload', () => {
    const result = verifySignupOtpSchema.safeParse({
      email: 'berlin@patsgroup.id',
      code: '123456',
    })
    expect(result.success).toBe(true)
  })

  it('rejects OTP codes that are not six digits', () => {
    const result = verifySignupOtpSchema.safeParse({
      email: 'berlin@patsgroup.id',
      code: '12345',
    })
    expect(result.success).toBe(false)
  })
})

describe('resendSignupOtpSchema', () => {
  it('accepts a valid resend payload', () => {
    const result = resendSignupOtpSchema.safeParse({
      email: 'berlin@patsgroup.id',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid email for resend', () => {
    const result = resendSignupOtpSchema.safeParse({
      email: 'not-an-email',
    })
    expect(result.success).toBe(false)
  })
})

describe('password reset schemas', () => {
  it('accepts a valid password reset request payload', () => {
    const result = requestPasswordResetSchema.safeParse({
      email: 'berlin@patsgroup.id',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid password reset verify payload', () => {
    const result = verifyPasswordResetSchema.safeParse({
      email: 'berlin@patsgroup.id',
      code: '123456',
      password: 'newsecurepass123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a password reset verify payload with invalid OTP', () => {
    const result = verifyPasswordResetSchema.safeParse({
      email: 'berlin@patsgroup.id',
      code: '12345',
      password: 'newsecurepass123',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid password reset resend payload', () => {
    const result = resendPasswordResetSchema.safeParse({
      email: 'berlin@patsgroup.id',
    })
    expect(result.success).toBe(true)
  })
})

describe('attendance schemas', () => {
  it('accepts a valid office location payload', () => {
    const result = createOfficeLocationSchema.safeParse({
      name: 'Main HQ',
      latitude: -6.20876,
      longitude: 106.8456,
      radiusMeters: 100,
      isActive: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects office radius below minimum', () => {
    const result = createOfficeLocationSchema.safeParse({
      name: 'Main HQ',
      latitude: -6.20876,
      longitude: 106.8456,
      radiusMeters: 5,
    })
    expect(result.success).toBe(false)
  })

  it('accepts partial office updates', () => {
    const result = updateOfficeLocationSchema.safeParse({
      radiusMeters: 250,
      isActive: false,
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid attendance action payload', () => {
    const result = attendanceActionSchema.safeParse({
      lat: -6.2,
      lng: 106.8,
      notes: 'Field visit completed',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid attendance coordinates', () => {
    const result = attendanceActionSchema.safeParse({
      lat: -120,
      lng: 106.8,
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid attendance history query payload', () => {
    const result = attendanceHistoryQuerySchema.safeParse({
      scope: 'workspace',
      officeLocationId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      userId: 'clyyyyyyyyyyyyyyyyyyyyyyyyy',
      dateFrom: '2026-04-18',
      dateTo: '2026-04-18',
      format: 'csv',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid attendance history query payload', () => {
    const result = attendanceHistoryQuerySchema.safeParse({
      scope: 'workspace',
      officeLocationId: 'not-a-cuid',
    })
    expect(result.success).toBe(false)
  })
})

describe('createTaskSchema', () => {
  const validTask = {
    title: 'Fix bug in login',
    projectId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
    taskListId: 'clyyyyyyyyyyyyyyyyyyyyyyyyy',
  }

  it('accepts valid task with required fields only', () => {
    const result = createTaskSchema.safeParse(validTask)
    expect(result.success).toBe(true)
  })

  it('accepts valid task with all optional fields', () => {
    const result = createTaskSchema.safeParse({
      ...validTask,
      description: 'Some description',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      dueDate: '2026-04-15T00:00:00.000Z',
      tags: ['bug', 'urgent'],
      assigneeIds: ['clzzzzzzzzzzzzzzzzzzzzzzzzz'],
      taskType: 'TASK',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty title', () => {
    const result = createTaskSchema.safeParse({
      ...validTask,
      title: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid status', () => {
    const result = createTaskSchema.safeParse({
      ...validTask,
      status: 'INVALID_STATUS',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid priority', () => {
    const result = createTaskSchema.safeParse({
      ...validTask,
      priority: 'SUPER_URGENT',
    })
    expect(result.success).toBe(false)
  })

  it('rejects too many tags', () => {
    const result = createTaskSchema.safeParse({
      ...validTask,
      tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid projectId format', () => {
    const result = createTaskSchema.safeParse({
      ...validTask,
      projectId: 'not-a-cuid',
    })
    expect(result.success).toBe(false)
  })
})

describe('updateTaskSchema', () => {
  it('accepts partial update with only title', () => {
    const result = updateTaskSchema.safeParse({ title: 'Updated title' })
    expect(result.success).toBe(true)
  })

  it('accepts partial update with only status', () => {
    const result = updateTaskSchema.safeParse({ status: 'DONE' })
    expect(result.success).toBe(true)
  })

  it('accepts empty object (no changes)', () => {
    const result = updateTaskSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rejects invalid status value', () => {
    const result = updateTaskSchema.safeParse({ status: 'DELETED' })
    expect(result.success).toBe(false)
  })

  it('accepts null dueDate (clearing due date)', () => {
    const result = updateTaskSchema.safeParse({ dueDate: null })
    expect(result.success).toBe(true)
  })

  it('accepts recurring pattern', () => {
    const result = updateTaskSchema.safeParse({
      isRecurring: true,
      recurPattern: {
        frequency: 'WEEKLY',
        interval: 2,
        daysOfWeek: [1, 3, 5],
      },
    })
    expect(result.success).toBe(true)
  })
})

describe('createProjectSchema', () => {
  it('accepts valid project', () => {
    const result = createProjectSchema.safeParse({
      name: 'NEXUS v2',
      workspaceId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid hex color', () => {
    const result = createProjectSchema.safeParse({
      name: 'Test',
      workspaceId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      color: 'red',
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid hex color', () => {
    const result = createProjectSchema.safeParse({
      name: 'Test',
      workspaceId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      color: '#7B2FBE',
    })
    expect(result.success).toBe(true)
  })
})

describe('createCommentSchema', () => {
  it('accepts valid comment', () => {
    const result = createCommentSchema.safeParse({ content: 'Great work!' })
    expect(result.success).toBe(true)
  })

  it('rejects empty comment', () => {
    const result = createCommentSchema.safeParse({ content: '' })
    expect(result.success).toBe(false)
  })

  it('rejects oversized comment', () => {
    const result = createCommentSchema.safeParse({ content: 'x'.repeat(10001) })
    expect(result.success).toBe(false)
  })
})

describe('createWebhookSchema', () => {
  it('accepts valid webhook', () => {
    const result = createWebhookSchema.safeParse({
      url: 'https://hooks.example.com/webhook',
      events: ['task.created', 'task.updated'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid URL', () => {
    const result = createWebhookSchema.safeParse({
      url: 'not-a-url',
      events: ['task.created'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty events array', () => {
    const result = createWebhookSchema.safeParse({
      url: 'https://hooks.example.com/webhook',
      events: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('validateBody', () => {
  it('returns success with parsed data on valid input', () => {
    const result = validateBody(registerSchema, {
      name: 'Test',
      email: 'test@test.com',
      password: 'password123',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Test')
    }
  })

  it('returns error response on invalid input', () => {
    const result = validateBody(registerSchema, {
      name: '',
      email: 'bad',
      password: '123',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.status).toBe(400)
    }
  })
})
