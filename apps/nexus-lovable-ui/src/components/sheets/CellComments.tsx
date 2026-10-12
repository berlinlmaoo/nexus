import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, History, Loader2, MessageSquare, RotateCcw, Send, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { isFormulaCell, toDisplay, type SheetShape } from "@/lib/sheet-formula";
import { formatCell } from "./sheet-types";
import { useLang } from "@/lib/lang";
import { Floating } from "./sheet-float";
import type {
  NexusSheetCellValue, NexusSheetColumnType, NexusSheetComment, NexusSheetRevision,
} from "@/lib/nexus-api";

/**
 * The popover for ONE cell: its comment thread and its edit history.
 *
 * Both are anchored by (rowId, columnId), never by "C5" — so sorting, filtering, inserting rows or
 * moving columns can't detach either from the number it's about. That falls straight out of the
 * cells-keyed-by-column-id model; nothing here has to compensate for it.
 *
 * Portaled with fixed positioning for the same reason as the function autocomplete: the grid scroll
 * container is `overflow:auto` and would clip a popover anchored inside a <td>.
 */
export function CellCommentThread({
  anchor, comments, meId, canEdit, busy, columnType, shape,
  revisions, revisionsLoading,
  onAdd, onResolve, onDelete, onRestore, onClose,
}: {
  anchor: { left: number; top: number };
  comments: NexusSheetComment[];
  meId: string | null;
  canEdit: boolean;
  busy: boolean;
  columnType: NexusSheetColumnType;
  shape: SheetShape;
  revisions: NexusSheetRevision[];
  revisionsLoading: boolean;
  onAdd: (body: string) => void;
  onResolve: (commentId: string, resolved: boolean) => void;
  onDelete: (commentId: string) => void;
  onRestore: (value: unknown) => void;
  onClose: () => void;
}) {
  const { t, locale } = useLang();
  const [tab, setTab] = useState<"comments" | "history">("comments");
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (tab === "comments") inputRef.current?.focus(); }, [tab]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  };

  /** A stored value as a person reads it: formulas as their A1 form, empty as an explicit label. */
  const show = (v: unknown) => {
    if (v === null || v === undefined || v === "") return t("(empty)");
    if (isFormulaCell(v)) { const f = toDisplay(v.f, shape); return f.startsWith("=") ? f : `=${f}`; }
    return formatCell(columnType, v) || (typeof v === "object" ? "" : String(v));
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <Floating
        anchor={{ rect: { left: anchor.left, right: anchor.left + 320, top: anchor.top - 30, bottom: anchor.top - 4 } }}
        className="w-80 rounded-2xl border border-border bg-card shadow-pop"
      >
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          {([
            { id: "comments", label: t("Comments"), icon: MessageSquare, badge: comments.filter((c) => !c.resolvedAt).length },
            { id: "history", label: t("History"), icon: History, badge: 0 },
          ] as const).map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition",
                tab === tb.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <tb.icon className="h-3.5 w-3.5" />
              {tb.label}
              {tb.badge > 0 && (
                <span className="rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">{tb.badge}</span>
              )}
            </button>
          ))}
          {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <button onClick={onClose} aria-label={t("Close")} className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {tab === "comments" ? (
          <>
            <div className="max-h-64 space-y-2 overflow-y-auto p-3">
              {comments.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">{t("No comments on this cell yet.")}</p>
              )}
              {comments.map((c) => (
                <div key={c.id} className={cn("group flex gap-2", c.resolvedAt && "opacity-50")}>
                  <Avatar userId={c.author.id} name={c.author.name ?? undefined} avatar={c.author.avatar} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11px] font-bold">{c.author.name ?? "—"}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{when(c.createdAt)}</span>
                      {c.resolvedAt && <span className="rounded-full bg-emerald-100 px-1.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{t("resolved")}</span>}
                    </div>
                    <p className="whitespace-pre-wrap break-words text-xs">{c.body}</p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={() => onResolve(c.id, !c.resolvedAt)}
                        aria-label={c.resolvedAt ? t("Reopen") : t("Mark resolved")} title={c.resolvedAt ? t("Reopen") : t("Mark resolved")}
                        className="rounded p-0.5 text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400"
                      ><Check className="h-3 w-3" /></button>
                      {/* Delete is the author's (the server also lets a lead clean up). */}
                      {c.authorId === meId && (
                        <button onClick={() => onDelete(c.id)} aria-label={t("Delete")} title={t("Delete")}
                          className="rounded p-0.5 text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"><Trash2 className="h-3 w-3" /></button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {canEdit && (
              <div className="flex items-end gap-1.5 border-t border-border p-2">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                    if (e.key === "Escape") onClose();
                  }}
                  rows={1}
                  placeholder={t("Write a comment… (@name to tag)")}
                  className="max-h-24 min-h-[2rem] flex-1 resize-none rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                />
                <button aria-label={t("Send comment")}
                  onClick={send}
                  disabled={!draft.trim() || busy}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
                ><Send className="h-3.5 w-3.5" /></button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="max-h-64 space-y-2 overflow-y-auto p-3">
              {revisionsLoading && (
                <p className="py-4 text-center text-xs text-muted-foreground">{t("Loading history…")}</p>
              )}
              {!revisionsLoading && revisions.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {t("No changes recorded on this cell yet.")}
                </p>
              )}
              {revisions.map((r) => (
                <div key={r.id} className="group flex gap-2">
                  <Avatar userId={r.author?.id ?? ""} name={r.author?.name ?? undefined} avatar={r.author?.avatar ?? null} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {/* The author FK is SET NULL, so a departed employee leaves the change intact
                          but nameless — say that plainly instead of rendering a blank. */}
                      <span className="truncate text-[11px] font-bold">{r.author?.name ?? t("deleted account")}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{when(r.createdAt)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 text-xs">
                      <span className="text-muted-foreground line-through">{show(r.oldValue)}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-semibold">{show(r.newValue)}</span>
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => onRestore(r.oldValue)}
                      title={t("Restore to {value}", { value: show(r.oldValue) })}
                      aria-label={t("Restore to {value}", { value: show(r.oldValue) })}
                      className="shrink-0 self-start rounded p-0.5 text-muted-foreground opacity-0 transition hover:text-primary group-hover:opacity-100"
                    ><RotateCcw className="h-3 w-3" /></button>
                  )}
                </div>
              ))}
            </div>
            <p className="border-t border-border px-3 py-1.5 text-[10px] leading-snug text-muted-foreground">
              {t("History is kept for 90 days. The latest change of every cell is kept forever, so \"who put this number here\" is never lost.")}
            </p>
          </>
        )}
      </Floating>
    </>,
    document.body,
  );
}
