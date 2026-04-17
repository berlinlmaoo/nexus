import { redirect, notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { ProjectDetailClient } from "@/components/projects/project-detail-client"
import type { TaskCardData } from "@/components/tasks/task-card"
import { isSystemAdminUser } from "@/lib/rbac"
import { buildTaskCardCustomFieldChips } from "@/lib/task-card-custom-fields"

interface ProjectDetailPageProps {
  params: { projectId: string }
}

export const dynamic = "force-dynamic"

function serializePrimaryTask(
  task: {
    id: string
    title: string
    description: string | null
    status: TaskCardData["status"]
    priority: TaskCardData["priority"]
    dueDate: Date | null
    tags: string[]
    position: number
    taskListId: string
    createdAt: Date
    creator: { name: string }
    assignees: { user: { id: string; name: string; avatar: string | null } }[]
    subtasks: { id: string; status: string }[]
    customFieldValues: {
      customFieldId: string
      value: string
      customField: {
        name: string
        type: string
        options?: unknown
      }
    }[]
  },
  projectId: string,
  projectName: string,
  taskListName: string
): TaskCardData {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate?.toISOString() || null,
    tags: task.tags,
    position: task.position,
    projectId,
    viewProjectId: projectId,
    primaryProjectId: projectId,
    primaryProjectName: projectName,
    taskListId: task.taskListId,
    taskListName,
    isCrossProject: false,
    assignees: task.assignees.map((a) => ({
      id: a.user.id,
      name: a.user.name,
      avatar: a.user.avatar,
    })),
    customFieldChips: buildTaskCardCustomFieldChips(task.customFieldValues, task.createdAt, task.creator.name),
    subtaskCount: task.subtasks.length,
    subtaskDoneCount: task.subtasks.filter((s) => s.status === "DONE").length,
  }
}

function serializeLinkedTask(
  taskProject: {
    id: string
    position: number
    taskListId: string
    task: {
      id: string
      title: string
      description: string | null
      status: TaskCardData["status"]
      priority: TaskCardData["priority"]
      dueDate: Date | null
      tags: string[]
      position: number
      createdAt: Date
      creator: { name: string }
      assignees: { user: { id: string; name: string; avatar: string | null } }[]
      subtasks: { id: string; status: string }[]
      customFieldValues: {
        customFieldId: string
        value: string
      customField: {
        name: string
        type: string
        options?: unknown
      }
    }[]
      taskList: {
        projectId: string
        project: { id: string; name: string }
      }
    }
  },
  viewProjectId: string,
  taskListName: string
): TaskCardData {
  return {
    id: taskProject.task.id,
    title: taskProject.task.title,
    description: taskProject.task.description,
    status: taskProject.task.status,
    priority: taskProject.task.priority,
    dueDate: taskProject.task.dueDate?.toISOString() || null,
    tags: taskProject.task.tags,
    position: taskProject.position ?? taskProject.task.position,
    projectId: viewProjectId,
    viewProjectId,
    primaryProjectId: taskProject.task.taskList.projectId,
    primaryProjectName: taskProject.task.taskList.project.name,
    linkedProjectPlacementId: taskProject.id,
    taskListId: taskProject.taskListId,
    taskListName,
    isCrossProject: taskProject.task.taskList.projectId !== viewProjectId,
    assignees: taskProject.task.assignees.map((a) => ({
      id: a.user.id,
      name: a.user.name,
      avatar: a.user.avatar,
    })),
    customFieldChips: buildTaskCardCustomFieldChips(
      taskProject.task.customFieldValues,
      taskProject.task.createdAt,
      taskProject.task.creator.name
    ),
    subtaskCount: taskProject.task.subtasks.length,
    subtaskDoneCount: taskProject.task.subtasks.filter((s) => s.status === "DONE").length,
  }
}

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const isSystemAdmin = await isSystemAdminUser(session.user.id)

  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    include: {
      workspace: {
        select: {
          members: {
            where: { userId: session.user.id },
            select: { role: true },
            take: 1,
          },
        },
      },
      members: {
        include: {
          user: {
            select: { id: true, name: true, avatar: true },
          },
        },
      },
      taskLists: {
        orderBy: { position: "asc" },
        include: {
          tasks: {
            where: { parentId: null },
            orderBy: { position: "asc" },
            include: {
              assignees: {
                include: {
                  user: {
                    select: { id: true, name: true, avatar: true },
                  },
                },
              },
              subtasks: {
                select: { id: true, status: true },
              },
              creator: {
                select: {
                  name: true,
                },
              },
              customFieldValues: {
                include: {
                  customField: {
                    select: {
                      name: true,
                      type: true,
                      options: true,
                    },
                  },
                },
              },
            },
          },
          taskProjects: {
            where: {
              task: {
                parentId: null,
              },
            },
            orderBy: { position: "asc" },
            include: {
              task: {
                include: {
                  assignees: {
                    include: {
                      user: {
                        select: { id: true, name: true, avatar: true },
                      },
                    },
                  },
                  subtasks: {
                    select: { id: true, status: true },
                  },
                  creator: {
                    select: {
                      name: true,
                    },
                  },
                  customFieldValues: {
                    include: {
                      customField: {
                        select: {
                          name: true,
                          type: true,
                          options: true,
                        },
                      },
                    },
                  },
                  taskList: {
                    include: {
                      project: {
                        select: { id: true, name: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      pages: {
        where: { parentId: null },
        orderBy: { position: "asc" },
        select: { id: true, name: true, icon: true, pageType: true },
      },
    },
  })

  if (!project) notFound()

  const workspaceRole = project.workspace.members[0]?.role
  const hasWorkspaceAccess =
    isSystemAdmin || workspaceRole === "OWNER" || workspaceRole === "ADMIN"
  const isDirectProjectMember = project.members.some(
    (m) => m.user.id === session.user!.id
  )

  if (!hasWorkspaceAccess && !isDirectProjectMember) redirect("/projects")
  const currentMember = project.members.find((m) => m.user.id === session.user!.id)

  const projectData = {
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    icon: project.icon,
    enableTaskBatchDuplicate: project.enableTaskBatchDuplicate,
    autoAssignEnabled: project.autoAssignEnabled,
    autoAssignAssigneeIds: project.autoAssignAssigneeIds,
    members: project.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      avatar: m.user.avatar,
      role: m.role,
    })),
    taskLists: (() => {
      const seenTaskIds = new Set<string>()

      return project.taskLists.map((taskList) => {
        const taskMap = new Map<string, TaskCardData>()

        for (const task of taskList.tasks) {
          if (seenTaskIds.has(task.id)) continue
          taskMap.set(
            task.id,
            serializePrimaryTask(task, project.id, project.name, taskList.name)
          )
          seenTaskIds.add(task.id)
        }

        for (const taskProject of taskList.taskProjects) {
          if (taskMap.has(taskProject.task.id) || seenTaskIds.has(taskProject.task.id)) continue
          taskMap.set(
            taskProject.task.id,
            serializeLinkedTask(taskProject, project.id, taskList.name)
          )
          seenTaskIds.add(taskProject.task.id)
        }

        return {
          id: taskList.id,
          name: taskList.name,
          tasks: Array.from(taskMap.values()).sort((a, b) => a.position - b.position),
        }
      })
    })(),
    pages: project.pages,
  }

  return (
    <div className="h-full">
      <ProjectDetailClient
        project={projectData}
        currentUser={{
          id: session.user.id!,
          name: currentMember?.user.name || session.user.name || "User",
          avatar: currentMember?.user.avatar ?? session.user.image ?? null,
        }}
      />
    </div>
  )
}
