/**
 * Recursively extract plain text from TipTap JSON content.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractTextFromTipTap(node: any): string {
  if (!node) return ""
  if (typeof node === "string") return node

  const parts: string[] = []

  if (node.text) {
    parts.push(node.text)
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      parts.push(extractTextFromTipTap(child))
    }
  }

  // Handle arrays (e.g. when content is an array at top level)
  if (Array.isArray(node)) {
    for (const item of node) {
      parts.push(extractTextFromTipTap(item))
    }
  }

  return parts.filter(Boolean).join(" ")
}
