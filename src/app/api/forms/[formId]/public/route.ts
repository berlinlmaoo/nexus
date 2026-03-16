import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const { formId } = await params

    const form = await prisma.form.findUnique({
      where: { id: formId },
      select: {
        id: true,
        name: true,
        description: true,
        fields: true,
        isPublic: true,
      },
    })

    if (!form) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 })
    }

    if (!form.isPublic) {
      return NextResponse.json({ error: "This form is not publicly accessible" }, { status: 403 })
    }

    return NextResponse.json(form)
  } catch (error) {
    console.error("Error fetching public form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
