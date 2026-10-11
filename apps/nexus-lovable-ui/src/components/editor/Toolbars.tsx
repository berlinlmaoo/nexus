import { useEffect, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { BubbleMenu } from "@tiptap/react/menus";
import { useEditorState } from "@tiptap/react";
import {
  Bold, Code, Italic, Link2, ListChecks, MoreHorizontal, Strikethrough, Underline, Baseline, IndentIncrease, IndentDecrease,
  Slash, ChevronDown, Rows3, Columns3, Trash2, Heading2, List,
} from "lucide-react";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { BLOCK_COLORS } from "./block-actions";

function Btn({ on, active, label, children, onClick }: { on?: boolean; active?: boolean; label: string; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn("grid h-8 min-w-8 place-items-center rounded-md px-1.5 text-sm transition-colors hover:bg-muted", (active || on) && "bg-muted text-foreground")}
    >
      {children}
    </button>
  );
}

const CAP = (c: string) => c[0].toUpperCase() + c.slice(1);
/** Inline colours: CSS variables shared with the block colours (block-editor.css). */
export const TEXT_COLOR = (c: string) => `var(--nx-c-${c})`;
export const BG_COLOR = (c: string) => `var(--nx-bg-${c})`;

/** Floating toolbar on a text selection: marks, link, colour. */
export function SelectionToolbar({ editor }: { editor: Editor }) {
  const { t } = useLang();
  const [panel, setPanel] = useState<"none" | "link" | "color">("none");
  const [href, setHref] = useState("");
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      code: e.isActive("code"), link: e.isActive("link"), href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });
  useEffect(() => { if (panel === "link") setHref(st.href); }, [panel, st.href]);
  const applyLink = () => {
    const v = href.trim();
    if (!v) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: /^(https?:|mailto:|tel:|\/)/i.test(v) ? v : `https://${v}` }).run();
    setPanel("none");
  };
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="nxSelection"
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor: e, state, from, to }) => {
        if (!e.isEditable || from === to) return false;
        if (state.selection instanceof NodeSelection) return false;
        if (e.isActive("codeBlock")) return false;
        return true;
      }}
      className="nx-menu z-[110] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-pop"
    >
      {panel === "link" ? (
        <div className="flex items-center gap-1 p-0.5">
          <input autoFocus value={href} onChange={(e) => setHref(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } if (e.key === "Escape") setPanel("none"); }} placeholder={t("Paste or type a link…")} className="w-56 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary" />
          <button type="button" onClick={applyLink} className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">{st.href && !href.trim() ? t("Remove") : t("Apply")}</button>
        </div>
      ) : panel === "color" ? (
        <div className="w-60 p-1">
          <div className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">{t("Text color")}</div>
          <div className="grid grid-cols-10 gap-0.5">
            <button type="button" aria-label={t("Default")} onMouseDown={(e) => e.preventDefault()} onClick={() => { editor.chain().focus().unsetColor().run(); setPanel("none"); }} className="nx-swatch" data-swatch="default">A</button>
            {BLOCK_COLORS.map((c) => (
              <button key={c} type="button" aria-label={t(CAP(c))} title={t(CAP(c))} onMouseDown={(e) => e.preventDefault()} onClick={() => { editor.chain().focus().setColor(TEXT_COLOR(c)).run(); setPanel("none"); }} className="nx-swatch" data-swatch={c}>A</button>
            ))}
          </div>
          <div className="px-1 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">{t("Background color")}</div>
          <div className="grid grid-cols-10 gap-0.5">
            <button type="button" aria-label={t("Default")} onMouseDown={(e) => e.preventDefault()} onClick={() => { editor.chain().focus().unsetHighlight().run(); setPanel("none"); }} className="nx-swatch" data-swatch="default">A</button>
            {BLOCK_COLORS.map((c) => (
              <button key={c} type="button" aria-label={t("{color} background", { color: t(CAP(c)) })} onMouseDown={(e) => e.preventDefault()} onClick={() => { editor.chain().focus().setHighlight({ color: BG_COLOR(c) }).run(); setPanel("none"); }} className="nx-swatch" data-swatch={`${c}_bg`}>A</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          <Btn label={t("Bold")} active={st.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></Btn>
          <Btn label={t("Italic")} active={st.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></Btn>
          <Btn label={t("Underline")} active={st.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline className="h-4 w-4" /></Btn>
          <Btn label={t("Strikethrough")} active={st.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></Btn>
          <Btn label={t("Inline code")} active={st.code} onClick={() => editor.chain().focus().toggleCode().run()}><Code className="h-4 w-4" /></Btn>
          <span className="mx-0.5 h-5 w-px bg-border" />
          <Btn label={t("Link")} active={st.link} onClick={() => setPanel("link")}><Link2 className="h-4 w-4" /></Btn>
          <Btn label={t("Color")} onClick={() => setPanel("color")}><Baseline className="h-4 w-4" /><ChevronDown className="-ml-0.5 h-3 w-3 opacity-60" /></Btn>
        </div>
      )}
    </BubbleMenu>
  );
}

/** Row/column controls while the cursor is in a table. */
export function TableToolbar({ editor }: { editor: Editor }) {
  const { t } = useLang();
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="nxTable"
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor: e, from, to }) => e.isEditable && e.isActive("table") && from === to}
      className="nx-menu z-[105] flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-pop"
    >
      <Btn label={t("Add row below")} onClick={() => editor.chain().focus().addRowAfter().run()}><Rows3 className="h-4 w-4" /><span className="text-xs">+</span></Btn>
      <Btn label={t("Add column right")} onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns3 className="h-4 w-4" /><span className="text-xs">+</span></Btn>
      <Btn label={t("Delete row")} onClick={() => editor.chain().focus().deleteRow().run()}><Rows3 className="h-4 w-4" /><span className="text-xs">−</span></Btn>
      <Btn label={t("Delete column")} onClick={() => editor.chain().focus().deleteColumn().run()}><Columns3 className="h-4 w-4" /><span className="text-xs">−</span></Btn>
      <Btn label={t("Header row")} onClick={() => editor.chain().focus().toggleHeaderRow().run()}><span className="text-xs font-semibold">H</span></Btn>
      <span className="mx-0.5 h-5 w-px bg-border" />
      <Btn label={t("Delete table")} onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 className="h-4 w-4 text-destructive" /></Btn>
    </BubbleMenu>
  );
}

/**
 * Touch screens have no hover gutter: a toolbar above the keyboard while editing. "/" opens the block
 * menu, "⋯" the block menu of the current block (Turn into, Color, Move, Delete…).
 */
export function MobileToolbar({ editor, onBlockMenu }: { editor: Editor; onBlockMenu: (el: HTMLElement) => void }) {
  const { t } = useLang();
  const [bottom, setBottom] = useState(0);
  // The floating tab bar steps aside while the keyboard toolbar is up (block-editor.css).
  useEffect(() => {
    document.body.classList.add("nx-editing");
    return () => document.body.classList.remove("nx-editing");
  }, []);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setBottom(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ bold: e.isActive("bold"), italic: e.isActive("italic"), task: e.isActive("taskList"), bullet: e.isActive("bulletList"), h: e.isActive("heading"), inList: e.isActive("listItem") || e.isActive("taskItem") }),
  });
  const listType = editor.isActive("taskItem") ? "taskItem" : "listItem";
  return (
    <div className="nx-mobilebar fixed inset-x-0 z-[100] border-t border-border bg-popover/95 px-1 py-1 backdrop-blur" style={{ bottom }} onMouseDown={(e) => e.preventDefault()}>
      <div className="flex items-center gap-0.5 overflow-x-auto">
        <Btn label={t("Insert a block")} onClick={() => editor.chain().focus().insertContent("/").run()}><Slash className="h-4 w-4" /></Btn>
        <Btn label={t("Heading 2")} active={st.h} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></Btn>
        <Btn label={t("Bulleted list")} active={st.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
        <Btn label={t("To-do list")} active={st.task} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks className="h-4 w-4" /></Btn>
        <Btn label={t("Bold")} active={st.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></Btn>
        <Btn label={t("Italic")} active={st.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></Btn>
        {st.inList && <Btn label={t("Indent")} onClick={() => editor.chain().focus().sinkListItem(listType).run()}><IndentIncrease className="h-4 w-4" /></Btn>}
        {st.inList && <Btn label={t("Outdent")} onClick={() => editor.chain().focus().liftListItem(listType).run()}><IndentDecrease className="h-4 w-4" /></Btn>}
        <span className="flex-1" />
        <button type="button" aria-label={t("Block menu")} onClick={(e) => onBlockMenu(e.currentTarget)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted"><MoreHorizontal className="h-4 w-4" /></button>
        <button type="button" onClick={() => editor.commands.blur()} className="rounded-md px-2.5 py-1 text-sm font-medium text-primary">{t("Done")}</button>
      </div>
    </div>
  );
}
