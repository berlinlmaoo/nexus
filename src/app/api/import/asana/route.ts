export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

const ASANA_BASE = 'https://app.asana.com/api/1.0'

async function asanaFetch(path: string, token: string) {
  const res = await fetch(`${ASANA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Asana API error ${res.status}: ${text}`)
  }
  const json = await res.json()
  return json.data
}

function mapPriority(priority: string | null): string {
  if (!priority) return 'MEDIUM'
  const lower = priority.toLowerCase()
  if (lower === 'high') return 'HIGH'
  if (lower === 'low') return 'LOW'
  return 'MEDIUM'
}

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { personalAccessToken, workspaceGid } = body

    if (!personalAccessToken || !workspaceGid) {
      return NextResponse.json(
        { error: 'personalAccessToken and workspaceGid are required' },
        { status: 400 }
      )
    }

    const job = await prisma.importJob.create({
      data: {
        source: 'asana',
        status: 'running',
        userId: session.user.id,
      },
    })

    const workspaceMember = await prisma.workspaceMember.findFirst({
      where: { userId: session.user.id },
    })

    if (!workspaceMember) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
    }

    importFromAsana(
      personalAccessToken,
      workspaceGid,
      session.user.id,
      workspaceMember.workspaceId,
      job.id
    ).catch(async (err) => {
      await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          details: { error: err instanceof Error ? err.message : 'Unknown error' },
        },
      })
    })

    logAudit({ action: 'create', entityType: 'import', entityId: job.id, entityName: 'asana', userId: session.user.id, request: req })

    return NextResponse.json({ jobId: job.id }, { status: 202 })
  } catch (error) {
    console.error('Error starting Asana import:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function importFromAsana(
  token: string,
  workspaceGid: string,
  userId: string,
  workspaceId: string,
  jobId: string
) {
  try {
    const projects = await asanaFetch(
      `/workspaces/${workspaceGid}/projects?opt_fields=name,notes,color`,
      token
    )

    const total = projects.length
    let progress = 0
    const errors: string[] = []

    await prisma.importJob.update({
      where: { id: jobId },
      data: { total },
    })

    for (const asanaProject of projects) {
      try {
        const project = await prisma.project.create({
          data: {
            name: asanaProject.name || 'Untitled Project',
            description: asanaProject.notes || null,
            workspaceId,
            members: {
              create: { userId, role: 'LEAD' },
            },
          },
        })

        const sections = await asanaFetch(
          `/projects/${asanaProject.gid}/sections?opt_fields=name`,
          token
        )

        for (let i = 0; i < sections.length; i++) {
          const section = sections[i]
          const taskList = await prisma.taskList.create({
            data: {
              name: section.name || 'Untitled Section',
              position: i,
              projectId: project.id,
            },
          })

          const tasks = await asanaFetch(
            `/sections/${section.gid}/tasks?opt_fields=name,notes,due_on,completed,assignee,assignee.email,custom_fields`,
            token
          )

          for (let j = 0; j < tasks.length; j++) {
            const asanaTask = tasks[j]

            let assigneeId = userId
            if (asanaTask.assignee?.email) {
              let assignee = await prisma.user.findUnique({
                where: { email: asanaTask.assignee.email },
              })
              if (!assignee) {
                assignee = await prisma.user.create({
                  data: {
                    name: asanaTask.assignee.email.split('@')[0],
                    email: asanaTask.assignee.email,
                    password: null,
                  },
                })
              }
              assigneeId = assignee.id
            }

            const status = asanaTask.completed ? 'DONE' : 'TODO'

            let priority = 'MEDIUM'
            if (asanaTask.custom_fields) {
              const priorityField = asanaTask.custom_fields.find(
                (f: { name: string }) =>
                  f.name.toLowerCase().includes('priority')
              )
              if (priorityField?.display_value) {
                priority = mapPriority(priorityField.display_value)
              }
            }

            const task = await prisma.task.create({
              data: {
                title: asanaTask.name || 'Untitled Task',
                description: asanaTask.notes || null,
                status: status as 'TODO' | 'DONE',
                priority: priority as 'HIGH' | 'MEDIUM' | 'LOW',
                position: j,
                dueDate: asanaTask.due_on ? new Date(asanaTask.due_on) : null,
                taskListId: taskList.id,
                creatorId: userId,
                assignees: {
                  create: { userId: assigneeId },
                },
              },
            })

            try {
              const subtasks = await asanaFetch(
                `/tasks/${asanaTask.gid}/subtasks?opt_fields=name,notes,completed,due_on`,
                token
              )
              for (let k = 0; k < subtasks.length; k++) {
                const sub = subtasks[k]
                await prisma.task.create({
                  data: {
                    title: sub.name || 'Untitled Subtask',
                    description: sub.notes || null,
                    status: sub.completed ? 'DONE' : 'TODO',
                    priority: 'MEDIUM',
                    position: k,
                    taskListId: taskList.id,
                    creatorId: userId,
                    parentId: task.id,
                  },
                })
              }
            } catch {
              // Subtask fetch may fail, continue
            }
          }
        }
      } catch (err) {
        errors.push(
          `Project "${asanaProject.name}": ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      }

      progress++
      await prisma.importJob.update({
        where: { id: jobId },
        data: { progress },
      })
    }

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        details: { imported: progress, total, errors },
      },
    })
  } catch (err) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        details: { error: err instanceof Error ? err.message : 'Unknown error' },
      },
    })
  }
}
