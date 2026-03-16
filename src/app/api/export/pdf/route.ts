import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { jsPDF } from 'jspdf'

export async function GET(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const includeCompleted = searchParams.get('includeCompleted') !== 'false'

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }

    const member = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId } },
    })

    if (!member) {
      return NextResponse.json({ error: 'Not a project member' }, { status: 403 })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        members: {
          include: { user: { select: { name: true } } },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const taskWhere: Record<string, unknown> = {
      taskList: { projectId },
    }
    if (!includeCompleted) {
      taskWhere.status = { not: 'DONE' }
    }

    const tasks = await prisma.task.findMany({
      where: taskWhere,
      include: {
        assignees: {
          include: { user: { select: { name: true } } },
        },
        taskList: { select: { name: true } },
      },
      orderBy: [{ taskList: { position: 'asc' } }, { position: 'asc' }],
    })

    // Stats
    const statusCounts: Record<string, number> = {}
    const assigneeCounts: Record<string, number> = {}
    for (const task of tasks) {
      statusCounts[task.status] = (statusCounts[task.status] || 0) + 1
      for (const a of task.assignees) {
        assigneeCounts[a.user.name] = (assigneeCounts[a.user.name] || 0) + 1
      }
    }

    const allTasks = await prisma.task.count({ where: { taskList: { projectId } } })
    const completedTasks = await prisma.task.count({
      where: { taskList: { projectId }, status: 'DONE' },
    })
    const completionPct =
      allTasks > 0 ? Math.round((completedTasks / allTasks) * 100) : 0

    // Generate PDF
    const doc = new jsPDF()
    let y = 20

    // Title
    doc.setFontSize(20)
    doc.setFont('helvetica', 'bold')
    doc.text(project.name, 14, y)
    y += 8

    if (project.description) {
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(100)
      const descLines = doc.splitTextToSize(project.description, 180)
      doc.text(descLines, 14, y)
      y += descLines.length * 5 + 4
    }

    doc.setTextColor(0)
    doc.setFontSize(9)
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, y)
    y += 10

    // Summary section
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('Project Summary', 14, y)
    y += 8

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Total Tasks: ${allTasks}`, 14, y); y += 5
    doc.text(`Completed: ${completedTasks} (${completionPct}%)`, 14, y); y += 5
    doc.text(`Members: ${project.members.map((m) => m.user.name).join(', ')}`, 14, y); y += 5

    // Status breakdown
    y += 3
    doc.text('By Status:', 14, y); y += 5
    for (const [status, count] of Object.entries(statusCounts)) {
      doc.text(`  ${status}: ${count}`, 14, y); y += 5
    }

    // By assignee
    y += 3
    doc.text('By Assignee:', 14, y); y += 5
    for (const [name, count] of Object.entries(assigneeCounts)) {
      doc.text(`  ${name}: ${count}`, 14, y); y += 5
      if (y > 270) { doc.addPage(); y = 20 }
    }

    // Task list
    y += 5
    if (y > 250) { doc.addPage(); y = 20 }

    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('Task List', 14, y)
    y += 8

    // Table header
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setFillColor(240, 240, 240)
    doc.rect(14, y - 4, 182, 7, 'F')
    doc.text('Task', 16, y)
    doc.text('Status', 100, y)
    doc.text('Priority', 130, y)
    doc.text('Assignee', 155, y)
    y += 6

    doc.setFont('helvetica', 'normal')
    for (const task of tasks) {
      if (y > 275) {
        doc.addPage()
        y = 20
      }

      const title = task.title.length > 45
        ? task.title.substring(0, 42) + '...'
        : task.title
      const assignee = task.assignees.map((a) => a.user.name).join(', ')
      const truncAssignee = assignee.length > 15
        ? assignee.substring(0, 12) + '...'
        : assignee

      doc.text(title, 16, y)
      doc.text(task.status.replace('_', ' '), 100, y)
      doc.text(task.priority, 130, y)
      doc.text(truncAssignee, 155, y)
      y += 5
    }

    const pdfBuffer = doc.output('arraybuffer')

    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${project.name}-report.pdf"`,
      },
    })
  } catch (error) {
    console.error('Error exporting PDF:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
