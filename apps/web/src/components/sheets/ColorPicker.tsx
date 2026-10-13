import { useState, type ReactNode } from "react";
import { Check, CirclePlus, DropletOff, Pencil, Pipette } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import {
  PALETTE_ROWS, STANDARD_THEME, addCustomColor, loadCustomColors, readableText, swatchOf, toHex,
} from "@/lib/sheet-palette";
import { Menu } from "./sheet-menu-ui";

/**
 * The Sheets colour picker, as panel content (callers put it in a Menu or a Floating):
 * Reset · the 10×8 swatch grid · STANDARD theme colours (✎ edits the theme) · CUSTOM (⊕ picker,
 * eyedropper where the browser has one, recent custom colours) · optional footer links.
 * Everything it hands back is "#rrggbb" (or null for Reset).
 */
export function ColorPicker({ value, onPick, resetLabel, theme = STANDARD_THEME, onEditTheme, footer }: {
  value?: string | null;
  onPick: (hex: string | null) => void;
  resetLabel?: string;
  /** The 8 STANDARD colours (the sheet theme); defaults to Sheets' standard theme. */
  theme?: string[];
  onEditTheme?: () => void;
  footer?: { cf?: () => void; alternating?: () => void };
}) {
  const { t, lang } = useLang();
  const current = toHex(value ?? null);
  const [custom, setCustom] = useState<string[]>(() => loadCustomColors());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current ?? "#4285f4");
  const draftHex = toHex(draft.startsWith("#") ? draft : `#${draft}`);

  const pickCustom = (hex: string | null) => {
    const h = toHex(hex);
    if (!h) return;
    setCustom(addCustomColor(h));
    setEditing(false);
    onPick(h);
  };
  const eyeDropper = typeof window !== "undefined" ? (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper : undefined;

  const nameOf = (hex: string) => {
    const s = swatchOf(hex);
    return s ? (lang === "id" ? s.id : s.en) : hex;
  };

  return (
    <div className="w-[236px] px-2 py-1 text-xs" onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); }}>
      <button
        type="button"
        role="menuitem"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(null)}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
      >
        <DropletOff className="h-4 w-4 text-muted-foreground" /> {resetLabel ?? t("Reset")}
      </button>

      <div className="mt-1 grid grid-cols-10 gap-[3px]" role="group" aria-label={t("Colour palette")}>
        {PALETTE_ROWS.flat().map((s) => (
          <Swatch key={s.hex} hex={s.hex} name={lang === "id" ? s.id : s.en} on={current === s.hex} onPick={() => onPick(s.hex)} />
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("Standard")}
        {onEditTheme && (
          <button type="button" title={t("Edit theme colours")} aria-label={t("Edit theme colours")}
            onMouseDown={(e) => e.preventDefault()} onClick={onEditTheme}
            className="grid h-5 w-5 place-items-center rounded hover:bg-muted hover:text-foreground"><Pencil className="h-3 w-3" /></button>
        )}
      </div>
      <div className="mt-1 grid grid-cols-10 gap-[3px]">
        {theme.slice(0, 8).map((h, i) => {
          const hex = toHex(h) ?? "#000000";
          return <Swatch key={`${hex}${i}`} hex={hex} name={nameOf(hex)} on={current === hex} onPick={() => onPick(hex)} />;
        })}
      </div>

      <div className="mt-2 border-t border-border pt-2">
        <div className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Custom")}</div>
        <div className="mt-1 grid grid-cols-10 gap-[3px]">
          <button type="button" title={t("Custom colour")} aria-label={t("Custom colour")} aria-expanded={editing}
            onMouseDown={(e) => e.preventDefault()} onClick={() => setEditing((v) => !v)}
            className={cn("grid h-[19px] w-[19px] place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground", editing && "bg-muted text-foreground")}>
            <CirclePlus className="h-4 w-4" />
          </button>
          {eyeDropper && (
            <button type="button" title={t("Pick a colour from the screen")} aria-label={t("Pick a colour from the screen")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { new eyeDropper().open().then((r) => pickCustom(r.sRGBHex)).catch(() => {}); }}
              className="grid h-[19px] w-[19px] place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <Pipette className="h-3.5 w-3.5" />
            </button>
          )}
          {custom.map((hex) => <Swatch key={hex} hex={hex} name={hex} on={current === hex} onPick={() => onPick(hex)} />)}
        </div>
        {editing && (
          <div className="mt-2 flex items-center gap-1.5">
            <input
              type="color"
              value={draftHex ?? "#000000"}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={t("Custom colour")}
              className="h-7 w-9 shrink-0 cursor-pointer rounded border border-border bg-background p-0.5"
            />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === "Enter" && draftHex) { e.preventDefault(); pickCustom(draftHex); } }}
              aria-label={t("Hex")}
              placeholder="#rrggbb"
              spellCheck={false}
              className={cn("h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40",
                draftHex ? "border-border" : "border-destructive")}
            />
            <button type="button" disabled={!draftHex} onMouseDown={(e) => e.preventDefault()} onClick={() => pickCustom(draftHex)}
              className="h-7 shrink-0 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-40">{t("OK")}</button>
          </div>
        )}
      </div>

      {footer && (footer.cf || footer.alternating) && (
        <div className="mt-2 border-t border-border pt-1">
          {footer.cf && <FooterLink onClick={footer.cf}>{t("Conditional formatting")}</FooterLink>}
          {footer.alternating && <FooterLink onClick={footer.alternating}>{t("Alternating colours")}</FooterLink>}
        </div>
      )}
    </div>
  );
}

function FooterLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className="block w-full rounded-md px-1.5 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">{children}</button>
  );
}

function Swatch({ hex, name, on, onPick }: { hex: string; name: string; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      style={{ backgroundColor: hex }}
      className={cn(
        "grid h-[19px] w-[19px] place-items-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // White and near-white swatches need an edge to be visible on the popover.
        "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]",
      )}
    >
      {on && <Check className="h-3 w-3" strokeWidth={3} style={{ color: readableText(hex) }} />}
    </button>
  );
}

/**
 * A toolbar button for a colour (text, fill): the icon with the current colour as a bar under it,
 * opening the ColorPicker. Reset hands back null.
 */
export function ColorMenuButton({ label, icon, value, onPick, disabled, resetLabel, theme, onEditTheme, footer, defaultBar }: {
  label: string;
  icon: ReactNode;
  value: string | null | undefined;
  onPick: (hex: string | null) => void;
  disabled?: boolean;
  resetLabel?: string;
  theme?: string[];
  onEditTheme?: () => void;
  footer?: { cf?: () => void; alternating?: () => void };
  /** Bar colour when no colour is set (text colour: the ink; fill: nothing). */
  defaultBar?: string;
}) {
  const bar = toHex(value ?? null) ?? defaultBar ?? "transparent";
  return (
    <Menu
      label={label}
      disabled={disabled}
      panelClassName="min-w-0"
      trigger={
        <span className="relative grid h-5 w-5 place-items-center [&_svg]:h-4 [&_svg]:w-4">
          <span className="-mt-1 grid place-items-center">{icon}</span>
          <span className="absolute bottom-0 left-0 right-0 h-[3px] rounded-[1px]" style={{ backgroundColor: bar }} />
        </span>
      }
    >
      {(close) => (
        <ColorPicker
          value={value}
          resetLabel={resetLabel}
          theme={theme}
          onEditTheme={onEditTheme ? () => { close(); onEditTheme(); } : undefined}
          footer={footer ? {
            cf: footer.cf ? () => { close(); footer.cf!(); } : undefined,
            alternating: footer.alternating ? () => { close(); footer.alternating!(); } : undefined,
          } : undefined}
          onPick={(h) => { onPick(h); close(); }}
        />
      )}
    </Menu>
  );
}
