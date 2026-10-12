import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { SheetLocaleCode, SheetSettingsModel } from "@/lib/sheet-model";
import { COMPAT_SHORTCUTS_KEY, SHORTCUT_GROUPS, isMac, keyCaps, matchesShortcut } from "@/lib/sheet-shortcuts";
import { FieldLabel, SheetDialog, inputClass, primaryBtn, secondaryBtn, selectClass } from "./sheet-shell";

// ── Spreadsheet settings ────────────────────────────────────────────────────────────────────────

const ZONES = [
  "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
  "America/Sao_Paulo", "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "Africa/Cairo", "Europe/Istanbul",
  "Europe/Moscow", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Jakarta",
  "Asia/Pontianak", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore", "Asia/Kuala_Lumpur", "Asia/Manila",
  "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Seoul", "Asia/Tokyo", "Australia/Perth", "Australia/Sydney", "Pacific/Auckland",
];

/** "GMT+07:00" for a zone right now (DST-aware), "GMT+00:00" for UTC. */
function gmtOffset(zone: string): { label: string; minutes: number } {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
    if (!m) return { label: "GMT+00:00", minutes: 0 };
    const minutes = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    return { label: `GMT${m[1]}${m[2]}:${m[3]}`, minutes };
  } catch {
    return { label: "GMT", minutes: 0 };
  }
}

type SettingsPatch = Pick<SheetSettingsModel, "locale" | "timeZone" | "recalc" | "iterative">;

/** File ▸ Settings: "Settings for this spreadsheet" — General (locale, time zone) and Calculation. */
export function SheetSettingsDialog({ settings, onSave, onClose }: {
  settings: SettingsPatch;
  onSave: (patch: SettingsPatch) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [tab, setTab] = useState<"general" | "calc">("general");
  const [locale, setLocale] = useState<SheetLocaleCode>(settings.locale ?? "id-ID");
  const [zone, setZone] = useState(settings.timeZone ?? "Asia/Jakarta");
  const [recalc, setRecalc] = useState<NonNullable<SettingsPatch["recalc"]>>(settings.recalc ?? "change");
  const [iterOn, setIterOn] = useState(settings.iterative?.on ?? false);
  const [maxIt, setMaxIt] = useState(String(settings.iterative?.max ?? 50));
  const [thresh, setThresh] = useState(String(settings.iterative?.threshold ?? 0.05));

  const zones = useMemo(() => {
    const list = ZONES.includes(zone) ? ZONES : [...ZONES, zone];
    return list.map((z) => ({ z, ...gmtOffset(z) })).sort((a, b) => a.minutes - b.minutes || a.z.localeCompare(b.z));
  }, [zone]);
  const maxN = Number(maxIt), threshN = Number(thresh.replace(",", "."));
  const iterValid = Number.isInteger(maxN) && maxN >= 1 && maxN <= 1000 && Number.isFinite(threshN) && threshN >= 0;

  const save = () => {
    if (iterOn && !iterValid) return;
    onSave({
      locale, timeZone: zone, recalc,
      iterative: { on: iterOn, max: iterValid ? maxN : 50, threshold: iterValid ? threshN : 0.05 },
    });
  };
  const tabBtn = (on: boolean) => cn("-mb-px border-b-2 px-3 py-2 text-xs font-semibold transition", on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground");

  return (
    <SheetDialog
      title={t("Settings for this spreadsheet")}
      onClose={onClose}
      width={520}
      footer={<><button className={secondaryBtn} onClick={onClose}>{t("Cancel")}</button><button className={primaryBtn} onClick={save} disabled={iterOn && !iterValid}>{t("Save settings")}</button></>}
    >
      <div role="tablist" className="mb-4 flex border-b border-border">
        <button role="tab" type="button" aria-selected={tab === "general"} onClick={() => setTab("general")} className={tabBtn(tab === "general")}>{t("General")}</button>
        <button role="tab" type="button" aria-selected={tab === "calc"} onClick={() => setTab("calc")} className={tabBtn(tab === "calc")}>{t("Calculation")}</button>
      </div>
      {tab === "general" ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <FieldLabel htmlFor="ss-locale">{t("Locale")}</FieldLabel>
            <select id="ss-locale" value={locale} onChange={(e) => setLocale(e.target.value as SheetLocaleCode)} className={selectClass}>
              <option value="id-ID">Indonesia (id-ID)</option>
              <option value="en-US">United States (en-US)</option>
            </select>
            <p className="text-[11px] leading-snug text-muted-foreground">{t("This affects formatting details such as functions, dates and currency.")}</p>
          </div>
          <div className="space-y-1">
            <FieldLabel htmlFor="ss-zone">{t("Time zone")}</FieldLabel>
            <select id="ss-zone" value={zone} onChange={(e) => setZone(e.target.value)} className={selectClass}>
              {zones.map((z) => <option key={z.z} value={z.z}>({z.label}) {z.z.replace(/_/g, " ").replace(/^.*\//, "")}</option>)}
            </select>
            <p className="text-[11px] leading-snug text-muted-foreground">{t("Used by NOW and TODAY and by the edit times in version history.")}</p>
          </div>
          <div className="space-y-1">
            <FieldLabel>{t("Display language")}</FieldLabel>
            <p className="text-[11px] leading-snug text-muted-foreground">{t("The interface follows your NEXUS language. Change it in your profile.")}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <FieldLabel htmlFor="ss-recalc">{t("Recalculation")}</FieldLabel>
            <select id="ss-recalc" value={recalc} onChange={(e) => setRecalc(e.target.value as typeof recalc)} className={selectClass}>
              <option value="change">{t("On change")}</option>
              <option value="minute">{t("On change and every minute")}</option>
              <option value="hour">{t("On change and every hour")}</option>
            </select>
            <p className="text-[11px] leading-snug text-muted-foreground">{t("How often NOW, TODAY, RAND and RANDBETWEEN are updated.")}</p>
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="ss-iter">{t("Iterative calculation")}</FieldLabel>
            <select id="ss-iter" value={iterOn ? "on" : "off"} onChange={(e) => setIterOn(e.target.value === "on")} className={selectClass}>
              <option value="off">{t("Off")}</option>
              <option value="on">{t("On")}</option>
            </select>
            {iterOn && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <FieldLabel htmlFor="ss-max">{t("Max number of iterations")}</FieldLabel>
                  <input id="ss-max" inputMode="numeric" value={maxIt} onChange={(e) => setMaxIt(e.target.value)} className={cn(inputClass, !(Number.isInteger(maxN) && maxN >= 1 && maxN <= 1000) && "border-destructive")} />
                </div>
                <div className="space-y-1">
                  <FieldLabel htmlFor="ss-thr">{t("Threshold")}</FieldLabel>
                  <input id="ss-thr" inputMode="decimal" value={thresh} onChange={(e) => setThresh(e.target.value)} className={cn(inputClass, !(Number.isFinite(threshN) && threshN >= 0) && "border-destructive")} />
                </div>
              </div>
            )}
            <p className="text-[11px] leading-snug text-muted-foreground">{t("Lets a formula refer to its own result (a circular reference), stopping after the maximum or when results change by less than the threshold.")}</p>
          </div>
        </div>
      )}
    </SheetDialog>
  );
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────────────────────────

function readCompat(): boolean {
  try { return localStorage.getItem(COMPAT_SHORTCUTS_KEY) === "1"; } catch { return false; }
}

/** Help ▸ Keyboard shortcuts (Ctrl+/): search, the compatible-shortcuts switch, grouped tables. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [compat, setCompat] = useState(readCompat);
  const mac = useMemo(() => isMac(), []);
  const toggle = () => {
    const next = !compat;
    setCompat(next);
    try { localStorage.setItem(COMPAT_SHORTCUTS_KEY, next ? "1" : "0"); } catch { /* private mode */ }
  };
  const groups = SHORTCUT_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => matchesShortcut(it, t(it.label), q)) }))
    .filter((g) => g.items.length);

  return (
    <SheetDialog title={t("Keyboard shortcuts")} onClose={onClose} width={760}>
      <div className="sticky top-0 z-[1] -mx-5 mb-3 flex flex-wrap items-center gap-3 bg-popover px-5 pb-2">
        <label className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search")} aria-label={t("Search")} className={cn(inputClass, "pl-7")} />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <button
            type="button"
            role="switch"
            aria-checked={compat}
            onClick={toggle}
            className={cn("relative h-4 w-7 shrink-0 rounded-full transition", compat ? "bg-primary" : "bg-muted-foreground/30 dark:bg-control-border")}
          >
            <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all dark:bg-background", compat ? "left-3.5" : "left-0.5")} />
          </button>
          {t("Enable compatible spreadsheet shortcuts")}
        </label>
      </div>
      {groups.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">{t("No shortcuts match \"{q}\".", { q })}</p>}
      <div className="columns-1 gap-6 md:columns-2">
        {groups.map((g) => (
          <section key={g.group} className="mb-4 break-inside-avoid">
            <h3 className="mb-1 text-xs font-semibold">{t(g.group)}</h3>
            <table className="w-full text-xs">
              <tbody>
                {g.items.map((it) => (
                  <tr key={it.label} className="border-t border-border">
                    <td className="py-1.5 pr-2 align-top">{t(it.label)}</td>
                    <td className="py-1.5 text-right align-top">
                      {it.keys.map((k, i) => (
                        <span key={k} className="whitespace-nowrap">
                          {i > 0 && <span className="px-1 text-[10px] text-muted-foreground">{t("or")}</span>}
                          {keyCaps(k, mac).map((cap, j) => (
                            <kbd key={j} className="ml-0.5 inline-block min-w-[18px] rounded border border-border bg-muted px-1 py-px text-center font-sans text-[10px] font-medium">{cap}</kbd>
                          ))}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </SheetDialog>
  );
}
