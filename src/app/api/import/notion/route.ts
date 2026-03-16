import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

const NOTION_BASE = 'https://api.notion.com/v1'

async function notionFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`${NOTION_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Notion API error ${res.status}: ${text}`)
  }
  return res.json()
}

function extractTitle(properties: Record<string, unknown>): string {
  for (const prop of Object.values(properties)) {
    const p = prop as { type?: string; title?: Array<{ plain_text: string }> }
    if (p.type === 'title' && p.title?.[0]) {
      return p.title.map((t) => t.plain_text).join('')
    }
  }
  return 'Untitled'
}

function extractStatus(properties: Record<string, unknown>): string {
  for (const [key, prop] of Object.entries(properties)) {
    const p = prop as { type?: string; status?: { name: string }; select?: { name: string } }
    if (key.toLowerCase().includes('status')) {
      const val = p.status?.name || p.select?.name || ''
      const lower = val.toLowerCase()
      if (lower.includes('done') || lower.includes('complete')) return 'DONE'
      if (lower.includes('progress') || lower.includes('doing')) return 'IN_PROGRESS'
      if (lower.includes('review')) return 'IN_REVIEW'
    }
  }
  return 'TODO'
}

function extractPriority(properties: Record<string, unknown>): string {
  for (const [key, prop] of Object.entries(properties)) {
    const p = prop as { type?: string; select?: { name: string } }
    if (key.toLowerCase().includes('priority') && p.select?.name) {
      const lower = p.select.name.toLowerCase()
      if (lower === 'urgent') return 'URGENT'
      if (lower === 'high') return 'HIGH'
      if (lower === 'low') return 'LOW'
      if (lower === 'none') return 'NONE'
    }
  }
  return 'MEDIUM'
}

function extractDate(properties: Record<string, unknown>): Date | null {
  for (const [key, prop] of Object.entries(properties)) {
    const p = prop as { type?: string; date?: { start: string } }
    if (
      (key.toLowerCase().includes('due') || key.toLowerCase().includes('date')) &&
      p.type === 'date' &&
      p.date?.start
    ) {
      return new Date(p.date.start)
    }
  }
  return null
}

function extractTags(properties: Record<string, unknown>): string[] {
  for (const [, prop] of Object.entries(properties)) {
    const p = prop as { type?: string; multi_select?: Array<{ name: string }> }
    if (p.type === 'multi_select' && p.multi_select) {
      return p.multi_select.map((s) => s.name)
    }
  }
  return []
}

function extractAssigneeEmails(properties: Record<string, unknown>): string[] {
  for (const [, prop] of Object.entries(properties)) {
    const p = prop as { type?: string; people?: Array<{ person?: { email: string } }> }
    if (p.type === 'people' && p.people) {
      return p.people
        .map((person) => person.person?.email)
        .filter(Boolean) as string[]
    }
  }
  return []
}

function extractRichText(properties: Record<string, unknown>): string {
  for (const [key, prop] of Object.entries(properties)) {
    const p = prop as { type?: string; rich_text?: Array<{ plain_text: string }> }
    if (
      p.type === 'rich_text' &&
      p.rich_text &&
      (key.toLowerCase().includes('description') || key.toLowerCase().includes('note'))
    ) {
      return p.rich_text.map((t) => t.plain_text).join('')
    }
  }
  return ''
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { integrationToken, databaseIds } = body

  if (!integrationToken || !databaseIds?.length) {
    return NextResponse.json(
      { error: 'integrationToken and databaseIds[] are required' },
      { status: 400 }
    )
  }

  const workspaceMember = await prisma.workspaceMember.findFirst({
    where: { userId: session.user.id },
  })

  if (!workspaceMember) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  const job = await prisma.importJob.create({
    data: {
      source: 'notion',
      status: 'running',
      userId: session.user.id,
      total: databaseIds.length,
    },
  })

  importFromNotion(
    integrationToken,
    databaseIds,
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

  return NextResponse.json({ jobId: job.id }, { status: 202 })
}

async function importFromNotion(
  token: string,
  databaseIds: string[],
  userId: string,
  workspaceId: string,
  jobId: string
) {
  let progress = 0
  const errors: string[] = []

  for (const dbId of databaseIds) {
    try {
      // Get database info
      const dbInfo = await notionFetch(`/databases/${dbId}`, token)
      const dbName =
        dbInfo.title?.[0]?.plain_text || 'Imported from Notion'

      // Create project
      const project = await prisma.project.create({
        data: {
          name: dbName,
          workspaceId,
          members: {
            create: { userId, role: 'LEAD' },
          },
        },
      })

      // Create default task list
      const taskList = await prisma.taskList.create({
        data: {
          name: 'Tasks',
          position: 0,
          projectId: project.id,
        },
      })

      // Query all pages in database
      let hasMore = true
      let startCursor: string | undefined = undefined
      let position = 0

      while (hasMore) {
        const queryBody: Record<string, unknown> = { page_size: 100 }
        if (startCursor) queryBody.start_cursor = startCursor

        const result = await notionFetch(
          `/databases/${dbId}/query`,
          token,
          { method: 'POST', body: JSON.stringify(queryBody) }
        )

        for (const page of result.results) {
          try {
            const props = page.properties || {}
            const title = extractTitle(props)
            const status = extractStatus(props)
            const priority = extractPriority(props)
            const dueDate = extractDate(props)
            const tags = extractTags(props)
            const description = extractRichText(props)
            const assigneeEmails = extractAssigneeEmails(props)

            // Find or create assignees
            const assigneeIds: string[] = []
            for (const email of assigneeEmails) {
              let user = await prisma.user.findUnique({ where: { email } })
              if (!user) {
                user = await prisma.user.create({
                  data: {
                    name: email.split('@')[0],
                    email,
                    password: null,
                  },
                })
              }
              assigneeIds.push(user.id)
            }

            const task = await prisma.task.create({
              data: {
                title,
                description: description || null,
                status: status as 'TODO' | 'DONE' | 'IN_PROGRESS' | 'IN_REVIEW',
                priority: priority as 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE',
                position: position++,
                dueDate,
                tags,
                taskListId: taskList.id,
                creatorId: userId,
                assignees:
                  assigneeIds.length > 0
                    ? { create: assigneeIds.map((id) => ({ userId: id })) }
                    : undefined,
              },
            })

            // Import page content as description (fetch blocks)
            try {
              const blocks = await notionFetch(
                `/blocks/${page.id}/children?page_size=100`,
                token
              )
              const contentParts: string[] = []
              for (const block of blocks.results) {
                if (block.type === 'paragraph' && block.paragraph?.rich_text) {
                  contentParts.push(
                    block.paragraph.rich_text
                      .map((t: { plain_text: string }) => t.plain_text)
                      .join('')
                  )
                } else if (
                  block.type === 'heading_1' &&
                  block.heading_1?.rich_text
                ) {
                  contentParts.push(
                    `# ${block.heading_1.rich_text.map((t: { plain_text: string }) => t.plain_text).join('')}`
                  )
                } else if (
                  block.type === 'heading_2' &&
                  block.heading_2?.rich_text
                ) {
                  contentParts.push(
                    `## ${block.heading_2.rich_text.map((t: { plain_text: string }) => t.plain_text).join('')}`
                  )
                } else if (
                  block.type === 'bulleted_list_item' &&
                  block.bulleted_list_item?.rich_text
                ) {
                  contentParts.push(
                    `- ${block.bulleted_list_item.rich_text.map((t: { plain_text: string }) => t.plain_text).join('')}`
                  )
                }
              }
              if (contentParts.length > 0) {
                await prisma.task.update({
                  where: { id: task.id },
                  data: { description: contentParts.join('\n\n') },
                })
              }
            } catch {
              // Block fetch may fail, continue
            }
          } catch (err) {
            errors.push(
              `Page import error: ${err instanceof Error ? err.message : 'Unknown'}`
            )
          }
        }

        hasMore = result.has_more
        startCursor = result.next_cursor
      }
    } catch (err) {
      errors.push(
        `Database "${dbId}": ${err instanceof Error ? err.message : 'Unknown error'}`
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
      details: { imported: progress, total: databaseIds.length, errors },
    },
  })
}
