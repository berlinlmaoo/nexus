import prisma from "@/lib/prisma"
import type { TaskPriority, TaskStatus } from "@/generated/prisma"

export type OpsDashboardTask = {
  id: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  createdAt: string
  updatedAt: string
  tags: string[]
  taskListName: string
  project: {
    id: string
    name: string
    color: string
    icon: string
    division: string
    workspace: string
  }
  assignees: Array<{
    id: string
    name: string
    email: string
    avatar: string | null
  }>
}

export type OpsDashboardData = {
  generatedAt: string
  tasks: OpsDashboardTask[]
}

export async function getOpsDashboardTasks(workspaceIds: string[]): Promise<OpsDashboardData> {
  const tasks = await prisma.task.findMany({
    where: {
      status: {
        notIn: ["DONE", "CANCELLED"],
      },
      taskList: {
        project: {
          status: "ACTIVE",
          workspaceId: {
            in: workspaceIds,
          },
        },
      },
    },
    orderBy: [
      {
        dueDate: "asc",
      },
      {
        updatedAt: "desc",
      },
    ],
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      createdAt: true,
      updatedAt: true,
      tags: true,
      taskList: {
        select: {
          name: true,
          project: {
            select: {
              id: true,
              name: true,
              color: true,
              icon: true,
              folder: {
                select: {
                  name: true,
                },
              },
              workspace: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
      assignees: {
        orderBy: {
          assignedAt: "asc",
        },
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
      },
    },
  })

  return {
    generatedAt: new Date().toISOString(),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      tags: task.tags,
      taskListName: task.taskList.name,
      project: {
        id: task.taskList.project.id,
        name: task.taskList.project.name,
        color: task.taskList.project.color,
        icon: task.taskList.project.icon,
        division: task.taskList.project.folder?.name ?? "No folder",
        workspace: task.taskList.project.workspace.name,
      },
      assignees: task.assignees.map((assignee) => ({
        id: assignee.user.id,
        name: assignee.user.name,
        email: assignee.user.email,
        avatar: assignee.user.avatar,
      })),
    })),
  }
}
