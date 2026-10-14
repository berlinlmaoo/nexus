import { describe, expect, it } from "vitest"
import { withManualBreaksUnstretched } from "@/lib/legal/template"

const FLAG = "<w:doNotExpandShiftReturn/>"

describe("withManualBreaksUnstretched", () => {
  it("adds the flag at the start of an existing compat block", () => {
    const xml = `<w:settings><w:compat><w:compatSetting w:name="compatibilityMode" w:val="15"/></w:compat><w:rsids/></w:settings>`
    expect(withManualBreaksUnstretched(xml)).toBe(`<w:settings><w:compat>${FLAG}<w:compatSetting w:name="compatibilityMode" w:val="15"/></w:compat><w:rsids/></w:settings>`)
  })

  it("keeps schema order after the compat options that precede it", () => {
    const xml = `<w:settings><w:compat><w:spaceForUL/><w:ulTrailSpace/><w:doNotUseHTMLParagraphAutoSpacing/></w:compat></w:settings>`
    expect(withManualBreaksUnstretched(xml)).toBe(`<w:settings><w:compat><w:spaceForUL/><w:ulTrailSpace/>${FLAG}<w:doNotUseHTMLParagraphAutoSpacing/></w:compat></w:settings>`)
  })

  it("fills an empty compat element", () => {
    expect(withManualBreaksUnstretched(`<w:settings><w:compat/></w:settings>`)).toBe(`<w:settings><w:compat>${FLAG}</w:compat></w:settings>`)
  })

  it("creates compat before the parts that follow it", () => {
    const xml = `<w:settings><w:zoom w:percent="100"/><w:rsids><w:rsidRoot w:val="1"/></w:rsids><w:themeFontLang w:val="id-ID"/></w:settings>`
    expect(withManualBreaksUnstretched(xml)).toBe(`<w:settings><w:zoom w:percent="100"/><w:compat>${FLAG}</w:compat><w:rsids><w:rsidRoot w:val="1"/></w:rsids><w:themeFontLang w:val="id-ID"/></w:settings>`)
  })

  it("leaves a file that already has the flag alone", () => {
    const xml = `<w:settings><w:compat>${FLAG}</w:compat></w:settings>`
    expect(withManualBreaksUnstretched(xml)).toBe(xml)
  })
})
