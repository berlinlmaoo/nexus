export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { legalGate, settingsForbidden } from "@/lib/legal/access"
import { issuedCount, peekLegalNumber } from "@/lib/legal/numbering"
import { seriesProblem } from "@/lib/legal/rules"

type Ctx = { params: Promise<{ seriesId: string }> }

/** The series, how many numbers it has issued, and what its next number looks like today. */
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { seriesId } = await params
    const series = await prisma.legalSeries.findUnique({ where: { id: seriesId }, include: { company: { select: { code: true } } } })
    if (!series) return NextResponse.json({ error: "Series not found" }, { status: 404 })
    return NextResponse.json({
      series,
      issued: await issuedCount(series.key),
      next: await peekLegalNumber(series, series.company.code, {}, new Date()),
    })
  } catch (error) {
    console.error("Error loading a Legal series:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** label, format, resetPeriod, active. The running number continues; only numbers issued after change. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const forbidden = settingsForbidden(gate.actor)
    if (forbidden) return forbidden
    const { seriesId } = await params
    const series = await prisma.legalSeries.findUnique({ where: { id: seriesId }, include: { company: { select: { name: true } } } })
    if (!series) return NextResponse.json({ error: "Series not found" }, { status: 404 })
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const data: Prisma.LegalSeriesUpdateInput = {}
    if (typeof body.label === "string") {
      if (!body.label.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 })
      data.label = body.label.trim().slice(0, 120)
    }
    const format = typeof body.format === "string" ? body.format.trim() : series.format
    const resetPeriod = typeof body.resetPeriod === "string" ? body.resetPeriod : series.resetPeriod
    if (format !== series.format || resetPeriod !== series.resetPeriod) {
      const problem = seriesProblem(format, resetPeriod)
      if (problem) return NextResponse.json({ error: problem }, { status: 400 })
      data.format = format
      data.resetPeriod = resetPeriod
    }
    if (typeof body.active === "boolean") data.active = body.active
    const updated = await prisma.legalSeries.update({ where: { id: seriesId }, data })
    await logAudit({
      action: "update",
      entityType: "legal_series",
      entityId: seriesId,
      entityName: `${series.company.name}: ${updated.label}`,
      userId: gate.actor.userId,
      metadata: { changed: Object.keys(body), ...(data.format ? { format: { from: series.format, to: format } } : {}) },
      request,
    })
    return NextResponse.json({ series: updated })
  } catch (error) {
    console.error("Error updating a Legal series:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
