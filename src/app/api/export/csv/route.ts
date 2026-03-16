import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

function escapeCSV(value: string | null | undefined): string {
  if (!value) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function GET(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const includeCompleted = searchParams.get('includeCompleted') !== 'false'
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }

    // Verify user is member of project
    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId } },
    })

    if (!member) {
      return NextResponse.json({ error: 'Not a project member' }, { status: 403 })
    }

    const where: Record<string, unknown> = {
      taskList: { projectId },
    }

    if (!includeCompleted) {
      where.status = { not: 'DONE' }
    }

    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom)
      if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo)
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignees: {
          include: { user: { select: { name: true, email: true } } },
        },
        taskList: { select: { name: true } },
        customFieldValues: {
          include: { customField: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Collect all custom field names
    const customFieldNames = new Set<string>()
    for (const task of tasks) {
      for (const cfv of task.customFieldValues) {
        customFieldNames.add(cfv.customField.name)
      }
    }

    const cfHeaders = Array.from(customFieldNames)
    const headers = [
      'Name',
      'Status',
      'Priority',
      'Assignee',
      'Due Date',
      'Section',
      'Description',
      'Tags',
      'Created',
      ...cfHeaders,
    ]

    const rows: string[] = [headers.map(escapeCSV).join(',')]

    for (const task of tasks) {
      const assignees = task.assignees.map((a) => a.user.name).join('; ')
      const customFieldMap = new Map<string, string>()
      for (const cfv of task.customFieldValues) {
        customFieldMap.set(cfv.customField.name, cfv.value)
      }

      const row = [
        escapeCSV(task.title),
        escapeCSV(task.status),
        escapeCSV(task.priority),
        escapeCSV(assignees),
        escapeCSV(task.dueDate?.toISOString().split('T')[0] || ''),
        escapeCSV(task.taskList.name),
        escapeCSV(task.description),
        escapeCSV(task.tags.join(', ')),
        escapeCSV(task.createdAt.toISOString().split('T')[0]),
        ...cfHeaders.map((name) => escapeCSV(customFieldMap.get(name) || '')),
      ]

      rows.push(row.join(','))
    }

    const csv = rows.join('\n')

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="export-${projectId}.csv"`,
      },
    })
  } catch (error) {
    console.error('Error exporting CSV:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
