"use client"

import { useCallback, useRef } from "react"
import { BlockEditor, type Block, createBlock } from "@/components/editor"

interface DocEditorProps {
  content: any
  onChange: (content: any) => void
  editable?: boolean
}

function contentToBlocks(content: any): Block[] {
  // Already block format
  if (Array.isArray(content) && content.length > 0 && content[0]?.id && content[0]?.type) {
    return content
  }

  // Tiptap JSON format — convert to blocks
  if (content && typeof content === "object" && content.type === "doc" && Array.isArray(content.content)) {
    return tiptapToBlocks(content.content)
  }

  // Empty or unknown
  return [createBlock("text")]
}

function tiptapToBlocks(nodes: any[]): Block[] {
  if (!nodes || nodes.length === 0) return [createBlock("text")]
  const blocks: Block[] = []

  for (const node of nodes) {
    switch (node.type) {
      case "paragraph":
        blocks.push(createBlock("text", inlineContentToHtml(node.content)))
        break
      case "heading": {
        const level = node.attrs?.level || 1
        const type = level === 1 ? "heading1" : level === 2 ? "heading2" : "heading3"
        blocks.push(createBlock(type as any, inlineContentToHtml(node.content)))
        break
      }
      case "bulletList":
        if (node.content) {
          for (const item of node.content) {
            if (item.type === "listItem" && item.content) {
              for (const p of item.content) {
                blocks.push(createBlock("bulleted_list", inlineContentToHtml(p.content)))
              }
            }
          }
        }
        break
      case "orderedList":
        if (node.content) {
          for (const item of node.content) {
            if (item.type === "listItem" && item.content) {
              for (const p of item.content) {
                blocks.push(createBlock("numbered_list", inlineContentToHtml(p.content)))
              }
            }
          }
        }
        break
      case "blockquote":
        if (node.content) {
          for (const p of node.content) {
            blocks.push(createBlock("quote", inlineContentToHtml(p.content)))
          }
        }
        break
      case "codeBlock":
        blocks.push({
          ...createBlock("code", node.content?.[0]?.text || ""),
          properties: { language: node.attrs?.language || "plaintext" },
        })
        break
      case "horizontalRule":
        blocks.push(createBlock("divider"))
        break
      default:
        blocks.push(createBlock("text", inlineContentToHtml(node.content)))
    }
  }

  return blocks.length > 0 ? blocks : [createBlock("text")]
}

function inlineContentToHtml(content: any[] | undefined): string {
  if (!content) return ""
  return content
    .map((node) => {
      if (node.type === "text") {
        let text = node.text || ""
        // Escape HTML
        text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        if (node.marks) {
          for (const mark of node.marks) {
            switch (mark.type) {
              case "bold":
                text = `<strong>${text}</strong>`
                break
              case "italic":
                text = `<em>${text}</em>`
                break
              case "strike":
                text = `<s>${text}</s>`
                break
              case "code":
                text = `<code class="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[0.9em]">${text}</code>`
                break
              case "link":
                text = `<a href="${mark.attrs?.href || "#"}" class="text-muted-foreground underline">${text}</a>`
                break
            }
          }
        }
        return text
      }
      return ""
    })
    .join("")
}

export function DocEditor({ content, onChange, editable = true }: DocEditorProps) {
  const blocksRef = useRef<Block[]>(contentToBlocks(content))

  const handleChange = useCallback(
    (newBlocks: Block[]) => {
      blocksRef.current = newBlocks
      // Store as block array directly in the Json field
      onChange(newBlocks)
    },
    [onChange]
  )

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="px-4 py-3">
        <BlockEditor
          initialBlocks={blocksRef.current}
          onChange={handleChange}
          editable={editable}
          minHeight="400px"
        />
      </div>
    </div>
  )
}
