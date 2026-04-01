import 'dotenv/config'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma'
import { hashSync } from 'bcryptjs'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  console.log('Seeding database...')

  // Clean up ALL tables in reverse dependency order
  // Use raw SQL truncate for reliability with foreign keys
  const tableNames = [
    'ProofAnnotation', 'Attachment', 'WebhookDelivery', 'Webhook',
    'FormSubmission', 'Form', 'GoalTask', 'GoalProject', 'GoalMilestone', 'Goal',
    'StatusUpdate', 'Favorite', 'SavedSearch', 'TaskLike', 'TaskFollower',
    'TaskRelation', 'TaskDependency', 'CustomFieldValue', 'CustomField',
    'SprintTask', 'Sprint', 'TimeEntry', 'CommentReaction', 'Comment',
    'TaskAssignee', 'TaskProject', 'ActivityLog', 'Notification',
    'NotificationPreference', 'AuditLog', 'InviteToken',
    'Task', 'TaskList', 'ProjectPage', 'Doc', 'DocTemplate',
    'Automation', 'PortfolioProject', 'Portfolio',
    'TeamProject', 'TeamMember', 'Team',
    'ProjectMember', 'Project',
    'WorkflowBundle', 'SsoConfig', 'UserSession', 'SyncedBlock',
    'WorkspaceMember', 'Workspace',
    'Account', 'ImportJob', 'User',
  ]

  for (const table of tableNames) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`)
    } catch {
      // Table might not exist yet, skip
    }
  }

  console.log('Cleaned existing data.')

  // Create users
  const hashedPassword = hashSync('password123', 10)

  const berlin = await prisma.user.create({
    data: {
      name: 'Berlin Taufik',
      email: 'berlin@patsgroup.id',
      password: hashedPassword,
      role: 'ADMIN',
    },
  })

  const anya = await prisma.user.create({
    data: {
      name: 'Anya Putri',
      email: 'anya@patsgroup.id',
      password: hashedPassword,
      role: 'MEMBER',
    },
  })

  const rizky = await prisma.user.create({
    data: {
      name: 'Rizky Pratama',
      email: 'rizky@patsgroup.id',
      password: hashedPassword,
      role: 'MEMBER',
    },
  })

  const sari = await prisma.user.create({
    data: {
      name: 'Sari Dewi',
      email: 'sari@patsgroup.id',
      password: hashedPassword,
      role: 'MEMBER',
    },
  })

  const fajar = await prisma.user.create({
    data: {
      name: 'Fajar Nugroho',
      email: 'fajar@patsgroup.id',
      password: hashedPassword,
      role: 'MEMBER',
    },
  })

  const allUsers = [berlin, anya, rizky, sari, fajar]
  console.log(`Created ${allUsers.length} users.`)

  // Create workspace
  const workspace = await prisma.workspace.create({
    data: {
      name: 'PATS Group',
      slug: 'pats-group',
      description: 'PATS Group main workspace for project management',
    },
  })

  // Add workspace members
  await prisma.workspaceMember.createMany({
    data: [
      { userId: berlin.id, workspaceId: workspace.id, role: 'OWNER' },
      { userId: anya.id, workspaceId: workspace.id, role: 'MEMBER' },
      { userId: rizky.id, workspaceId: workspace.id, role: 'MEMBER' },
      { userId: sari.id, workspaceId: workspace.id, role: 'MEMBER' },
      { userId: fajar.id, workspaceId: workspace.id, role: 'MEMBER' },
    ],
  })

  console.log('Created workspace and members.')

  // Create projects
  const apexProject = await prisma.project.create({
    data: {
      name: 'APEX Development',
      description: 'Internal project management application development',
      color: '#7B2FBE',
      icon: 'rocket',
      workspaceId: workspace.id,
    },
  })

  const clientPortal = await prisma.project.create({
    data: {
      name: 'Client Portal',
      description: 'Client-facing portal for project tracking and communication',
      color: '#2F8FBE',
      icon: 'globe',
      workspaceId: workspace.id,
    },
  })

  const marketingCampaign = await prisma.project.create({
    data: {
      name: 'Marketing Campaign Q1',
      description: 'Q1 marketing campaign planning and execution',
      color: '#BE2F5A',
      icon: 'megaphone',
      workspaceId: workspace.id,
    },
  })

  const projects = [apexProject, clientPortal, marketingCampaign]
  console.log(`Created ${projects.length} projects.`)

  // Add project members
  for (const project of projects) {
    await prisma.projectMember.createMany({
      data: [
        { userId: berlin.id, projectId: project.id, role: 'LEAD' },
        { userId: anya.id, projectId: project.id, role: 'MEMBER' },
        { userId: rizky.id, projectId: project.id, role: 'MEMBER' },
        { userId: sari.id, projectId: project.id, role: 'MEMBER' },
        { userId: fajar.id, projectId: project.id, role: 'MEMBER' },
      ],
    })
  }

  console.log('Added project members.')

  // Create task lists for each project
  const listNames = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done']

  const taskListMap: Record<string, Record<string, string>> = {}

  for (const project of projects) {
    taskListMap[project.id] = {}
    for (let i = 0; i < listNames.length; i++) {
      const tl = await prisma.taskList.create({
        data: {
          name: listNames[i],
          position: i,
          projectId: project.id,
        },
      })
      taskListMap[project.id][listNames[i]] = tl.id
    }
  }

  console.log('Created task lists.')

  // Helper to get task list ID
  const getListId = (projectId: string, listName: string) =>
    taskListMap[projectId][listName]

  // Create tasks for APEX Development
  const task1 = await prisma.task.create({
    data: {
      title: 'Implement user authentication',
      description: 'Set up NextAuth.js with credentials provider and JWT sessions',
      status: 'DONE',
      priority: 'HIGH',
      taskListId: getListId(apexProject.id, 'Done'),
      creatorId: berlin.id,
    },
  })

  const task2 = await prisma.task.create({
    data: {
      title: 'Design dashboard layout',
      description: 'Create responsive dashboard layout with sidebar navigation and main content area',
      status: 'IN_REVIEW',
      priority: 'HIGH',
      taskListId: getListId(apexProject.id, 'Review'),
      creatorId: berlin.id,
    },
  })

  const task3 = await prisma.task.create({
    data: {
      title: 'Set up CI/CD pipeline',
      description: 'Configure GitHub Actions for automated testing and deployment',
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      taskListId: getListId(apexProject.id, 'In Progress'),
      creatorId: rizky.id,
    },
  })

  const task4 = await prisma.task.create({
    data: {
      title: 'Write API documentation',
      description: 'Document all REST API endpoints with request/response examples',
      status: 'TODO',
      priority: 'MEDIUM',
      taskListId: getListId(apexProject.id, 'To Do'),
      creatorId: anya.id,
    },
  })

  const task5 = await prisma.task.create({
    data: {
      title: 'Fix login redirect bug',
      description: 'Users are not being redirected to the dashboard after successful login',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      taskListId: getListId(apexProject.id, 'In Progress'),
      creatorId: berlin.id,
    },
  })

  const task6 = await prisma.task.create({
    data: {
      title: 'Create onboarding flow',
      description: 'Design and implement new user onboarding with workspace and project setup wizard',
      status: 'TODO',
      priority: 'HIGH',
      taskListId: getListId(apexProject.id, 'To Do'),
      creatorId: sari.id,
    },
  })

  const task7 = await prisma.task.create({
    data: {
      title: 'Implement drag-and-drop for task board',
      description: 'Add drag-and-drop functionality to move tasks between lists',
      status: 'DONE',
      priority: 'HIGH',
      taskListId: getListId(apexProject.id, 'Done'),
      creatorId: berlin.id,
    },
  })

  const task8 = await prisma.task.create({
    data: {
      title: 'Add GIDEON AI assistant',
      description: 'Integrate AI-powered assistant for task management via natural language',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      taskListId: getListId(apexProject.id, 'In Progress'),
      creatorId: berlin.id,
    },
  })

  // Create tasks for Client Portal
  const task9 = await prisma.task.create({
    data: {
      title: 'Design client dashboard mockups',
      description: 'Create Figma mockups for the client-facing dashboard',
      status: 'DONE',
      priority: 'HIGH',
      taskListId: getListId(clientPortal.id, 'Done'),
      creatorId: sari.id,
    },
  })

  const task10 = await prisma.task.create({
    data: {
      title: 'Implement client login page',
      description: 'Build a branded login page for clients with email/password auth',
      status: 'IN_REVIEW',
      priority: 'HIGH',
      taskListId: getListId(clientPortal.id, 'Review'),
      creatorId: anya.id,
    },
  })

  const task11 = await prisma.task.create({
    data: {
      title: 'Build project progress tracker',
      description: 'Client-visible project progress with milestones and percentage completion',
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      taskListId: getListId(clientPortal.id, 'In Progress'),
      creatorId: rizky.id,
    },
  })

  const task12 = await prisma.task.create({
    data: {
      title: 'Set up client notifications',
      description: 'Email notification system for project updates sent to clients',
      status: 'TODO',
      priority: 'LOW',
      taskListId: getListId(clientPortal.id, 'To Do'),
      creatorId: fajar.id,
    },
  })

  const task13 = await prisma.task.create({
    data: {
      title: 'Create file sharing module',
      description: 'Secure file sharing between team and clients with version control',
      status: 'TODO',
      priority: 'MEDIUM',
      taskListId: getListId(clientPortal.id, 'Backlog'),
      creatorId: berlin.id,
    },
  })

  // Create tasks for Marketing Campaign Q1
  const task14 = await prisma.task.create({
    data: {
      title: 'Draft social media content calendar',
      description: 'Plan posts for Instagram, LinkedIn, and Twitter for January-March',
      status: 'DONE',
      priority: 'HIGH',
      taskListId: getListId(marketingCampaign.id, 'Done'),
      creatorId: sari.id,
    },
  })

  const task15 = await prisma.task.create({
    data: {
      title: 'Design promotional banners',
      description: 'Create banner designs for web and social media campaigns',
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      taskListId: getListId(marketingCampaign.id, 'In Progress'),
      creatorId: sari.id,
    },
  })

  const task16 = await prisma.task.create({
    data: {
      title: 'Set up email marketing automation',
      description: 'Configure automated email sequences for lead nurturing',
      status: 'TODO',
      priority: 'HIGH',
      taskListId: getListId(marketingCampaign.id, 'To Do'),
      creatorId: anya.id,
    },
  })

  const task17 = await prisma.task.create({
    data: {
      title: 'Analyze Q4 campaign results',
      description: 'Compile analytics report from Q4 campaigns to inform Q1 strategy',
      status: 'DONE',
      priority: 'MEDIUM',
      taskListId: getListId(marketingCampaign.id, 'Done'),
      creatorId: fajar.id,
    },
  })

  const task18 = await prisma.task.create({
    data: {
      title: 'Plan product launch event',
      description: 'Organize virtual launch event for new APEX platform',
      status: 'TODO',
      priority: 'URGENT',
      taskListId: getListId(marketingCampaign.id, 'To Do'),
      creatorId: berlin.id,
    },
  })

  const allTasks = [
    task1, task2, task3, task4, task5, task6, task7, task8,
    task9, task10, task11, task12, task13,
    task14, task15, task16, task17, task18,
  ]
  console.log(`Created ${allTasks.length} tasks.`)

  // Assign tasks to users
  const assignments = [
    { taskId: task1.id, userId: berlin.id },
    { taskId: task1.id, userId: rizky.id },
    { taskId: task2.id, userId: sari.id },
    { taskId: task2.id, userId: anya.id },
    { taskId: task3.id, userId: rizky.id },
    { taskId: task4.id, userId: anya.id },
    { taskId: task5.id, userId: berlin.id },
    { taskId: task6.id, userId: sari.id },
    { taskId: task6.id, userId: fajar.id },
    { taskId: task7.id, userId: berlin.id },
    { taskId: task8.id, userId: berlin.id },
    { taskId: task9.id, userId: sari.id },
    { taskId: task10.id, userId: anya.id },
    { taskId: task11.id, userId: rizky.id },
    { taskId: task12.id, userId: fajar.id },
    { taskId: task13.id, userId: rizky.id },
    { taskId: task14.id, userId: sari.id },
    { taskId: task15.id, userId: sari.id },
    { taskId: task16.id, userId: anya.id },
    { taskId: task17.id, userId: fajar.id },
    { taskId: task18.id, userId: berlin.id },
    { taskId: task18.id, userId: sari.id },
  ]

  await prisma.taskAssignee.createMany({ data: assignments })
  console.log(`Created ${assignments.length} task assignments.`)

  // Create sample comments
  await prisma.comment.createMany({
    data: [
      {
        content: 'Authentication is working great with JWT. Closing this one.',
        taskId: task1.id,
        userId: berlin.id,
      },
      {
        content: 'The sidebar looks good but we need to adjust the mobile breakpoints.',
        taskId: task2.id,
        userId: anya.id,
      },
      {
        content: 'I have set up the GitHub Actions workflow. Testing deployment to staging now.',
        taskId: task3.id,
        userId: rizky.id,
      },
      {
        content: 'This is a critical bug - users are getting stuck on the login page after entering correct credentials.',
        taskId: task5.id,
        userId: berlin.id,
      },
      {
        content: 'I think the issue is with the callback URL configuration in NextAuth.',
        taskId: task5.id,
        userId: rizky.id,
      },
      {
        content: 'Mockups are approved by the client. Moving to implementation.',
        taskId: task9.id,
        userId: sari.id,
      },
      {
        content: 'Content calendar draft is ready for review. Please check the shared doc.',
        taskId: task14.id,
        userId: sari.id,
      },
      {
        content: 'The GIDEON integration is coming along nicely. Streaming responses work well.',
        taskId: task8.id,
        userId: berlin.id,
      },
    ],
  })
  console.log('Created sample comments.')

  // Create activity logs
  await prisma.activityLog.createMany({
    data: [
      {
        action: 'TASK_CREATED',
        details: 'Created task: Implement user authentication',
        userId: berlin.id,
        taskId: task1.id,
        projectId: apexProject.id,
      },
      {
        action: 'TASK_STATUS_UPDATED',
        details: 'Updated task "Implement user authentication" status to DONE',
        userId: berlin.id,
        taskId: task1.id,
        projectId: apexProject.id,
      },
      {
        action: 'TASK_CREATED',
        details: 'Created task: Design dashboard layout',
        userId: berlin.id,
        taskId: task2.id,
        projectId: apexProject.id,
      },
      {
        action: 'TASK_STATUS_UPDATED',
        details: 'Updated task "Design dashboard layout" status to IN_REVIEW',
        userId: sari.id,
        taskId: task2.id,
        projectId: apexProject.id,
      },
      {
        action: 'TASK_CREATED',
        details: 'Created task: Fix login redirect bug',
        userId: berlin.id,
        taskId: task5.id,
        projectId: apexProject.id,
      },
      {
        action: 'TASK_CREATED',
        details: 'Created task: Add GIDEON AI assistant',
        userId: berlin.id,
        taskId: task8.id,
        projectId: apexProject.id,
      },
      {
        action: 'PROJECT_CREATED',
        details: 'Created project: Client Portal',
        userId: berlin.id,
        projectId: clientPortal.id,
      },
      {
        action: 'PROJECT_CREATED',
        details: 'Created project: Marketing Campaign Q1',
        userId: berlin.id,
        projectId: marketingCampaign.id,
      },
    ],
  })
  console.log('Created activity logs.')

  console.log('\nSeed completed successfully!')
  console.log('\nDefault login credentials:')
  console.log('  Email: berlin@patsgroup.id')
  console.log('  Password: password123')
}

main()
  .then(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
  .catch(async (e) => {
    console.error('Seed error:', e)
    await prisma.$disconnect()
    await pool.end()
    process.exit(1)
  })
