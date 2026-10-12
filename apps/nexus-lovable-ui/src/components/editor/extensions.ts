import { Extension, InputRule, Node, mergeAttributes, wrappingInputRule, type AnyExtension, type Editor, type Range } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Blockquote from "@tiptap/extension-blockquote";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { Details, DetailsSummary, DetailsContent } from "@tiptap/extension-details";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { Placeholder } from "@tiptap/extensions";
import FileHandler from "@tiptap/extension-file-handler";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Suggestion from "@tiptap/suggestion";
import type * as Y from "yjs";
import { t } from "@/lib/lang";
import type { SocketYProvider, CollabUser } from "@/lib/collab-provider";
import type { EditorCtx } from "./editor-context";
import { openAskAi } from "./AskAI";
import { ctxOf } from "./editor-context";
import type { MenuStore } from "./menu-store";
import { filterSlash, pendingMention, type SlashItem } from "./slash-items";
import { BookmarkView, CalloutView, DateChipView, FileBlockView, ImageView, MentionView } from "./node-views";
import { currentBlockPos, duplicateBlock, moveBlock } from "./block-actions";
import { looksLikeMarkdown, markdownToHtml } from "./markdown-paste";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * The block editor's schema and behaviour. The JSON these produce is the stored format, described in
 * src/lib/blockdoc.ts on the server (and what iOS/Android will render). Changing a node's name or an
 * attribute's meaning is a format change: keep old names readable.
 */

/** Block types that can carry an anchor id and a colour (the block menu's "Copy link" and "Color"). */
const BLOCK_TYPES = ["paragraph", "heading", "blockquote", "callout", "details", "bulletList", "orderedList", "taskList", "codeBlock", "table", "image", "fileBlock", "bookmark", "horizontalRule"];

export const BlockAttrs = Extension.create({
  name: "blockAttrs",
  addGlobalAttributes() {
    return [{
      types: BLOCK_TYPES,
      attributes: {
        blockId: {
          default: null,
          keepOnSplit: false,
          parseHTML: (el) => el.getAttribute("data-block-id"),
          renderHTML: (attrs) => (attrs.blockId ? { "data-block-id": attrs.blockId, id: `block-${attrs.blockId}` } : {}),
        },
        blockColor: {
          default: null,
          parseHTML: (el) => el.getAttribute("data-color"),
          renderHTML: (attrs) => (attrs.blockColor ? { "data-color": attrs.blockColor } : {}),
        },
      },
    }];
  },
});

/** Notion's quote shortcut is `"` + space (">" + space makes a toggle). */
const NotionBlockquote = Blockquote.extend({
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*["“”]\s$/, type: this.type })];
  },
});

/** Notion's block shortcuts: duplicate, move up/down. */
const BlockShortcuts = Extension.create({
  name: "blockShortcuts",
  addKeyboardShortcuts() {
    const at = () => currentBlockPos(this.editor);
    return {
      "Mod-d": () => { const p = at(); if (p === null) return false; duplicateBlock(this.editor, p); return true; },
      "Mod-Shift-ArrowUp": () => { const p = at(); return p === null ? false : moveBlock(this.editor, p, -1); },
      "Mod-Shift-ArrowDown": () => { const p = at(); return p === null ? false : moveBlock(this.editor, p, 1); },
    };
  },
});

/**
 * Ask AI (Notion AI parity, 12 Oct 2026): Space on an empty top-level line, or ⌘/Ctrl+J anywhere, opens
 * GIDEON's writing menu (AskAI.tsx). Space only on a truly empty paragraph that is not inside a list, a
 * table or a toggle, so typing a space anywhere else still types a space.
 */
const AskAiShortcut = Extension.create({
  name: "askAiShortcut",
  addStorage() {
    return { open: null as ((mode: "selection" | "cursor") => void) | null };
  },
  addKeyboardShortcuts() {
    return {
      Space: () => {
        const { state } = this.editor;
        const { selection } = state;
        if (!this.editor.isEditable || !selection.empty) return false;
        const $from = selection.$from;
        if ($from.depth !== 1 || $from.parent.type.name !== "paragraph" || $from.parent.content.size !== 0) return false;
        openAskAi(this.editor, "cursor");
        return true;
      },
      "Mod-j": () => {
        if (!this.editor.isEditable) return false;
        openAskAi(this.editor, this.editor.state.selection.empty ? "cursor" : "selection");
        return true;
      },
    };
  },
});

/**
 * ⌘/Ctrl+K adds a link to the selection (Notion, Google Docs; QA 13 Oct 2026 S-07: it opened the app's
 * search over the editor). With no selection it takes the link the caret is in, else the word under it.
 * The selection toolbar (Toolbars.tsx) registers `open`, which shows its link field.
 */
const LinkShortcut = Extension.create({
  name: "linkShortcut",
  addStorage() {
    return { open: null as (() => void) | null };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        const ed = this.editor;
        if (!ed.isEditable) return false;
        if (ed.isActive("codeBlock")) return true;
        if (ed.state.selection.empty) {
          if (ed.isActive("link")) ed.chain().extendMarkRange("link").run();
          else {
            const { $from } = ed.state.selection;
            const text = $from.parent.textBetween(0, $from.parent.content.size, undefined, "\ufffc");
            let a = $from.parentOffset;
            let b = a;
            while (a > 0 && /\S/.test(text[a - 1]) && text[a - 1] !== "\ufffc") a--;
            while (b < text.length && /\S/.test(text[b]) && text[b] !== "\ufffc") b++;
            if (b > a) ed.commands.setTextSelection({ from: $from.start() + a, to: $from.start() + b });
          }
        }
        // Nothing to link (an empty line): the key is still the editor's, never the app's search.
        if (ed.state.selection.empty) return true;
        const open = (this.storage as { open: (() => void) | null }).open;
        // The toolbar shows once the new selection is drawn.
        if (open) window.setTimeout(open, 0);
        return true;
      },
    };
  },
});

/** "> " + space → toggle list (Notion). */
const ToggleShortcut = Extension.create({
  name: "toggleShortcut",
  addInputRules() {
    return [new InputRule({
      find: /^>\s$/,
      handler: ({ range, chain }) => {
        chain().deleteRange(range).setDetails().run();
      },
    })];
  },
});

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { emoji: { default: "💡", parseHTML: (el) => el.getAttribute("data-emoji") || "💡", renderHTML: (a) => ({ "data-emoji": a.emoji }) } };
  },
  parseHTML: () => [{ tag: "div[data-type=\"callout\"]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout", class: "nx-callout" }), 0],
  addNodeView: () => ReactNodeViewRenderer(CalloutView),
});

export const FileBlock = Node.create({
  name: "fileBlock",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: null }, name: { default: null }, size: { default: null }, mime: { default: null } };
  },
  parseHTML: () => [{ tag: "div[data-type=\"file\"]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "file" })],
  addNodeView: () => ReactNodeViewRenderer(FileBlockView),
});

export const BookmarkNode = Node.create({
  name: "bookmark",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: null }, title: { default: null }, embed: { default: false } };
  },
  parseHTML: () => [{ tag: "div[data-type=\"bookmark\"]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "bookmark" })],
  addNodeView: () => ReactNodeViewRenderer(BookmarkView),
});

export const DateChip = Node.create({
  name: "dateChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { date: { default: null }, time: { default: null }, remind: { default: false }, remindUserId: { default: null } };
  },
  parseHTML: () => [{ tag: "span[data-type=\"date\"]" }],
  renderHTML: ({ HTMLAttributes, node }) => ["span", mergeAttributes(HTMLAttributes, { "data-type": "date" }), String(node.attrs.date ?? "")],
  renderText: ({ node }) => [node.attrs.date, node.attrs.time].filter(Boolean).join(" "),
  addNodeView: () => ReactNodeViewRenderer(DateChipView, { as: "span" }),
});

const ImageBlock = Image.extend({
  draggable: true,
  addNodeView: () => ReactNodeViewRenderer(ImageView),
});

export type MentionKind = "user" | "task" | "doc" | "project";
export type MentionItem = { id: string; label: string; kind: MentionKind; sub?: string | null; avatar?: string | null; color?: string | null } | { id: string; kind: "date"; label: string; date: string; remind?: boolean };

const NexusMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: { default: "user", parseHTML: (el) => el.getAttribute("data-kind") || "user", renderHTML: (a) => ({ "data-kind": a.kind }) },
    };
  },
  addNodeView: () => ReactNodeViewRenderer(MentionView, { as: "span" }),
});

/** Keeps the page's context (uploads, me, links) where node views can read it (ctxOf). */
const NexusContext = Extension.create<{ ctx: EditorCtx | null }, { ctx: EditorCtx | null }>({
  name: "nexus",
  addOptions: () => ({ ctx: null }),
  addStorage() {
    return { ctx: this.options.ctx };
  },
});

function menuRender<I>(store: MenuStore<I>) {
  return () => ({
    onStart: (p: { items: I[]; query: string; clientRect?: (() => DOMRect | null) | null; command: (item: I) => void }) =>
      store.set({ open: true, items: p.items, query: p.query, index: 0, rect: p.clientRect?.() ?? null, pick: p.command }),
    onUpdate: (p: { items: I[]; query: string; clientRect?: (() => DOMRect | null) | null; command: (item: I) => void }) =>
      store.set({ open: true, items: p.items, query: p.query, rect: p.clientRect?.() ?? null, pick: p.command, ...(p.query !== store.get().query ? { index: 0 } : {}) }),
    onKeyDown: (p: { event: KeyboardEvent }) => store.key(p.event),
    onExit: () => store.set({ open: false, items: [], pick: null }),
  });
}

/** Plain-text Markdown paste → blocks (Notion). HTML on the clipboard, files and code blocks keep the default. */
const MarkdownPaste = Extension.create({
  name: "markdownPaste",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key: new PluginKey("markdownPaste"),
      props: {
        handlePaste: (view, event) => {
          const cd = event.clipboardData;
          if (!cd || !editor.isEditable) return false;
          if (cd.types.includes("text/html") || cd.files.length > 0) return false;
          const text = cd.getData("text/plain");
          if (!looksLikeMarkdown(text)) return false;
          const { $from } = view.state.selection;
          if ($from.parent.type.spec.code) return false;
          const html = markdownToHtml(text);
          if (!html) return false;
          event.preventDefault();
          return editor.chain().focus().insertContent(html).run();
        },
      },
    })];
  },
});

function SlashCommand(store: MenuStore<SlashItem>) {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          char: "/",
          // Notion keeps the menu open through spaces ("/heading 1", "/to-do list") and closes it once
          // nothing matches any more (bughunt E-BUG-3).
          allowSpaces: true,
          allow: ({ state, range }) => {
            const $from = state.doc.resolve(range.from);
            if ($from.parent.type.name === "codeBlock") return false;
            const query = state.doc.textBetween(range.from, range.to, "\n").slice(1);
            if (!/\s/.test(query)) return true;
            if (/^\s/.test(query) || /\s\s/.test(query)) return false;
            return filterSlash(query, (s) => t(s)).length > 0;
          },
          items: ({ query }) => filterSlash(query, (s) => t(s)).slice(0, 30),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: menuRender(store),
        }),
      ];
    },
  });
}

export type MentionSource = (query: string, kind: MentionKind | null) => Promise<MentionItem[]>;

function insertMention(editor: Editor, range: Range, item: MentionItem) {
  if (item.kind === "date") {
    editor.chain().focus().deleteRange(range).insertContent([
      { type: "dateChip", attrs: { date: item.date, time: item.remind ? "09:00" : null, remind: !!item.remind, remindUserId: item.remind ? ctxOf(editor)?.me?.id ?? null : null } },
      { type: "text", text: " " },
    ]).run();
    return;
  }
  editor.chain().focus().deleteRange(range).insertContent([
    { type: "mention", attrs: { id: item.id, label: item.label, kind: item.kind } },
    { type: "text", text: " " },
  ]).run();
}

export type BuildOptions = {
  ctx: EditorCtx;
  placeholder: string;
  slashStore: MenuStore<SlashItem>;
  mentionStore: MenuStore<MentionItem>;
  mentionSource: MentionSource;
  onFiles: (editor: Editor, files: File[], pos?: number) => void;
  /** The editor always edits a Y.Doc; `provider` (live room) is null when offline (REST saves). */
  collab: { doc: Y.Doc; provider: SocketYProvider | null; user: CollabUser };
};

export function buildExtensions(o: BuildOptions): AnyExtension[] {
  const exts: AnyExtension[] = [
    StarterKit.configure({
      blockquote: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      // History comes from Yjs (Collaboration) — the editor always runs on a Y.Doc.
      undoRedo: false,
      // An opened page must not change just by being opened (the trailing paragraph would be a save).
      trailingNode: false,
      dropcursor: { color: "var(--nx-drop)", width: 3 },
    }),
    NotionBlockquote,
    ToggleShortcut,
    BlockShortcuts,
    AskAiShortcut,
    LinkShortcut,
    BlockAttrs,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false, HTMLAttributes: { class: "nx-table" } } }),
    ImageBlock.configure({ inline: false, allowBase64: false }),
    Details.configure({ persist: false, HTMLAttributes: { class: "nx-details" } }),
    DetailsSummary,
    DetailsContent,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Callout,
    FileBlock,
    BookmarkNode,
    DateChip,
    NexusContext.configure({ ctx: o.ctx }),
    Placeholder.configure({
      includeChildren: false,
      placeholder: ({ node, editor }) => {
        if (node.type.name === "heading") return t("Heading {n}", { n: node.attrs.level });
        if (node.type.name === "detailsSummary") return t("Toggle");
        return editor.isEmpty ? o.placeholder : t("Type '/' for commands");
      },
    }),
    FileHandler.configure({
      onPaste: (editor, files) => o.onFiles(editor, files),
      onDrop: (editor, files, pos) => o.onFiles(editor, files, pos),
    }),
    SlashCommand(o.slashStore),
    MarkdownPaste,
    NexusMention.configure({
      HTMLAttributes: { class: "nx-mention" },
      renderText: ({ node }) => ((node.attrs.kind ?? "user") === "user" ? `@${node.attrs.label ?? ""}` : String(node.attrs.label ?? "")),
      suggestions: [{
        char: "@",
        allowSpaces: true,
        items: async ({ query }) => {
          const kind = pendingMention.kind;
          return o.mentionSource(query, kind);
        },
        command: ({ editor, range, props }) => {
          pendingMention.kind = null;
          insertMention(editor, range, props as unknown as MentionItem);
        },
        render: menuRender(o.mentionStore) as never,
      }],
    }),
  ];
  exts.push(Collaboration.configure({ document: o.collab.doc }));
  if (o.collab.provider) exts.push(CollaborationCaret.configure({ provider: o.collab.provider, user: o.collab.user }));
  return exts;
}
