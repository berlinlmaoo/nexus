import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    const fields = await prisma.customField.findMany({ where: { projectId }, include: { values: true } })
    return NextResponse.json({ fields })
  } catch (error) {
    console.error('Error fetching custom fields:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { name, type, projectId, options } = await req.json()
    if (!name || !type || !projectId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const field = await prisma.customField.create({ data: { name, type, projectId, options: options || null } })

    logAudit({ action: "create", entityType: "custom_field", entityId: field.id, entityName: name, userId: session.user.id, request: req, metadata: { projectId, type } })

    return NextResponse.json({ field }, { status: 201 })
  } catch (error) {
    console.error('Error creating custom field:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id, taskId, value } = await req.json()
    if (!id || !taskId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const fieldValue = await prisma.customFieldValue.upsert({
      where: { customFieldId_taskId: { customFieldId: id, taskId } },
      update: { value: String(value) },
      create: { customFieldId: id, taskId, value: String(value) },
    })

    logAudit({ action: "update", entityType: "custom_field_value", entityId: fieldValue.id, entityName: id, userId: session.user.id, request: req, metadata: { taskId, value } })

    return NextResponse.json({ fieldValue })
  } catch (error) {
    console.error('Error updating custom field value:', error)
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

    const existing = await prisma.customField.findUnique({ where: { id }, select: { name: true } })

    await prisma.customField.delete({ where: { id } })

    logAudit({ action: "delete", entityType: "custom_field", entityId: id, entityName: existing?.name, userId: session.user.id, request: req })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting custom field:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
