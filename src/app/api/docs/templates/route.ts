import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"

const SEED_TEMPLATES = [
  {
    title: "Meeting Notes",
    category: "meetings",
    content: {
      blocks: [
        { type: "heading", content: "Meeting Notes" },
        { type: "paragraph", content: "**Date:** " },
        { type: "paragraph", content: "**Attendees:** " },
        { type: "heading", content: "Agenda" },
        { type: "paragraph", content: "1. " },
        { type: "heading", content: "Discussion" },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Action Items" },
        { type: "paragraph", content: "- [ ] " },
        { type: "heading", content: "Next Steps" },
        { type: "paragraph", content: "" },
      ],
    },
  },
  {
    title: "Project Brief",
    category: "planning",
    content: {
      blocks: [
        { type: "heading", content: "Project Brief" },
        { type: "heading", content: "Overview" },
        { type: "paragraph", content: "Describe the project objectives and scope." },
        { type: "heading", content: "Goals" },
        { type: "paragraph", content: "- " },
        { type: "heading", content: "Timeline" },
        { type: "paragraph", content: "**Start Date:** \n**End Date:** " },
        { type: "heading", content: "Team" },
        { type: "paragraph", content: "| Role | Person |\n|------|--------|\n| Lead | |\n| Member | |" },
        { type: "heading", content: "Success Metrics" },
        { type: "paragraph", content: "- " },
      ],
    },
  },
  {
    title: "Technical Spec",
    category: "engineering",
    content: {
      blocks: [
        { type: "heading", content: "Technical Specification" },
        { type: "heading", content: "Summary" },
        { type: "paragraph", content: "Brief description of what is being built." },
        { type: "heading", content: "Background" },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Requirements" },
        { type: "paragraph", content: "### Functional\n- \n\n### Non-Functional\n- " },
        { type: "heading", content: "Technical Design" },
        { type: "paragraph", content: "" },
        { type: "heading", content: "API Changes" },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Data Model Changes" },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Testing Plan" },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Rollout Plan" },
        { type: "paragraph", content: "" },
      ],
    },
  },
  {
    title: "Weekly Update",
    category: "updates",
    content: {
      blocks: [
        { type: "heading", content: "Weekly Update" },
        { type: "paragraph", content: "**Week of:** " },
        { type: "heading", content: "Highlights" },
        { type: "paragraph", content: "- " },
        { type: "heading", content: "Completed This Week" },
        { type: "paragraph", content: "- " },
        { type: "heading", content: "In Progress" },
        { type: "paragraph", content: "- " },
        { type: "heading", content: "Planned for Next Week" },
        { type: "paragraph", content: "- " },
        { type: "heading", content: "Blockers / Risks" },
        { type: "paragraph", content: "- " },
      ],
    },
  },
  {
    title: "Decision Log",
    category: "general",
    content: {
      blocks: [
        { type: "heading", content: "Decision Log" },
        { type: "heading", content: "Decision" },
        { type: "paragraph", content: "What was decided?" },
        { type: "heading", content: "Context" },
        { type: "paragraph", content: "Why was this decision needed?" },
        { type: "heading", content: "Options Considered" },
        { type: "paragraph", content: "1. **Option A:** \n2. **Option B:** \n3. **Option C:** " },
        { type: "heading", content: "Decision Rationale" },
        { type: "paragraph", content: "Why was this option chosen?" },
        { type: "heading", content: "Implications" },
        { type: "paragraph", content: "- " },
        { type: "heading", content: "Decision Maker(s)" },
        { type: "paragraph", content: "- " },
      ],
    },
  },
]

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const workspaceId = req.nextUrl.searchParams.get("workspaceId")

    // If workspace has no templates, seed them
    if (workspaceId) {
      const count = await prisma.docTemplate.count({ where: { workspaceId } })
      if (count === 0) {
        await prisma.docTemplate.createMany({
          data: SEED_TEMPLATES.map(t => ({
            title: t.title,
            content: t.content as object,
            category: t.category,
            workspaceId,
          })),
        })
      }
    }

    const where: Record<string, unknown> = {}
    if (workspaceId) where.workspaceId = workspaceId

    const templates = await prisma.docTemplate.findMany({
      where,
      orderBy: { title: "asc" },
    })

    return NextResponse.json({ templates })
  } catch (error) {
    console.error("Error fetching doc templates:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
