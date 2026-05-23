import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/socket-emitter', () => ({
  emitNotification: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(),
  taskAssignedEmail: vi.fn((input) => ({ to: '', subject: `Task: ${input.taskTitle}`, html: '' })),
  taskDueSoonEmail: vi.fn(),
  commentMentionEmail: vi.fn(),
  projectInviteEmail: vi.fn(),
  statusUpdateEmail: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
    notificationPreference: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
}))

import prisma from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { notifyTaskAssigned } from '@/lib/notification-service'

const mockUserFindUnique = vi.mocked(prisma.user.findUnique)
const mockPreferenceFindUnique = vi.mocked(prisma.notificationPreference.findUnique)
const mockNotificationCreate = vi.mocked(prisma.notification.create)
const mockSendEmail = vi.mocked(sendEmail)

describe('notifyTaskAssigned', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as never
    mockNotificationCreate.mockResolvedValue({ id: 'notif-1' } as never)
    mockSendEmail.mockResolvedValue(undefined as never)
  })

  it('sends WhatsApp assignment notification by default using user.phoneNumber fallback', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Naren',
      email: 'naren@example.com',
      phoneNumber: '081234567890',
    } as never)
    mockPreferenceFindUnique.mockResolvedValue({
      emailEnabled: false,
      waEnabled: false,
      waPhone: null,
      taskAssigned: true,
    } as never)

    await notifyTaskAssigned({
      assigneeId: 'user-1',
      taskId: 'task-1',
      taskTitle: 'Do the thing',
      projectName: 'Ops',
      projectId: 'project-1',
      assignedByName: 'GIDEON',
    })

    expect(fetch).toHaveBeenCalledWith(
      'http://host.docker.internal:3001/send',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          chatId: '6281234567890@s.whatsapp.net',
          message: '[NEXUS] GIDEON assigned you "Do the thing" in Ops',
        }),
      })
    )
  })

  it('respects the default WhatsApp assignment kill-switch', async () => {
    vi.stubEnv('NEXUS_WA_TASK_ASSIGNMENTS_DEFAULT_ENABLED', 'false')
    mockUserFindUnique.mockResolvedValue({
      name: 'Naren',
      email: 'naren@example.com',
      phoneNumber: '081234567890',
    } as never)
    mockPreferenceFindUnique.mockResolvedValue({
      emailEnabled: false,
      waEnabled: false,
      waPhone: null,
      taskAssigned: true,
    } as never)

    await notifyTaskAssigned({
      assigneeId: 'user-1',
      taskId: 'task-1',
      taskTitle: 'Do the thing',
      projectName: 'Ops',
      projectId: 'project-1',
      assignedByName: 'GIDEON',
    })

    expect(fetch).not.toHaveBeenCalled()
  })
})
