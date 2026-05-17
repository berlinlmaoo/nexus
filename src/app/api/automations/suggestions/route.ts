export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { checkProjectAccess } from '@/lib/rbac'

interface Suggestion {
  name: string
  trigger: { type: string; field?: string; value?: string }
  action: { type: string; field?: string; value?: string }
  confidence: number
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const projectId = req.nextUrl.searchParams.get('projectId')
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ['MEMBER', 'LEAD'])
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const tasks = await prisma.task.findMany({
      where: { taskList: { projectId } },
      select: {
        status: true,
        priority: true,
        tags: true,
        assignees: { select: { user: { select: { id: true, name: true } } } },
      },
    })

    if (tasks.length === 0) {
      return NextResponse.json({ suggestions: [] })
    }

    const suggestions: Suggestion[] = []

    // Pattern 1: Assignee-priority frequency
    const assigneePriorityCounts: Record<string, Record<string, number>> = {}
    for (const task of tasks) {
      for (const a of task.assignees) {
        if (!assigneePriorityCounts[a.user.id]) assigneePriorityCounts[a.user.id] = {}
        assigneePriorityCounts[a.user.id][task.priority] = (assigneePriorityCounts[a.user.id][task.priority] || 0) + 1
      }
    }
    for (const [userId, priorities] of Object.entries(assigneePriorityCounts)) {
      const total = Object.values(priorities).reduce((s, n) => s + n, 0)
      for (const [priority, count] of Object.entries(priorities)) {
        const ratio = count / total
        if (ratio >= 0.6 && total >= 3 && (priority === 'HIGH' || priority === 'URGENT')) {
          const userName = tasks.flatMap(t => t.assignees).find(a => a.user.id === userId)?.user.name || 'Unknown'
          suggestions.push({
            name: `Auto-set ${priority} priority when assigned to ${userName}`,
            trigger: { type: 'task_assigned', field: 'assignee', value: userId },
            action: { type: 'set_field', field: 'priority', value: priority },
            confidence: Math.round(ratio * 100) / 100,
          })
        }
      }
    }

    // Pattern 2: Status transition patterns (IN_PROGRESS → IN_REVIEW is common)
    const statusCounts: Record<string, number> = {}
    for (const task of tasks) {
      statusCounts[task.status] = (statusCounts[task.status] || 0) + 1
    }
    const inProgressCount = statusCounts['IN_PROGRESS'] || 0
    const inReviewCount = statusCounts['IN_REVIEW'] || 0
    if (inProgressCount > 0 && inReviewCount > 0 && inReviewCount >= inProgressCount * 0.5) {
      // Find most common reviewer (person with most IN_REVIEW tasks)
      const reviewAssignees: Record<string, { count: number; name: string }> = {}
      for (const task of tasks) {
        if (task.status === 'IN_REVIEW') {
          for (const a of task.assignees) {
            if (!reviewAssignees[a.user.id]) reviewAssignees[a.user.id] = { count: 0, name: a.user.name }
            reviewAssignees[a.user.id].count++
          }
        }
      }
      const topReviewer = Object.entries(reviewAssignees).sort((a, b) => b[1].count - a[1].count)[0]
      if (topReviewer) {
        suggestions.push({
          name: `Auto-assign ${topReviewer[1].name} as reviewer when status moves to IN_REVIEW`,
          trigger: { type: 'status_change', field: 'status', value: 'IN_REVIEW' },
          action: { type: 'assign_user', field: 'assignee', value: topReviewer[0] },
          confidence: Math.min(0.9, topReviewer[1].count / inReviewCount),
        })
      }
    }

    // Pattern 3: Common tag-based automations
    const tagCounts: Record<string, { total: number; statuses: Record<string, number>; priorities: Record<string, number> }> = {}
    for (const task of tasks) {
      for (const tag of task.tags) {
        if (!tagCounts[tag]) tagCounts[tag] = { total: 0, statuses: {}, priorities: {} }
        tagCounts[tag].total++
        tagCounts[tag].statuses[task.status] = (tagCounts[tag].statuses[task.status] || 0) + 1
        tagCounts[tag].priorities[task.priority] = (tagCounts[tag].priorities[task.priority] || 0) + 1
      }
    }
    for (const [tag, data] of Object.entries(tagCounts)) {
      if (data.total < 3) continue
      // Check if tag strongly correlates with a priority
      for (const [priority, count] of Object.entries(data.priorities)) {
        const ratio = count / data.total
        if (ratio >= 0.7 && (priority === 'HIGH' || priority === 'URGENT')) {
          suggestions.push({
            name: `Auto-set ${priority} priority for tasks tagged "${tag}"`,
            trigger: { type: 'tag_added', field: 'tag', value: tag },
            action: { type: 'set_field', field: 'priority', value: priority },
            confidence: Math.round(ratio * 100) / 100,
          })
        }
      }
    }

    // Pattern 4: High overdue rate → suggest auto-escalation
    const doneCount = statusCounts['DONE'] || 0
    const totalCount = tasks.length
    if (totalCount >= 5 && doneCount / totalCount < 0.3) {
      suggestions.push({
        name: 'Auto-escalate priority when task is overdue',
        trigger: { type: 'due_date_passed' },
        action: { type: 'set_field', field: 'priority', value: 'HIGH' },
        confidence: 0.6,
      })
    }

    // Limit to top 5 by confidence
    suggestions.sort((a, b) => b.confidence - a.confidence)

    return NextResponse.json({ suggestions: suggestions.slice(0, 5) })
  } catch (error) {
    console.error('Error generating automation suggestions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
