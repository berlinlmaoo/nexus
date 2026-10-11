import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { SheetTheme } from "@/lib/sheet-model";
import { THEMES, THEME_FONTS, resolveTheme, sameTheme } from "@/lib/sheet-themes";
import { FieldLabel, SidePanel, primaryBtn, secondaryBtn, selectClass } from "./sheet-shell";

/** A preset card: the theme's font on a "Total 208" figure, accent bars and stripes. */
function ThemeCard({ theme, active, onPick }: { theme: SheetTheme; active: boolean; onPick: () => void }) {
  const { t } = useLang();
  const r = resolveTheme(theme);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className="group block w-full text-left"
    >
      <div className={cn("relative grid grid-cols-2 gap-2 rounded-lg border bg-white p-2.5 transition", active ? "border-primary ring-2 ring-primary/30" : "border-border group-hover:border-ring/60")}>
        <div style={{ fontFamily: r.font, color: r.text }}>
          <div className="border-b border-black/30 text-[8px] leading-3">Total</div>
          <div className="text-xl font-bold leading-7">208</div>
          <div className="mt-1 space-y-[3px]">
            <div className="h-1.5 rounded-[1px]" style={{ background: r.accents[0] }} />
            <div className="h-1.5 rounded-[1px] opacity-40" style={{ background: r.accents[0] }} />
            <div className="h-1.5 rounded-[1px]" style={{ background: r.accents[1] }} />
          </div>
        </div>
        <div className="flex items-end gap-[3px] rounded border border-black/5 p-1">
          {[0.55, 0.9, 0.45, 0.75, 0.6, 1].map((h, i) => (
            <div key={i} className="flex-1 rounded-t-[1px]" style={{ height: `${h * 44}px`, background: r.accents[i] }} />
          ))}
        </div>
        {active && <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-3 w-3" /></span>}
      </div>
      <div className="mt-1 text-xs font-medium" style={{ fontFamily: r.font }}>{t(theme.name)}</div>
    </button>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} aria-label={label} className="h-7 w-9 cursor-pointer rounded border border-border bg-background p-0.5" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[10px] uppercase text-muted-foreground">{value}</span>
    </label>
  );
}

/** Format ▸ Theme: "Current theme: X" + Customise, and the preset gallery. Picking previews live. */
export function ThemePanel({ theme, onPreview, onSave, onClose }: {
  theme: SheetTheme | undefined;
  onPreview: (t: SheetTheme) => void;
  onSave: (t: SheetTheme) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [current, setCurrent] = useState<SheetTheme>(() => resolveTheme(theme));
  const [custom, setCustom] = useState(false);
  const set = (next: SheetTheme) => { setCurrent(next); onPreview(next); };
  const edit = (patch: Partial<SheetTheme>) => set({ ...resolveTheme(current), ...patch, name: "Custom" });
  const r = resolveTheme(current);

  if (custom) {
    return (
      <SidePanel
        title={t("Theme")}
        onClose={onClose}
        footer={<><button className={secondaryBtn} onClick={() => setCustom(false)}>{t("Back")}</button><span className="flex-1" /><button className={primaryBtn} onClick={() => { onSave(current); setCustom(false); }}>{t("Done")}</button></>}
      >
        <div className="space-y-4 p-3">
          <div className="space-y-1">
            <FieldLabel htmlFor="theme-font">{t("Font")}</FieldLabel>
            <select id="theme-font" value={r.font} onChange={(e) => edit({ font: e.target.value })} className={selectClass} style={{ fontFamily: r.font }}>
              {THEME_FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <FieldLabel>{t("Text")}</FieldLabel>
            <ColorField label={t("Text colour")} value={r.text} onChange={(v) => edit({ text: v })} />
          </div>
          <div className="space-y-2">
            <FieldLabel>{t("Accent colours")}</FieldLabel>
            {r.accents.map((c, i) => (
              <ColorField key={i} label={t("Accent {n}", { n: i + 1 })} value={c} onChange={(v) => edit({ accents: r.accents.map((x, j) => (j === i ? v : x)) })} />
            ))}
          </div>
          <div className="space-y-2">
            <FieldLabel>{t("Link")}</FieldLabel>
            <ColorField label={t("Link colour")} value={r.link} onChange={(v) => edit({ link: v })} />
          </div>
        </div>
      </SidePanel>
    );
  }

  return (
    <SidePanel
      title={t("Theme")}
      onClose={onClose}
      footer={<><span className="flex-1" /><button className={primaryBtn} onClick={() => onSave(current)}>{t("Done")}</button></>}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0 flex-1 text-[11px] leading-tight text-muted-foreground">
          {t("Current theme")}
          <div className="truncate text-xs font-semibold text-foreground">{t(r.name)}</div>
        </div>
        <button type="button" className={primaryBtn} onClick={() => setCustom(true)}>{t("Customise")}</button>
      </div>
      <div className="grid gap-4 p-3 max-md:grid-cols-2">
        {THEMES.map((th) => (
          <ThemeCard key={th.name} theme={th} active={sameTheme(current, th)} onPick={() => set(th)} />
        ))}
      </div>
    </SidePanel>
  );
}
