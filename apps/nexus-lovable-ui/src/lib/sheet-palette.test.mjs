// node --experimental-strip-types src/lib/sheet-palette.test.mjs   (from apps/nexus-lovable-ui)
//
// The Sheets colour palette, legacy colour mapping, font sizes, and the cell-style helpers that paint
// them (hex colours, fonts, wrap, rotation, borders with style + colour).
import assert from "node:assert/strict"
import {
  PALETTE, PALETTE_ROWS, STANDARD_THEME, toHex, readableText, swatchOf, fontStack, ptToPx, pxToPt,
  FONT_SIZES_PT, DEFAULT_FONT_PT, FONT_FAMILIES, LEGACY_COLOR_HEX,
} from "./sheet-palette.ts"
import {
  applyBorderPreset, borderOverlay, cellBorders, clearNeighbourEdge, fontPt, rotatedBox, rotationStyle,
  styleClasses, styleInline, wrapMode, bordersFor, borderShadows,
} from "../components/sheets/sheet-style.ts"

// ── Palette ──
assert.equal(PALETTE_ROWS.length, 8)
for (const row of PALETTE_ROWS) assert.equal(row.length, 10)
assert.equal(new Set(PALETTE.map((s) => s.hex)).size, 80, "80 distinct swatches")
assert.ok(PALETTE.every((s) => /^#[0-9a-f]{6}$/.test(s.hex)))
assert.deepEqual(PALETTE_ROWS[0].map((s) => s.hex),
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"])
assert.equal(PALETTE_ROWS[1][0].hex, "#980000")
assert.deepEqual(swatchOf("#FFE599"), { hex: "#ffe599", en: "light yellow 2", id: "kuning muda 2" })
assert.equal(swatchOf("#cc4125").en, "light red berry 1")
assert.equal(swatchOf("#a61c00").en, "dark red berry 1")
assert.equal(swatchOf("#a61c00").id, "beri merah tua 1")
assert.deepEqual(STANDARD_THEME, ["#000000", "#ffffff", "#4285f4", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6"])

// ── Colours ──
assert.equal(toHex("#ABC"), "#aabbcc")
assert.equal(toHex("#FFCFC9"), "#ffcfc9")
assert.equal(toHex("amber"), LEGACY_COLOR_HEX.amber)
assert.equal(toHex("rose"), LEGACY_COLOR_HEX.rose)
assert.equal(toHex("nonsense"), null)
assert.equal(toHex(undefined), null)
assert.equal(readableText("#ffe599"), "#000000")
assert.equal(readableText("#000000"), "#ffffff")
assert.equal(readableText("#434343"), "#ffffff")
assert.equal(readableText("#ffffff"), "#000000")

// ── Fonts ──
assert.equal(FONT_FAMILIES[0].name, "Default")
assert.equal(fontStack(undefined), undefined)
assert.equal(fontStack("Default"), undefined)
assert.match(fontStack("courier new"), /Courier New/)
assert.match(fontStack("Lobster"), /'Lobster', inherit/)
assert.deepEqual(FONT_SIZES_PT, [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36])
assert.equal(DEFAULT_FONT_PT, 10)
assert.equal(ptToPx(12), 16)
assert.equal(pxToPt(16), 12)
assert.equal(pxToPt(13), 10)

// ── Cell style painting ──
assert.equal(styleClasses({ fc: "red", bg: "amber" }).includes("text-red-600"), true)
assert.equal(styleClasses({ fc: "#ff0000", bg: "#ffe599" }), "", "hex colours are not classes")
assert.deepEqual(styleInline({ fc: "#ff0000", bg: "#ffe599" }), { color: "#ff0000", backgroundColor: "#ffe599" })
assert.deepEqual(styleInline({ bg: "#000000" }), { backgroundColor: "#000000", color: "#ffffff" }, "readable text on a dark fill")
assert.deepEqual(styleInline({ bg: "red" }), {}, "legacy fill stays a class")
assert.equal(styleInline({ fp: 12, fs: 20 }).fontSize, 16, "points win over legacy px")
assert.equal(styleInline({ fs: 20 }).fontSize, 20)
assert.match(styleInline({ ff: "Georgia" }).fontFamily, /Georgia/)
assert.equal(fontPt({ fp: 14 }), 14)
assert.equal(fontPt({ fs: 16 }), 12)
assert.equal(fontPt(undefined), 10)
assert.equal(wrapMode({ w: 1 }), "w")
assert.equal(wrapMode({ w: 1, wr: "c" }), "c")
assert.equal(wrapMode({}), "o")
assert.deepEqual(rotationStyle({}), {})
assert.equal(rotationStyle({ rt: 45 }).transform, "rotate(-45deg)")
assert.equal(rotationStyle({ rt: "v" }).textOrientation, "upright")
const flat = rotatedBox("hello", {}, 10)
const up = rotatedBox("hello", { rt: 90 }, 10)
assert.ok(Math.abs(up.h - flat.w) < 1e-6 && Math.abs(up.w - flat.h) < 1e-6, "90° swaps the box")
assert.ok(rotatedBox("hello", { rt: "v" }, 10).h > rotatedBox("hello", { rt: 45 }, 10).h)

// ── Borders ──
assert.deepEqual(cellBorders({ bd: "tb" }), { t: { s: "thin" }, b: { s: "thin" } })
assert.deepEqual(cellBorders({ bd: "t", bx: { t: { s: "thick", c: "#ff0000" } } }), { t: { s: "thick", c: "#ff0000" } })
assert.equal(borderOverlay({}), null)
const ov = borderOverlay({ bx: { b: { s: "dashed", c: "#0000ff" }, l: { s: "double" } } })
assert.equal(ov.borderBottom, "1px dashed #0000ff")
assert.equal(ov.borderLeft, "3px double var(--foreground)")
assert.equal(ov.position, "absolute")

const rect = { top: 0, bottom: 2, left: 0, right: 2 }
const at = (preset, r, c, cur, line = "thin", color = null) => applyBorderPreset(preset, r, c, rect, cur, line, color)
// all: every gridline once — internal edges live on the upper/left cell only.
assert.deepEqual(Object.keys(at("all", 0, 0).bx).sort(), ["b", "l", "r", "t"])
assert.deepEqual(Object.keys(at("all", 1, 1).bx).sort(), ["b", "r"])
assert.deepEqual(Object.keys(at("all", 2, 2).bx).sort(), ["b", "r"])
assert.deepEqual(Object.keys(at("all", 1, 0).bx).sort(), ["b", "l", "r"])
// inner / horizontal / vertical never touch the block edge.
assert.equal(at("inner", 2, 2).bx, null)
assert.deepEqual(Object.keys(at("inner", 0, 0).bx).sort(), ["b", "r"])
assert.deepEqual(Object.keys(at("horizontal", 1, 2).bx), ["b"])
assert.equal(at("horizontal", 2, 1).bx, null)
assert.deepEqual(Object.keys(at("vertical", 2, 1).bx), ["r"])
// outer: only the block's edge.
assert.equal(at("outer", 1, 1).bx, null)
assert.deepEqual(Object.keys(at("outer", 0, 2).bx).sort(), ["r", "t"])
assert.deepEqual(Object.keys(at("left", 1, 0).bx), ["l"])
assert.equal(at("left", 1, 1).bx, null)
assert.deepEqual(Object.keys(at("bottom", 2, 1).bx), ["b"])
// style + colour are stored per edge; legacy bd folds into bx and is dropped.
assert.deepEqual(at("top", 0, 1, { bd: "b" }, "thick", "#FF0000"), { bx: { b: { s: "thin" }, t: { s: "thick", c: "#ff0000" } }, bd: null })
assert.deepEqual(at("clear", 1, 1, { bx: { t: { s: "thin" } }, bd: "lr" }), { bx: null, bd: null })
assert.deepEqual(clearNeighbourEdge({ bx: { b: { s: "thin" }, r: { s: "thin" } } }, "b"), { bx: { r: { s: "thin" } }, bd: null })
assert.equal(clearNeighbourEdge({ bx: { r: { s: "thin" } } }, "b"), null)

// Legacy helpers keep working until the grid switches.
assert.equal(bordersFor("all", 0, 0, rect), "tblr")
assert.equal(borderShadows({ bd: "t" }).length, 1)

console.log("sheet-palette: ok")
