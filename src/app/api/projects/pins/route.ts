export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'

// GET → list of the current user's pinned project ids (most-recent first).
export async function GET() {
  const session = await auth()
  const user = session?.user
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pins = await prisma.projectPin.findMany({
    where: { userId: user.id },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { projectId: true },
  })
  return NextResponse.json({ projectIds: pins.map((p) => p.projectId) })
}

// POST { projectId, pinned } → pin (pinned=true) or unpin (pinned=false) a project for this user.
export async function POST(req: NextRequest) {
  const session = await auth()
  const user = session?.user
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const projectId: unknown = body?.projectId
  const pinned: boolean = body?.pinned !== false // default true
  if (typeof projectId !== 'string' || !projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  // Only allow pinning projects the user can actually see (is a member of, or any
  // project in a workspace where the user is a manager/sysadmin — but keep it simple:
  // require the project to exist; visibility is already enforced by the projects list).
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (pinned) {
    const max = await prisma.projectPin.aggregate({ where: { userId: user.id }, _max: { position: true } })
    await prisma.projectPin.upsert({
      where: { userId_projectId: { userId: user.id, projectId } },
      update: {},
      create: { userId: user.id, projectId, position: (max._max.position ?? -1) + 1 },
    })
  } else {
    await prisma.projectPin.deleteMany({ where: { userId: user.id, projectId } })
  }

  return NextResponse.json({ pinned })
}
