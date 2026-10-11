export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { publicTemplates } from "@/lib/project-templates"

/**
 * GET /api/project-templates (owner, 12 Oct 2026): the New project gallery's templates, both languages.
 * The registry is code (lib/project-templates.ts); this only hands it out, so a client draws a new
 * template without an update. POST /api/projects { templateId } builds one.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ templates: publicTemplates() }, { headers: { "Cache-Control": "private, max-age=300" } })
}
