export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET() {
  try {
    const session = await auth()

    if (!session || !session.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Find the workspace(s) the current user belongs to
    const userMemberships = await prisma.workspaceMember.findMany({
      where: { userId: session.user.id },
      select: { workspaceId: true },
    })

    if (userMemberships.length === 0) {
      return NextResponse.json([])
    }

    const workspaceIds = userMemberships.map((m: { workspaceId: string }) => m.workspaceId)

    // Get all members in those workspaces
    const workspaceMembers = await prisma.workspaceMember.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    })

    // Deduplicate users (in case they share multiple workspaces)
    const uniqueMembers = Array.from(
      new Map(workspaceMembers.map((m: { user: { id: string; name: string; email: string; avatar: string | null } }) => [m.user.id, m.user])).values()
    )

    return NextResponse.json(uniqueMembers)
  } catch (error) {
    console.error('Error fetching members:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
