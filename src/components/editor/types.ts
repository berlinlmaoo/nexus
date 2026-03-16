export type BlockType =
  | "text"
  | "heading1"
  | "heading2"
  | "heading3"
  | "todo"
  | "bulleted_list"
  | "numbered_list"
  | "quote"
  | "callout"
  | "code"
  | "divider"
  | "image"
  | "toggle"
  | "table"
  | "embed"

export interface Block {
  id: string
  type: BlockType
  content: string
  children: Block[]
  properties: BlockProperties
}

export interface BlockProperties {
  checked?: boolean
  language?: string
  collapsed?: boolean
  url?: string
  alt?: string
  width?: number
  icon?: string
  color?: string
  rows?: string[][]
}

export interface SlashCommandItem {
  label: string
  type: BlockType
  icon: string
  description: string
  category: "Basic" | "Media" | "Advanced"
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
  { label: "Text", type: "text", icon: "type", description: "Plain text block", category: "Basic" },
  { label: "Heading 1", type: "heading1", icon: "heading1", description: "Large heading", category: "Basic" },
  { label: "Heading 2", type: "heading2", icon: "heading2", description: "Medium heading", category: "Basic" },
  { label: "Heading 3", type: "heading3", icon: "heading3", description: "Small heading", category: "Basic" },
  { label: "To-do", type: "todo", icon: "todo", description: "Checkbox item", category: "Basic" },
  { label: "Bullet List", type: "bulleted_list", icon: "bullet", description: "Bulleted list item", category: "Basic" },
  { label: "Numbered List", type: "numbered_list", icon: "numbered", description: "Numbered list item", category: "Basic" },
  { label: "Image", type: "image", icon: "image", description: "Upload or embed image", category: "Media" },
  { label: "Embed", type: "embed", icon: "embed", description: "Embed a URL", category: "Media" },
  { label: "Divider", type: "divider", icon: "divider", description: "Horizontal divider", category: "Media" },
  { label: "Code", type: "code", icon: "code", description: "Code block with syntax highlighting", category: "Advanced" },
  { label: "Quote", type: "quote", icon: "quote", description: "Block quote", category: "Advanced" },
  { label: "Callout", type: "callout", icon: "callout", description: "Callout with icon", category: "Advanced" },
  { label: "Toggle", type: "toggle", icon: "toggle", description: "Collapsible content", category: "Advanced" },
  { label: "Table", type: "table", icon: "table", description: "Simple table", category: "Advanced" },
  { label: "NAS File", type: "embed", icon: "nas", description: "Insert file from Synology NAS", category: "Media" },
]

let counter = 0
export function createBlockId(): string {
  counter++
  return `blk_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export function createBlock(type: BlockType = "text", content = ""): Block {
  const properties: BlockProperties = {}
  if (type === "todo") properties.checked = false
  if (type === "code") properties.language = "plaintext"
  if (type === "callout") {
    properties.icon = "💡"
    properties.color = "zinc"
  }
  if (type === "toggle") properties.collapsed = false
  if (type === "table") {
    properties.rows = [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
    ]
  }
  return { id: createBlockId(), type, content, children: [], properties }
}

export function blocksToPlainText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      const text = b.content.replace(/<[^>]*>/g, "")
      if (b.children.length > 0) {
        return text + "\n" + blocksToPlainText(b.children)
      }
      return text
    })
    .join("\n")
}

export function parseDescriptionToBlocks(description: string | null): Block[] {
  if (!description) return [createBlock("text")]
  try {
    const parsed = JSON.parse(description)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id && parsed[0].type) {
      return parsed
    }
  } catch {
    // Not JSON, treat as plain text
  }
  if (!description.trim()) return [createBlock("text")]
  return description.split("\n").map((line) => createBlock("text", line))
}

export function serializeBlocksForTask(blocks: Block[]): string {
  return JSON.stringify(blocks)
}
