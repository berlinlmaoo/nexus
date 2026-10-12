import { useState } from "react";
import { Lightbulb, Lock, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { SheetShape } from "@/lib/sheet-formula";
import { newId, type NamedRange, type Protection } from "@/lib/sheet-model";
import { rangeFromA1, rangeToA1 } from "@/lib/sheet-validation";
import { FieldLabel, SheetDialog, SidePanel, inputClass, primaryBtn, secondaryBtn, selectClass } from "./sheet-shell";

// ── Named ranges ────────────────────────────────────────────────────────────────────────────────

/**
 * Why a named-range name is refused, or null when it's fine. Sheets' rules: starts with a letter or
 * "_", only letters, digits, "_" and "."; can't look like a cell (A1, R1C1), can't be TRUE/FALSE,
 * at most 250 characters, and unique in the file (case-insensitive).
 */
export function validateRangeName(name: string, existing: { id: string; name: string }[], selfId?: string): string | null {
  const n = name.trim();
  if (!n) return "Enter a name";
  if (n.length > 250) return "Names can be at most 250 characters";
  if (!/^[A-Za-z_\p{L}][A-Za-z0-9_.\p{L}]*$/u.test(n)) return "Names must start with a letter or underscore and contain only letters, numbers, underscores and periods";
  if (/^(true|false)$/i.test(n)) return "TRUE and FALSE can't be used as names";
  if (/^[A-Za-z]{1,3}\d+$/.test(n) || /^R\d*C\d*$/i.test(n)) return "Names can't look like a cell reference, e.g. A1 or R1C1";
  if (existing.some((r) => r.id !== selfId && r.name.toLowerCase() === n.toLowerCase())) return "That name is already used by another range";
  return null;
}

/** The next free "NamedRange1", "NamedRange2"… in the interface language. */
function nextName(ranges: NamedRange[], base: string): string {
  for (let i = 1; ; i += 1) {
    const n = `${base}${i}`;
    if (!ranges.some((r) => r.name.toLowerCase() === n.toLowerCase())) return n;
  }
}

/** Data ▸ Named ranges: the list (name + range, edit/delete) and the add/edit form. */
export function NamedRangesPanel({ ranges, shape, sheetName, selectionRange, canEdit, onSave, onClose, onJump }: {
  ranges: NamedRange[];
  shape: SheetShape;
  sheetName: string;
  /** The current selection in A1 ("A1:E8"), the default range of a new name. */
  selectionRange: string;
  canEdit: boolean;
  onSave: (next: NamedRange[]) => void;
  onClose: () => void;
  onJump: (r: NamedRange) => void;
}) {
  const { t, lang } = useLang();
  const base = lang === "id" ? "RentangBernama" : "NamedRange";
  const [draft, setDraft] = useState<{ id: string | null; name: string; range: string } | null>(() =>
    canEdit && ranges.length === 0 ? { id: null, name: nextName(ranges, base), range: `${sheetName}!${selectionRange}` } : null);
  const [touched, setTouched] = useState(false);

  const nameError = draft ? validateRangeName(draft.name, ranges, draft.id ?? undefined) : null;
  const stored = draft ? rangeFromA1(draft.range, shape) : null;
  const rangeError = draft && !stored ? "Enter a valid range, e.g. Sheet1!A1:B10" : null;

  const done = () => {
    setTouched(true);
    if (!draft || nameError || !stored) return;
    const item: NamedRange = { id: draft.id ?? newId("nr"), name: draft.name.trim(), range: stored };
    onSave(draft.id ? ranges.map((r) => (r.id === draft.id ? item : r)) : [...ranges, item]);
    setDraft(null);
    setTouched(false);
  };
  const tip = (
    <div className="m-3 rounded-lg bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-foreground"><Lightbulb className="h-3.5 w-3.5" />{t("Tip")}</div>
      {t("Use named ranges in formulas. They are easier to read and to reuse.")}
      <code className="mt-1.5 block rounded-md bg-background px-2 py-1 font-mono text-[11px] text-foreground">=SUM(NamedRange1)</code>
    </div>
  );

  if (draft) {
    return (
      <SidePanel
        title={t("Named ranges")}
        onClose={onClose}
        footer={<><span className="flex-1" /><button className={secondaryBtn} onClick={() => { setDraft(null); setTouched(false); if (!ranges.length) onClose(); }}>{t("Cancel")}</button><button className={primaryBtn} onClick={done} disabled={touched && Boolean(nameError || rangeError)}>{t("Done")}</button></>}
      >
        <div className="space-y-3 p-3">
          <div className="space-y-1">
            <FieldLabel htmlFor="nr-name">{t("Name")}</FieldLabel>
            <input
              id="nr-name"
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") done(); }}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && Boolean(nameError)}
              aria-describedby={touched && nameError ? "nr-name-err" : undefined}
              className={cn(inputClass, touched && nameError && "border-destructive")}
            />
            {touched && nameError && <p id="nr-name-err" className="text-[11px] text-destructive">{t(nameError)}</p>}
          </div>
          <div className="space-y-1">
            <FieldLabel htmlFor="nr-range">{t("Range")}</FieldLabel>
            <input
              id="nr-range"
              value={draft.range}
              onChange={(e) => setDraft({ ...draft, range: e.target.value })}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") done(); }}
              placeholder={t("e.g. Sheet1!A1:B10")}
              aria-invalid={touched && Boolean(rangeError)}
              className={cn(inputClass, "font-mono", touched && rangeError && "border-destructive")}
            />
            {touched && rangeError && <p className="text-[11px] text-destructive">{t(rangeError)}</p>}
          </div>
        </div>
        {tip}
      </SidePanel>
    );
  }

  return (
    <SidePanel title={t("Named ranges")} onClose={onClose}>
      <div className="space-y-1 p-2">
        {ranges.length === 0 && <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">{t("No named ranges yet. Name a range to use it in formulas instead of A1 references.")}</p>}
        {ranges.map((r) => (
          <div key={r.id} className="group flex items-center gap-1 rounded-lg px-1 transition hover:bg-muted/60">
            <button type="button" onClick={() => onJump(r)} className="min-w-0 flex-1 px-1.5 py-1.5 text-left">
              <div className="truncate text-xs font-semibold">{r.name}</div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">{sheetName}!{rangeToA1(r.range, shape)}</div>
            </button>
            {canEdit && (
              <div className="flex shrink-0 gap-0.5 opacity-0 pointer-coarse:opacity-100! transition group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
                <button type="button" title={t("Edit")} aria-label={t("Edit")} onClick={() => setDraft({ id: r.id, name: r.name, range: `${sheetName}!${rangeToA1(r.range, shape)}` })} className="rounded p-1 text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" title={t("Delete")} aria-label={t("Delete")} onClick={() => onSave(ranges.filter((x) => x.id !== r.id))} className="rounded p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            )}
          </div>
        ))}
        {canEdit && (
          <button type="button" onClick={() => setDraft({ id: null, name: nextName(ranges, base), range: `${sheetName}!${selectionRange}` })} className="mt-1 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-info hover:bg-info/10">
            <Plus className="h-3.5 w-3.5" />{t("Add a range")}
          </button>
        )}
      </div>
      {tip}
    </SidePanel>
  );
}

// ── Protected sheets & ranges ───────────────────────────────────────────────────────────────────

type ProtDraft = {
  id: string | null;
  desc: string;
  tab: "range" | "sheet";
  range: string;
  exceptOn: boolean;
  except: string;
  mode: "warn" | "restrict";
  who: "me" | "custom";
  editors: string[];
  by?: string;
};

/** Data ▸ Protect sheets and ranges: list, then description + Range/Sheet, then permissions. */
export function ProtectedRangesPanel({ protections, shape, sheetName, selectionRange, members, meId, canManage, onSave, onClose }: {
  protections: Protection[];
  shape: SheetShape;
  sheetName: string;
  selectionRange: string;
  members: { id: string; name: string }[];
  meId: string;
  canManage: boolean;
  onSave: (next: Protection[]) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const blank = (): ProtDraft => ({ id: null, desc: "", tab: "range", range: `${sheetName}!${selectionRange}`, exceptOn: false, except: "", mode: "warn", who: "me", editors: [], by: meId });
  const [draft, setDraft] = useState<ProtDraft | null>(() => (canManage && protections.length === 0 ? blank() : null));
  const [step, setStep] = useState<"what" | "who">("what");
  const [error, setError] = useState<string | null>(null);

  const open = (p: Protection) => {
    setDraft({
      id: p.id, desc: p.desc ?? "", tab: p.sheet ? "sheet" : "range",
      range: p.range ? `${sheetName}!${rangeToA1(p.range, shape)}` : `${sheetName}!${selectionRange}`,
      exceptOn: Boolean(p.except?.length), except: (p.except ?? []).map((x) => rangeToA1(x, shape)).join(", "),
      mode: p.mode, who: (p.editors ?? []).some((e) => e !== (p.by ?? meId)) ? "custom" : "me", editors: p.editors ?? [], by: p.by,
    });
    setStep("what");
    setError(null);
  };
  const cancel = () => { setDraft(null); setStep("what"); setError(null); if (!protections.length) onClose(); };

  const toNext = () => {
    if (!draft) return;
    if (draft.tab === "range" && !rangeFromA1(draft.range, shape)) { setError("Enter a valid range, e.g. Sheet1!A1:B10"); return; }
    if (draft.tab === "sheet" && draft.exceptOn && draft.except.split(",").some((x) => x.trim() && !rangeFromA1(x, shape))) { setError("Enter a valid range, e.g. Sheet1!A1:B10"); return; }
    setError(null);
    setStep("who");
  };
  const finish = () => {
    if (!draft) return;
    const owner = draft.by ?? meId;
    const editors = draft.mode === "restrict" ? [...new Set([owner, ...(draft.who === "custom" ? draft.editors : [])])] : undefined;
    const item: Protection = {
      id: draft.id ?? newId("pr"),
      ...(draft.tab === "sheet"
        ? { sheet: true as const, ...(draft.exceptOn ? { except: draft.except.split(",").map((x) => rangeFromA1(x, shape)).filter((x): x is string => Boolean(x)) } : {}) }
        : { range: rangeFromA1(draft.range, shape) ?? undefined }),
      ...(draft.desc.trim() ? { desc: draft.desc.trim() } : {}),
      mode: draft.mode,
      ...(editors ? { editors } : {}),
      by: owner,
    };
    onSave(draft.id ? protections.map((p) => (p.id === draft.id ? item : p)) : [...protections, item]);
    setDraft(null);
    setStep("what");
  };

  const label = (p: Protection) => p.sheet
    ? (p.except?.length ? t("{sheet} except {ranges}", { sheet: sheetName, ranges: p.except.map((x) => rangeToA1(x, shape)).join(", ") }) : sheetName)
    : `${sheetName}!${p.range ? rangeToA1(p.range, shape) : "#REF!"}`;

  if (draft && step === "who") {
    return (
      <SidePanel
        title={t("Range editing permissions")}
        onClose={onClose}
        footer={<><button className={secondaryBtn} onClick={() => setStep("what")}>{t("Back")}</button><span className="flex-1" /><button className={secondaryBtn} onClick={cancel}>{t("Cancel")}</button><button className={primaryBtn} onClick={finish}>{t("Done")}</button></>}
      >
        <fieldset className="space-y-3 p-3">
          <legend className="sr-only">{t("Range editing permissions")}</legend>
          <label className="flex items-start gap-2 text-xs">
            <input type="radio" name="prot-mode" checked={draft.mode === "warn"} onChange={() => setDraft({ ...draft, mode: "warn" })} className="mt-0.5" />
            <span>{t("Show a warning when editing this range")}</span>
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input type="radio" name="prot-mode" checked={draft.mode === "restrict"} onChange={() => setDraft({ ...draft, mode: "restrict" })} className="mt-0.5" />
            <span>{t("Restrict who can edit this range")}</span>
          </label>
          {draft.mode === "restrict" && (
            <div className="space-y-2 pl-5">
              <select aria-label={t("Who can edit")} value={draft.who} onChange={(e) => setDraft({ ...draft, who: e.target.value as ProtDraft["who"] })} className={selectClass}>
                <option value="me">{t("Only you")}</option>
                <option value="custom">{t("Custom")}</option>
              </select>
              {draft.who === "custom" && (
                <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
                  {members.length === 0 && <p className="p-2 text-[11px] text-muted-foreground">{t("No other members in this project.")}</p>}
                  {members.map((m) => {
                    const owner = m.id === (draft.by ?? meId);
                    const on = owner || draft.editors.includes(m.id);
                    return (
                      <label key={m.id} className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-xs", !owner && "hover:bg-muted")}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={owner}
                          onChange={(e) => setDraft({ ...draft, editors: e.target.checked ? [...draft.editors, m.id] : draft.editors.filter((x) => x !== m.id) })}
                        />
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        {owner && <span className="shrink-0 text-[10px] text-muted-foreground">{t("Owner")}</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </fieldset>
      </SidePanel>
    );
  }

  if (draft) {
    return (
      <SidePanel
        title={t("Protected sheets and ranges")}
        onClose={onClose}
        footer={<><span className="flex-1" /><button className={secondaryBtn} onClick={cancel}>{t("Cancel")}</button><button className={primaryBtn} onClick={toNext}>{t("Set permissions")}</button></>}
      >
        <div className="space-y-3 p-3">
          <input
            autoFocus
            aria-label={t("Enter a description")}
            placeholder={t("Enter a description")}
            value={draft.desc}
            onChange={(e) => setDraft({ ...draft, desc: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            className={inputClass}
          />
          <div role="tablist" className="flex border-b border-border">
            {(["range", "sheet"] as const).map((tb) => (
              <button
                key={tb}
                role="tab"
                type="button"
                aria-selected={draft.tab === tb}
                onClick={() => { setDraft({ ...draft, tab: tb }); setError(null); }}
                className={cn("-mb-px flex-1 border-b-2 px-2 py-1.5 text-xs font-semibold transition", draft.tab === tb ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
              >{tb === "range" ? t("Range") : t("Sheet")}</button>
            ))}
          </div>
          {draft.tab === "range" ? (
            <input
              aria-label={t("Range")}
              value={draft.range}
              onChange={(e) => setDraft({ ...draft, range: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={t("e.g. Sheet1!A1:B10")}
              className={cn(inputClass, "font-mono", error && "border-destructive")}
            />
          ) : (
            <div className="space-y-2">
              <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">{sheetName}</div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={draft.exceptOn} onChange={(e) => setDraft({ ...draft, exceptOn: e.target.checked, except: draft.except || selectionRange })} />
                {t("Except certain cells")}
              </label>
              {draft.exceptOn && (
                <input
                  aria-label={t("Except certain cells")}
                  value={draft.except}
                  onChange={(e) => setDraft({ ...draft, except: e.target.value })}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="A1:B5, D2:D9"
                  className={cn(inputClass, "font-mono", error && "border-destructive")}
                />
              )}
            </div>
          )}
          {error && <p className="text-[11px] text-destructive">{t(error)}</p>}
        </div>
      </SidePanel>
    );
  }

  return (
    <SidePanel title={t("Protected sheets and ranges")} onClose={onClose}>
      <div className="space-y-1 p-2">
        {protections.length === 0 && <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">{t("Nothing is protected yet. Protect a range so it isn't changed by accident, or so only some people can edit it.")}</p>}
        {protections.map((p) => (
          <div key={p.id} className="group flex items-center gap-1 rounded-lg px-1 transition hover:bg-muted/60">
            <button type="button" onClick={() => canManage && open(p)} disabled={!canManage} className="flex min-w-0 flex-1 items-start gap-2 px-1.5 py-1.5 text-left">
              {p.mode === "warn" ? <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{p.desc || label(p)}</span>
                {p.desc && <span className="block truncate font-mono text-[11px] text-muted-foreground">{label(p)}</span>}
                <span className="block truncate text-[10px] text-muted-foreground">{p.mode === "warn" ? t("Shows a warning") : t("Restricted")}</span>
              </span>
            </button>
            {canManage && (
              <button type="button" title={t("Delete")} aria-label={t("Delete")} onClick={() => onSave(protections.filter((x) => x.id !== p.id))} className="shrink-0 rounded p-1 text-muted-foreground opacity-0 pointer-coarse:opacity-100! transition hover:text-destructive group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
            )}
          </div>
        ))}
        {canManage && (
          <button type="button" onClick={() => { setDraft(blank()); setStep("what"); }} className="mt-1 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-info hover:bg-info/10">
            <Plus className="h-3.5 w-3.5" />{t("Add a sheet or range")}
          </button>
        )}
      </div>
    </SidePanel>
  );
}

/** "Heads up!" — shown before editing a range protected with "Show a warning". */
export function ProtectionWarningDialog({ onOk, onCancel }: { onOk: (dontAskAgain5min: boolean) => void; onCancel: () => void }) {
  const { t } = useLang();
  const [mute, setMute] = useState(false);
  return (
    <SheetDialog
      title={t("Heads up!")}
      onClose={onCancel}
      width={420}
      footer={<><button className={secondaryBtn} onClick={onCancel}>{t("Cancel")}</button><button className={primaryBtn} onClick={() => onOk(mute)}>{t("OK")}</button></>}
    >
      <p className="text-sm leading-relaxed text-muted-foreground">{t("You are trying to edit a protected part of this sheet. Do this only if you are sure the change is needed.")}</p>
      <label className="mt-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} />
        {t("Don't show this again for 5 minutes")}
      </label>
    </SheetDialog>
  );
}
