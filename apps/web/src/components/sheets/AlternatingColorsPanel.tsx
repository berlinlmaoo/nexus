import { useEffect, useState } from "react";
import { Table2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { SheetShape } from "@/lib/sheet-formula";
import { newId, type Banding, type Hex } from "@/lib/sheet-model";
import { rangeFromA1, rangeToA1 } from "@/lib/sheet-validation";
import { HexColorButton } from "./ConditionalFormatPanel";
import { FieldLabel, SidePanel, inputClass, primaryBtn, secondaryBtn } from "./sheet-shell";

/** Sheets' 12 "Default styles": header colour, band 1 (white), band 2. */
export const BANDING_PRESETS: { header: Hex; c1: Hex; c2: Hex }[] = [
  { header: "#bdbdbd", c1: "#ffffff", c2: "#f3f3f3" },
  { header: "#4dd0e1", c1: "#ffffff", c2: "#e0f7fa" },
  { header: "#63d297", c1: "#ffffff", c2: "#e7f9ef" },
  { header: "#f7cb4d", c1: "#ffffff", c2: "#fef8e3" },
  { header: "#f46524", c1: "#ffffff", c2: "#ffe6dd" },
  { header: "#5b95f9", c1: "#ffffff", c2: "#e8f0fe" },
  { header: "#26a69a", c1: "#ffffff", c2: "#ddf2f0" },
  { header: "#78909c", c1: "#ffffff", c2: "#ebeff1" },
  { header: "#cca677", c1: "#ffffff", c2: "#f8f2eb" },
  { header: "#8bc34a", c1: "#ffffff", c2: "#eef7e3" },
  { header: "#8989eb", c1: "#ffffff", c2: "#e8e7fc" },
  { header: "#bdbdbd", c1: "#ffffff", c2: "#f3f3f3" },
];

type Draft = { id: string; range: string; headerOn: boolean; footerOn: boolean; header: Hex; c1: Hex; c2: Hex; footer: Hex };

function toDraft(b: Banding | null, selectionRange: string, shape: SheetShape): Draft {
  const p = BANDING_PRESETS[0];
  if (!b) return { id: newId("band"), range: selectionRange, headerOn: true, footerOn: false, header: p.header, c1: p.c1, c2: p.c2, footer: p.header };
  return {
    id: b.id,
    range: rangeToA1(b.range, shape),
    headerOn: Boolean(b.header),
    footerOn: Boolean(b.footer),
    header: b.header ?? p.header,
    c1: b.c1,
    c2: b.c2,
    footer: b.footer ?? b.header ?? p.header,
  };
}
function fromDraft(d: Draft, shape: SheetShape): Banding | null {
  const range = rangeFromA1(d.range, shape);
  if (!range) return null;
  return { id: d.id, range, c1: d.c1, c2: d.c2, ...(d.headerOn ? { header: d.header } : {}), ...(d.footerOn ? { footer: d.footer } : {}) };
}

/**
 * "Alternating colours" — the right-hand sidebar. Like Sheets it applies to the range as soon as it
 * opens (a live preview through `onPreview`); Done saves, Cancel reverts, and "Remove alternating
 * colours" deletes the banding. The parent should drop its preview on `onSave`, `onRemove` and `onClose`.
 */
export function AlternatingColorsPanel({ banding, selectionRange, shape, onPreview, onSave, onRemove, onClose }: {
  banding: Banding | null;
  /** The selection as A1 ("A1:E8"); a new banding covers it. */
  selectionRange: string;
  shape: SheetShape;
  onPreview: (b: Banding | null) => void;
  onSave: (b: Banding) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [draft, setDraft] = useState<Draft>(() => toDraft(banding, selectionRange, shape));
  const [error, setError] = useState(false);
  useEffect(() => {
    const b = fromDraft(draft, shape);
    if (b) onPreview(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const done = () => {
    const b = fromDraft(draft, shape);
    if (!b) { setError(true); return; }
    onSave(b);
    onClose();
  };
  const cancel = () => { onPreview(banding); onClose(); };
  const close = () => {
    // Closing keeps what is shown (Sheets applied it on open); an unreadable range is dropped.
    const b = fromDraft(draft, shape);
    if (b) onSave(b); else onPreview(banding);
    onClose();
  };
  const isPreset = (p: (typeof BANDING_PRESETS)[number]) => p.header === draft.header && p.c1 === draft.c1 && p.c2 === draft.c2;

  return (
    <SidePanel
      title={t("Alternating colours")}
      onClose={close}
      footer={(
        <button type="button" onClick={() => { onRemove(); onClose(); }}
          className="mx-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10">
          <Trash2 className="h-3.5 w-3.5" /> {t("Remove alternating colours")}
        </button>
      )}
    >
      <div className="space-y-4 p-3">
        <section className="space-y-1.5">
          <FieldLabel htmlFor="band-range">{t("Apply to range")}</FieldLabel>
          <div className="relative">
            <input id="band-range" value={draft.range} onChange={(e) => { setError(false); set({ range: e.target.value }); }}
              className={cn(inputClass, "pr-8 font-mono", error && "border-destructive")} />
            <button type="button" onClick={() => set({ range: selectionRange })} title={t("Use the selected range")} aria-label={t("Use the selected range")}
              className="absolute right-1 top-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Table2 className="h-3.5 w-3.5" /></button>
          </div>
          {error && <p className="text-[11px] text-destructive">{t("Invalid range")}</p>}
        </section>

        <section className="space-y-1.5">
          <div className="text-xs font-semibold">{t("Styles")}</div>
          <div className="flex items-center gap-5 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.headerOn} onChange={(e) => set({ headerOn: e.target.checked })} className="h-3.5 w-3.5 accent-ring" /> {t("Header")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.footerOn} onChange={(e) => set({ footerOn: e.target.checked })} className="h-3.5 w-3.5 accent-ring" /> {t("Footer")}
            </label>
          </div>
        </section>

        <section className="space-y-1.5">
          <FieldLabel>{t("Default styles")}</FieldLabel>
          <div className="grid grid-cols-6 gap-1.5">
            {BANDING_PRESETS.map((p, i) => (
              <button key={i} type="button" onClick={() => set({ header: p.header, c1: p.c1, c2: p.c2, footer: p.header })}
                aria-label={t("Style {n}", { n: i + 1 })} aria-pressed={isPreset(p)}
                className={cn("flex h-9 flex-col overflow-hidden rounded border border-black/10", isPreset(p) && "ring-2 ring-ring ring-offset-1 ring-offset-card")}>
                {draft.headerOn && <span className="h-1/4 w-full" style={{ background: p.header }} />}
                {[p.c1, p.c2, p.c1].map((c, j) => <span key={j} className="w-full flex-1" style={{ background: c }} />)}
                {draft.footerOn && <span className="h-1/4 w-full" style={{ background: p.header }} />}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-1.5">
          <FieldLabel>{t("Custom styles")}</FieldLabel>
          <div className="space-y-1.5 rounded-lg border border-border p-2">
            {([
              ...(draft.headerOn ? [["header", "Header"] as const] : []),
              ["c1", "Colour 1"] as const,
              ["c2", "Colour 2"] as const,
              ...(draft.footerOn ? [["footer", "Footer"] as const] : []),
            ]).map(([k, l]) => (
              <div key={k} className="flex items-center gap-1.5">
                <span className="flex h-8 flex-1 items-center justify-center rounded-md border border-black/10 text-xs" style={{ background: draft[k] }}>{t(l)}</span>
                <HexColorButton label={t(l)} value={draft[k]} allowReset={false} onChange={(c) => c && set({ [k]: c } as Partial<Draft>)} />
              </div>
            ))}
          </div>
        </section>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={cancel} className={cn(secondaryBtn, "border border-border")}>{t("Cancel")}</button>
          <button type="button" onClick={done} className={primaryBtn}>{t("Done")}</button>
        </div>
      </div>
    </SidePanel>
  );
}
