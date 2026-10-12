import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { APP_SHORTCUTS, keyParts } from "@/lib/keyboard";
import { useLang } from "@/lib/lang";

/** Opens the app-wide shortcut list from anywhere (sidebar menu, search, a page's own button). */
export const OPEN_SHORTCUTS_EVENT = "nexus:open-shortcuts";
export function openShortcutsHelp() {
  window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
}

/**
 * Every keyboard shortcut of the web app on one sheet, like Notion's "?" (QA 13 Oct 2026, B37). Opened by
 * "?" (outside a text field) or ⌘/Ctrl+/ — the calendar and the spreadsheet keep their own, more detailed
 * lists on those keys while they have the keyboard.
 */
export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, lang } = useLang();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="z-[70] bg-scrim backdrop-blur-sm" />
        <DialogPrimitive.Content
          lang={lang}
          aria-describedby={undefined}
          data-shortcuts-help=""
          className="fixed left-1/2 top-1/2 z-[70] flex max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-pop outline-none"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <DialogTitle className="font-display text-base font-bold leading-normal tracking-normal">{t("Keyboard shortcuts")}</DialogTitle>
            <DialogPrimitive.Close aria-label={t("Close")} className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" /></DialogPrimitive.Close>
          </div>
          <div className="grid gap-x-8 gap-y-5 overflow-y-auto px-5 py-4 sm:grid-cols-2">
            {APP_SHORTCUTS.map((sec) => (
              <section key={sec.title} className="min-w-0">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t(sec.title)}
                  {sec.where && <span className="ml-1.5 font-medium normal-case tracking-normal">· {t(sec.where)}</span>}
                </h3>
                <dl className="mt-1.5 divide-y divide-border/60">
                  {sec.rows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <dt className="min-w-0 text-foreground">{t(row.label)}</dt>
                      <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                        {row.keys.map((combo, i) => (
                          <span key={combo} className="flex items-center gap-0.5">
                            {i > 0 && <span className="px-0.5 text-xs text-muted-foreground">/</span>}
                            {keyParts(combo).map((part, j) => (
                              <kbd key={j} className="min-w-[1.5rem] rounded-md border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-[11px] text-foreground">{t(part)}</kbd>
                            ))}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">{t("Shortcuts never fire while you type in a field; there the editor's own keys win.")}</p>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
