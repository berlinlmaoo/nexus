import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { checkProjectAccess } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    const automations = await prisma.automation.findMany({ where: { projectId }, orderBy: { name: 'asc' } })
    return NextResponse.json({ automations })
  } catch (error) {
    console.error('Error fetching automations:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { name, projectId, trigger, action } = await req.json()
    if (!name || !projectId || !trigger || !action) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ['LEAD'])
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden: LEAD role required to create automations' }, { status: 403 })
    }

    const automation = await prisma.automation.create({ data: { name, projectId, trigger, action } })

    logAudit({ action: "create", entityType: "automation", entityId: automation.id, entityName: name, userId: session.user.id, request: req })

    return NextResponse.json({ automation }, { status: 201 })
  } catch (error) {
    console.error('Error creating automation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id, enabled, name, trigger, action } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const existing = await prisma.automation.findUnique({ where: { id }, select: { projectId: true } })
    if (!existing) return NextResponse.json({ error: 'Automation not found' }, { status: 404 })

    const { allowed } = await checkProjectAccess(session.user.id, existing.projectId, ['LEAD'])
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden: LEAD role required to update automations' }, { status: 403 })
    }

    const automation = await prisma.automation.update({
      where: { id },
      data: { ...(enabled !== undefined && { enabled }), ...(name !== undefined && { name }), ...(trigger !== undefined && { trigger }), ...(action !== undefined && { action }) },
    })

    logAudit({ action: "update", entityType: "automation", entityId: id, entityName: automation.name, userId: session.user.id, request: req, metadata: { changes: { enabled, name, trigger, action } } })

    return NextResponse.json({ automation })
  } catch (error) {
    console.error('Error updating automation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const existing = await prisma.automation.findUnique({ where: { id }, select: { projectId: true, name: true } })
    if (!existing) return NextResponse.json({ error: 'Automation not found' }, { status: 404 })

    const { allowed } = await checkProjectAccess(session.user.id, existing.projectId, ['LEAD'])
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden: LEAD role required to delete automations' }, { status: 403 })
    }

    await prisma.automation.delete({ where: { id } })

    logAudit({ action: "delete", entityType: "automation", entityId: id, entityName: existing.name, userId: session.user.id, request: req })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting automation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
