import { describe, expect, it } from "vitest"
import { effectiveOrigin, effectiveSource, originWhere, parseOriginFilter } from "@/lib/announcement-origin"

describe("announcement origin (22 Oct 2026)", () => {
  it("defaults to all for released apps that send no ?origin", () => {
    expect(parseOriginFilter(null)).toBe("all")
    expect(parseOriginFilter("")).toBe("all")
    expect(parseOriginFilter("whatever")).toBe("all")
    expect(originWhere("all")).toEqual({})
  })
  it("reads manual and system (auto as an alias)", () => {
    expect(parseOriginFilter("manual")).toBe("manual")
    expect(parseOriginFilter("SYSTEM")).toBe("system")
    expect(parseOriginFilter("auto")).toBe("system")
  })
  it("treats a warning as system whatever the column says", () => {
    expect(effectiveOrigin({ origin: "manual", kind: "warning" })).toBe("system")
    expect(effectiveSource({ origin: "manual", kind: "warning", source: "composer" })).toBe("attendance_warning")
    expect(originWhere("manual")).toEqual({ origin: "manual", NOT: { kind: "warning" } })
    expect(originWhere("system")).toEqual({ OR: [{ origin: "system" }, { kind: "warning" }] })
  })
  it("keeps manual posts manual and unknown sources legacy", () => {
    expect(effectiveOrigin({ origin: "manual", kind: "announcement" })).toBe("manual")
    expect(effectiveOrigin({ origin: "system", kind: "sp" })).toBe("system")
    expect(effectiveSource({ origin: "system", kind: "announcement", source: "gideon" })).toBe("gideon")
    expect(effectiveSource({ origin: "manual", kind: "announcement", source: "???" })).toBe("legacy")
  })
})
