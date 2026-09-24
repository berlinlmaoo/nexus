// node src/lib/image-sniff.test.mjs
//
// Plain node, no test runner (same loader as permit-reason-guard.test.mjs). The byte strings are the
// real first bytes of each format (what an iPhone camera JPEG, a screenshot PNG, a GIF and a WEBP
// begin with), plus the look-alikes that must NOT pass.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))

async function load(file) {
  const tsPath = path.join(here, file)
  try {
    return await import(pathToFileURL(tsPath).href)
  } catch {
    const require = createRequire(import.meta.url)
    const ts = require("typescript")
    const src = await readFile(tsPath, "utf8")
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    return await import("data:text/javascript;base64," + Buffer.from(out).toString("base64"))
  }
}

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

const { sniffImageType, isGenericContentType, resolveImageUploadType, resolveUploadedImageType, IMAGE_SNIFF_BYTES } =
  await load("image-sniff.ts")

const bytes = (...xs) => new Uint8Array(xs)
const ascii = (s) => Array.from(Buffer.from(s, "latin1"))
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52)
const JPEG_EXIF = bytes(0xff, 0xd8, 0xff, 0xe1, 0x00, 0x18, 0x45, 0x78, 0x69, 0x66, 0, 0, 0, 0, 0, 0)
const JPEG_JFIF = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1)
const GIF89 = bytes(...ascii("GIF89a"), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0)
const GIF87 = bytes(...ascii("GIF87a"), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0)
const WEBP = bytes(...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBPVP8 "))
const WAV = bytes(...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WAVEfmt "))
const PDF = bytes(...ascii("%PDF-1.7\n%âãÏÓ\n"))
const SVG = bytes(...ascii('<svg xmlns="http'))
const HEIC = bytes(0, 0, 0, 0x18, ...ascii("ftypheic"), 0, 0, 0, 0)
const GIF_BAD = bytes(...ascii("GIF88a"), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)

test("sniff: the four formats", () => {
  assert.equal(sniffImageType(PNG), "image/png")
  assert.equal(sniffImageType(JPEG_EXIF), "image/jpeg")
  assert.equal(sniffImageType(JPEG_JFIF), "image/jpeg")
  assert.equal(sniffImageType(GIF89), "image/gif")
  assert.equal(sniffImageType(GIF87), "image/gif")
  assert.equal(sniffImageType(WEBP), "image/webp")
})

test("sniff: look-alikes and non-images are null", () => {
  for (const b of [WAV, PDF, SVG, HEIC, GIF_BAD, bytes(), bytes(0xff, 0xd8), bytes(0x89, 0x50, 0x4e, 0x47), bytes(...ascii("RIFF"))]) {
    assert.equal(sniffImageType(b), null)
  }
})

test("generic content types", () => {
  for (const t of ["", null, undefined, "application/octet-stream", "Application/Octet-Stream", "application/octet-stream; charset=binary", "binary/octet-stream"]) {
    assert.equal(isGenericContentType(t), true, String(t))
  }
  for (const t of ["image/jpeg", "application/pdf", "text/plain", "image/heic"]) assert.equal(isGenericContentType(t), false, t)
})

const FOLDER = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"]
const AVATAR = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
const CHAT = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]

test("declared allowed type: unchanged behaviour (taken as declared, bytes not consulted)", () => {
  assert.equal(resolveImageUploadType("image/jpeg", PDF, AVATAR), "image/jpeg")
  assert.equal(resolveImageUploadType("image/jpg", JPEG_EXIF, CHAT), "image/jpg")
  assert.equal(resolveImageUploadType("image/svg+xml", SVG, FOLDER), "image/svg+xml")
})

test("iOS folder icon: octet-stream + real bytes → the sniffed type", () => {
  assert.equal(resolveImageUploadType("application/octet-stream", JPEG_EXIF, FOLDER), "image/jpeg")
  assert.equal(resolveImageUploadType("application/octet-stream", PNG, FOLDER), "image/png")
  assert.equal(resolveImageUploadType("application/octet-stream", WEBP, FOLDER), "image/webp")
  assert.equal(resolveImageUploadType("", PNG, AVATAR), "image/png")
  assert.equal(resolveImageUploadType("application/octet-stream", GIF89, CHAT), "image/gif")
})

test("octet-stream: a format the route does not allow is still refused", () => {
  assert.equal(resolveImageUploadType("application/octet-stream", GIF89, FOLDER), null)
  assert.equal(resolveImageUploadType("application/octet-stream", GIF89, AVATAR), null)
  assert.equal(resolveImageUploadType("application/octet-stream", SVG, FOLDER), null) // SVG never sniffed
})

test("octet-stream: non-images refused", () => {
  for (const b of [PDF, WAV, HEIC, bytes()]) {
    assert.equal(resolveImageUploadType("application/octet-stream", b, CHAT), null)
  }
})

test("a declared non-image, non-generic type is refused even with image bytes", () => {
  assert.equal(resolveImageUploadType("application/pdf", PNG, CHAT), null)
  assert.equal(resolveImageUploadType("image/heic", JPEG_EXIF, CHAT), null)
  assert.equal(resolveImageUploadType("text/plain", PNG, AVATAR), null)
})

// The File path the routes use: only the first IMAGE_SNIFF_BYTES are read.
const fileCases = [
  [new File([JPEG_EXIF, new Uint8Array(4096)], "photo.jpg", { type: "application/octet-stream" }), FOLDER, "image/jpeg"],
  [new File([PNG], "x.png", { type: "" }), AVATAR, "image/png"],
  [new File([PDF], "x.pdf", { type: "application/octet-stream" }), CHAT, null],
  [new File([PDF], "x.jpg", { type: "image/jpeg" }), CHAT, "image/jpeg"],
]
for (const [file, allowed, want] of fileCases) {
  assert.equal(await resolveUploadedImageType(file, allowed), want, file.name)
  passed++
}
assert.equal(IMAGE_SNIFF_BYTES >= 12, true)

console.log(`image-sniff: ${passed} passed`)
