import { describe, expect, it } from "vitest"
import { getFormAccessStatus, normalizeFormAccessSchedule } from "@/lib/form-access-schedule"

describe("form access schedule", () => {
  it("allows forms without an enabled schedule", () => {
    expect(getFormAccessStatus(null).allowed).toBe(true)
    expect(getFormAccessStatus({ enabled: false }).allowed).toBe(true)
  })

  it("allows access inside the selected day and time in Jakarta", () => {
    const status = getFormAccessStatus(
      {
        enabled: true,
        daysOfWeek: [1],
        startTime: "09:00",
        endTime: "18:00",
        timezone: "Asia/Jakarta",
      },
      new Date("2026-05-25T04:00:00.000Z")
    )

    expect(status.allowed).toBe(true)
  })

  it("blocks access outside the selected day and time", () => {
    const status = getFormAccessStatus(
      {
        enabled: true,
        daysOfWeek: [1],
        startTime: "09:00",
        endTime: "18:00",
        timezone: "Asia/Jakarta",
      },
      new Date("2026-05-25T12:00:00.000Z")
    )

    expect(status.allowed).toBe(false)
  })

  it("normalizes invalid schedule input safely", () => {
    expect(
      normalizeFormAccessSchedule({
        enabled: true,
        daysOfWeek: [1, 1, 9, "2"],
        startTime: "99:99",
        endTime: "18:30",
      })
    ).toMatchObject({
      enabled: true,
      daysOfWeek: [1, 2],
      startTime: "00:00",
      endTime: "18:30",
      timezone: "Asia/Jakarta",
    })
  })
})
