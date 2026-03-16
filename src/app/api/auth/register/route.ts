import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, email, password } = body

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      )
    }

    if (!email.endsWith('@patsgroup.id')) {
      return NextResponse.json(
        { error: 'Only @patsgroup.id email addresses are allowed' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 409 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    })

    // Auto-create or join the default workspace "PATS Group"
    let workspace = await prisma.workspace.findUnique({
      where: { slug: 'pats-group' },
    })

    if (!workspace) {
      workspace = await prisma.workspace.create({
        data: {
          name: 'PATS Group',
          slug: 'pats-group',
          description: 'Default workspace for PATS Group',
        },
      })
    }

    await prisma.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        role: 'MEMBER',
      },
    })

    logAudit({ action: "create", entityType: "user", entityId: user.id, entityName: name, userId: user.id, request })

    // Return user without password
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _pw, ...userWithoutPassword } = user

    return NextResponse.json(userWithoutPassword, { status: 201 })
  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
