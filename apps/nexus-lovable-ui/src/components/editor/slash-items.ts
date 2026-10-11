import type { Editor, Range } from "@tiptap/core";
import {
  AtSign, Bell, Bookmark, CalendarDays, ChevronRight, Code2, FileText, FolderKanban, Heading1, Heading2, Heading3,
  Image as ImageIcon, List, ListChecks, ListOrdered, Minus, Paperclip, Quote, SquareCheckBig, Table2, Type, Lightbulb, MonitorPlay,
  type LucideIcon,
} from "lucide-react";
import { ctxOf, jakartaDate } from "./editor-context";

export type SlashGroup = "Basic blocks" | "Media" | "NEXUS" | "Inline";

export type SlashItem = {
  id: string;
  group: SlashGroup;
  /** English source text (translated with t()). */
  label: string;
  hint?: string;
  icon: LucideIcon;
  /** Extra words that find it (English and Indonesian). */
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
};

/** Which list the "@" menu should open on, when it was opened from the "/" menu ("Mention a task"…). */
export const pendingMention: { kind: "user" | "task" | "doc" | "project" | null } = { kind: null };

function openMention(editor: Editor, range: Range, kind: "user" | "task" | "doc" | "project") {
  pendingMention.kind = kind;
  editor.chain().focus().deleteRange(range).insertContent("@").run();
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: "text", group: "Basic blocks", label: "Text", icon: Type, keywords: ["paragraph", "plain", "teks", "paragraf"], run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { id: "h1", group: "Basic blocks", label: "Heading 1", hint: "#", icon: Heading1, keywords: ["title", "h1", "judul"], run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 1 }).run() },
  { id: "h2", group: "Basic blocks", label: "Heading 2", hint: "##", icon: Heading2, keywords: ["subtitle", "h2", "subjudul"], run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run() },
  { id: "h3", group: "Basic blocks", label: "Heading 3", hint: "###", icon: Heading3, keywords: ["h3"], run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run() },
  { id: "bullet", group: "Basic blocks", label: "Bulleted list", hint: "-", icon: List, keywords: ["bullet", "unordered", "ul", "poin", "daftar"], run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { id: "numbered", group: "Basic blocks", label: "Numbered list", hint: "1.", icon: ListOrdered, keywords: ["ordered", "ol", "nomor", "urut"], run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { id: "todo", group: "Basic blocks", label: "To-do list", hint: "[]", icon: SquareCheckBig, keywords: ["todo", "task", "checkbox", "check", "centang", "tugas"], run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { id: "toggle", group: "Basic blocks", label: "Toggle list", hint: ">", icon: ChevronRight, keywords: ["toggle", "collapse", "details", "lipat", "buka tutup"], run: (e, r) => e.chain().focus().deleteRange(r).setDetails().run() },
  { id: "quote", group: "Basic blocks", label: "Quote", hint: "\"", icon: Quote, keywords: ["blockquote", "kutipan"], run: (e, r) => e.chain().focus().deleteRange(r).setBlockquote().run() },
  { id: "callout", group: "Basic blocks", label: "Callout", icon: Lightbulb, keywords: ["note", "info", "warning", "catatan", "sorotan"], run: (e, r) => e.chain().focus().deleteRange(r).wrapIn("callout").run() },
  { id: "divider", group: "Basic blocks", label: "Divider", hint: "---", icon: Minus, keywords: ["hr", "line", "separator", "garis", "pemisah"], run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { id: "code", group: "Basic blocks", label: "Code", hint: "```", icon: Code2, keywords: ["code block", "snippet", "kode"], run: (e, r) => e.chain().focus().deleteRange(r).setCodeBlock().run() },
  { id: "table", group: "Basic blocks", label: "Table", icon: Table2, keywords: ["grid", "tabel"], run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },

  { id: "image", group: "Media", label: "Image", icon: ImageIcon, keywords: ["photo", "picture", "upload", "gambar", "foto"], run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: "image", attrs: { src: null } }).run() },
  { id: "file", group: "Media", label: "File", icon: Paperclip, keywords: ["attachment", "upload", "pdf", "berkas", "lampiran"], run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: "fileBlock" }).run() },
  { id: "bookmark", group: "Media", label: "Bookmark", icon: Bookmark, keywords: ["link", "url", "web", "tautan"], run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: "bookmark", attrs: { embed: false } }).run() },
  { id: "embed", group: "Media", label: "Embed", icon: MonitorPlay, keywords: ["youtube", "video", "figma", "maps", "loom", "drive", "sematkan"], run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: "bookmark", attrs: { embed: true } }).run() },

  { id: "mention-user", group: "NEXUS", label: "Mention a person", hint: "@", icon: AtSign, keywords: ["person", "people", "user", "orang", "sebut"], run: (e, r) => openMention(e, r, "user") },
  { id: "mention-task", group: "NEXUS", label: "Mention a task", icon: ListChecks, keywords: ["task", "todo", "tugas"], run: (e, r) => openMention(e, r, "task") },
  { id: "mention-doc", group: "NEXUS", label: "Link to doc", icon: FileText, keywords: ["page", "doc", "wiki", "halaman", "dokumen"], run: (e, r) => openMention(e, r, "doc") },
  { id: "mention-project", group: "NEXUS", label: "Mention a project", icon: FolderKanban, keywords: ["project", "proyek"], run: (e, r) => openMention(e, r, "project") },

  { id: "date", group: "Inline", label: "Date", icon: CalendarDays, keywords: ["today", "date", "tanggal", "hari ini"], run: (e, r) => e.chain().focus().deleteRange(r).insertContent([{ type: "dateChip", attrs: { date: jakartaDate() } }, { type: "text", text: " " }]).run() },
  {
    id: "remind", group: "Inline", label: "Reminder", icon: Bell, keywords: ["remind", "reminder", "alarm", "ingatkan", "pengingat"],
    run: (e, r) => e.chain().focus().deleteRange(r).insertContent([{ type: "dateChip", attrs: { date: jakartaDate(1), time: "09:00", remind: true, remindUserId: ctxOf(e)?.me?.id ?? null } }, { type: "text", text: " " }]).run(),
  },
];

export const SLASH_GROUPS: SlashGroup[] = ["Basic blocks", "Media", "NEXUS", "Inline"];

/** Items matching what was typed after "/", best first. Matches the translated and the English names. */
export function filterSlash(query: string, translate: (s: string) => string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  const scored: Array<{ item: SlashItem; score: number }> = [];
  for (const item of SLASH_ITEMS) {
    const names = [translate(item.label).toLowerCase(), item.label.toLowerCase()];
    let score = -1;
    if (names.some((n) => n.startsWith(q))) score = 3;
    else if (names.some((n) => n.split(/\s+/).some((w) => w.startsWith(q)))) score = 2;
    else if (item.keywords.some((k) => k.startsWith(q)) || names.some((n) => n.includes(q))) score = 1;
    else if (item.keywords.some((k) => k.includes(q))) score = 0;
    if (score >= 0) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.item);
}
