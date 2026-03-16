# APEX - Agile Project & Execution Hub

A full-stack SaaS project management application built for **PATS Group**, featuring an AI-powered assistant (GIDEON) for intelligent task management.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Database:** PostgreSQL with Prisma ORM
- **Authentication:** NextAuth.js v5 (Credentials provider, JWT sessions)
- **AI Assistant:** Anthropic Claude (via @anthropic-ai/sdk)
- **UI:** Tailwind CSS, Radix UI, Lucide Icons
- **State Management:** Zustand
- **Drag & Drop:** @hello-pangea/dnd

## Features

- Workspace and project management
- Kanban-style task boards with drag-and-drop
- Task creation, assignment, and status tracking
- Team member management with role-based access
- Activity logs and comments
- **GIDEON AI Assistant** - Natural language task management powered by Claude

## Prerequisites

- Node.js 18+
- PostgreSQL database
- Anthropic API key (for GIDEON AI features)

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url>
cd pats-app
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

- `DATABASE_URL` - Your PostgreSQL connection string
- `NEXTAUTH_SECRET` - Generate with `openssl rand -base64 32`
- `ANTHROPIC_API_KEY` - Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

### 3. Set Up Database

```bash
npx prisma generate
npx prisma migrate dev
```

### 4. Seed Database

```bash
npx prisma db seed
```

### 5. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Default Login Credentials

| Name          | Email                  | Password      | Role   |
|---------------|------------------------|---------------|--------|
| Berlin Taufik | berlin@patsgroup.id    | password123   | ADMIN  |
| Anya Putri    | anya@patsgroup.id      | password123   | MEMBER |
| Rizky Pratama | rizky@patsgroup.id     | password123   | MEMBER |
| Sari Dewi     | sari@patsgroup.id      | password123   | MEMBER |
| Fajar Nugroho | fajar@patsgroup.id     | password123   | MEMBER |

## Project Structure

```
src/
  app/
    api/
      gideon/          # GIDEON AI API endpoint
      auth/            # NextAuth API routes
      tasks/           # Task CRUD endpoints
      projects/        # Project endpoints
      ...
    dashboard/         # Dashboard page
    login/             # Login page
    register/          # Registration page
  components/
    gideon/            # GIDEON AI assistant components
      gideon-button.tsx   # Floating action button
      gideon-panel.tsx    # Chat panel
      message-bubble.tsx  # Chat message component
      tool-result-card.tsx # Tool result display
    ui/                # Shared UI components (Button, Card, etc.)
  generated/
    prisma/            # Generated Prisma client
  lib/
    auth.ts            # NextAuth configuration
    prisma.ts          # Prisma client singleton
    utils.ts           # Utility functions
prisma/
  schema.prisma        # Database schema
  seed.ts              # Database seed script
  prisma.config.ts     # Prisma configuration
```

## GIDEON AI Assistant

GIDEON (Guided Intelligence for Digital Execution & Operations Network) is an AI-powered assistant that helps manage projects and tasks through natural language. Access it via the floating button in the bottom-right corner.

### Capabilities

- **Create tasks** - "Create a high priority task to fix the payment bug in APEX Development"
- **Update task status** - "Mark the authentication task as done"
- **Assign tasks** - "Assign the CI/CD task to Rizky"
- **List tasks** - "Show me all in-progress tasks" or "What tasks are assigned to me?"
- **List projects** - "Show me all projects"

### Model Selection

Toggle between Claude Sonnet (faster) and Claude Opus (more capable) using the switch in the GIDEON panel header.
