export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { checkProjectAccess } from '@/lib/rbac'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId } = await params

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ['MEMBER', 'LEAD'])
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        taskLists: {
          include: {
            tasks: {
              select: {
                status: true,
                priority: true,
                dueDate: true,
                title: true,
                updatedAt: true,
                assignees: { select: { user: { select: { name: true } } } },
              },
            },
          },
        },
        sprints: {
          where: { status: 'ACTIVE' },
          include: {
            tasks: { include: { task: { select: { status: true, title: true } } } },
          },
          take: 1,
        },
        members: { include: { user: { select: { name: true } } } },
      },
    })

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const allTasks = project.taskLists.flatMap(tl => tl.tasks)
    const totalTasks = allTasks.length
    const doneTasks = allTasks.filter(t => t.status === 'DONE').length
    const completionPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

    const now = new Date()
    const overdueTasks = allTasks.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== 'DONE' && t.status !== 'CANCELLED')
    const recentlyCompleted = allTasks
      .filter(t => t.status === 'DONE' && t.updatedAt > new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000))
      .map(t => t.title)

    const activeSprint = project.sprints[0]
    let sprintInfo = ''
    if (activeSprint) {
      const sprintTasks = activeSprint.tasks
      const sprintDone = sprintTasks.filter(t => t.task.status === 'DONE').length
      sprintInfo = `Active sprint "${activeSprint.name}": ${sprintDone}/${sprintTasks.length} tasks completed.`
    }

    const byStatus = {
      todo: allTasks.filter(t => t.status === 'TODO').length,
      inProgress: allTasks.filter(t => t.status === 'IN_PROGRESS').length,
      inReview: allTasks.filter(t => t.status === 'IN_REVIEW').length,
      done: doneTasks,
      cancelled: allTasks.filter(t => t.status === 'CANCELLED').length,
    }

    const prompt = `Generate a concise 2-3 paragraph project status update for "${project.name}".

Project stats:
- Total tasks: ${totalTasks}
- Completion: ${completionPct}% (${doneTasks}/${totalTasks})
- By status: TODO=${byStatus.todo}, In Progress=${byStatus.inProgress}, In Review=${byStatus.inReview}, Done=${byStatus.done}, Cancelled=${byStatus.cancelled}
- Overdue tasks: ${overdueTasks.length}${overdueTasks.length > 0 ? ` (${overdueTasks.slice(0, 5).map(t => `"${t.title}"`).join(', ')})` : ''}
- Recently completed (last 7 days): ${recentlyCompleted.length > 0 ? recentlyCompleted.slice(0, 5).join(', ') : 'None'}
- Team size: ${project.members.length} members
${sprintInfo ? `- ${sprintInfo}` : ''}

Write in a professional but approachable tone. Include:
1. Overall progress summary
2. Key highlights or concerns (overdue items, recent wins)
3. Brief outlook / next steps

Do not use markdown headers. Just write plain paragraphs.`

    const client = new Anthropic()
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = message.content.find(b => b.type === 'text')
    const content = textBlock ? textBlock.text : ''

    return NextResponse.json({ content })
  } catch (error) {
    console.error('Error generating status update:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
