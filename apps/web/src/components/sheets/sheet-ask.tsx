import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/nexus-api";
import { getLang, t as trT, useLang } from "@/lib/lang";
import { SheetDialog, dangerBtn, inputClass, primaryBtn, secondaryBtn } from "./sheet-shell";

/**
 * The spreadsheet's own small dialogs and notices, instead of the browser's alert / confirm / prompt
 * (bughunt 12 Oct 2026, S-BUG-22): those are unstyled, English-only on some browsers, block the page,
 * and put the destructive choice on the default button.
 *
 *   askText({ title, initial })            → Promise<string | null>   (a one-field prompt)
 *   askChoice({ title, body, choices })    → Promise<choice id | null>
 *   notify(text) / notifyError(err, fb)    → a toast (errors keep the server's reason, translated)
 *
 * <SheetAskHost /> is mounted once by the sheet page and renders whatever is being asked.
 */
type Choice = { id: string; label: string; tone?: "primary" | "danger" | "secondary" };
type Ask =
  | { kind: "text"; title: string; label?: string; initial: string; placeholder?: string; ok?: string; validate?: (v: string) => string | null; resolve: (v: string | null) => void }
  | { kind: "choice"; title: string; body?: ReactNode; choices: Choice[]; resolve: (v: string | null) => void };

const listeners = new Set<(a: Ask | null) => void>();
let current: Ask | null = null;
const emit = () => listeners.forEach((l) => l(current));

function open(a: Ask) {
  // Only one at a time: a second ask answers the first with "cancelled".
  if (current) current.resolve(null);
  current = a;
  emit();
}
function close(value: string | null) {
  const a = current;
  current = null;
  emit();
  a?.resolve(value);
}

export function askText(o: { title: string; label?: string; initial?: string; placeholder?: string; ok?: string; validate?: (v: string) => string | null }): Promise<string | null> {
  return new Promise((resolve) => open({ kind: "text", initial: "", ...o, resolve }));
}

export function askChoice(o: { title: string; body?: ReactNode; choices: Choice[] }): Promise<string | null> {
  return new Promise((resolve) => open({ kind: "choice", ...o, resolve }));
}

/** Server error text is Indonesian; in English the known ones are translated (anything else as it came). */
const SERVER_EN: Record<string, string> = {
  "Kamu nggak punya akses ke sheet ini.": "You don't have access to this sheet.",
  "Sheet utama nggak bisa dihapus.": "The first sheet can't be deleted.",
  "Sheet harus punya minimal satu kolom.": "A sheet needs at least one column.",
  "Cuma lead/manager ke atas yang boleh hapus kolom.": "Only leads and managers can delete columns.",
  "Filenya nggak kebaca — pastikan .csv atau .xlsx yang valid.": "The file couldn't be read. Make sure it's a valid .csv or .xlsx.",
  "Filenya kosong.": "The file is empty.",
  "File maksimal 10MB.": "Files can be up to 10 MB.",
  "File Excel-nya nggak ada sheet-nya.": "The Excel file has no sheets.",
  "Ada baris yang nggak ketemu.": "Some rows no longer exist. Reload the sheet.",
  "Barisnya nggak ketemu.": "That row no longer exists.",
  "Kolomnya nggak ketemu.": "That column no longer exists.",
  "Sheet-nya nggak ketemu.": "That sheet no longer exists.",
  "Nama sheet nggak boleh kosong.": "The sheet name can't be empty.",
  "Internal server error": "Something went wrong on the server.",
  Unauthorized: "You're signed out. Sign in again.",
  Forbidden: "You don't have access to this.",
};
const SERVER_ID: Record<string, string> = {
  "Internal server error": "Ada masalah di server.",
  Unauthorized: "Kamu sudah keluar. Masuk lagi.",
  Forbidden: "Kamu nggak punya akses ke sini.",
};

/** A network failure (offline, DNS, the server restarting), as opposed to the server saying no. */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof ApiError) return [0, 408, 429, 502, 503, 504].includes(e.status);
  return e instanceof TypeError || (e instanceof Error && /fetch|network|load failed/i.test(e.message));
}

export function errorText(e: unknown, fallback: string): string {
  if (isNetworkError(e)) return trT("You're offline or the server can't be reached.");
  const raw = e instanceof Error ? e.message : "";
  if (!raw) return fallback;
  const table = getLang() === "en" ? SERVER_EN : SERVER_ID;
  return table[raw] ?? raw;
}

export function notify(text: string, opts?: { action?: { label: string; run: () => void }; duration?: number }) {
  toast(text, {
    ...(opts?.action ? { action: { label: opts.action.label, onClick: opts.action.run } } : {}),
    ...(opts?.duration ? { duration: opts.duration } : {}),
  });
}
export function notifyError(e: unknown, fallback: string) {
  toast.error(errorText(e, fallback));
}

export function SheetAskHost() {
  const [ask, setAsk] = useState<Ask | null>(current);
  useEffect(() => {
    listeners.add(setAsk);
    return () => { listeners.delete(setAsk); };
  }, []);
  // Whoever had focus (usually the grid) gets it back when the dialog closes.
  const prev = useRef<Element | null>(null);
  useEffect(() => {
    if (ask) { prev.current = document.activeElement; return; }
    const el = prev.current as HTMLElement | null;
    prev.current = null;
    if (el && el.isConnected && typeof el.focus === "function") el.focus({ preventScroll: true });
  }, [ask]);
  if (!ask) return null;
  return ask.kind === "text" ? <TextAsk key={ask.title} ask={ask} /> : <ChoiceAsk ask={ask} />;
}

function TextAsk({ ask }: { ask: Extract<Ask, { kind: "text" }> }) {
  const { t } = useLang();
  const [v, setV] = useState(ask.initial);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { requestAnimationFrame(() => { ref.current?.focus(); ref.current?.select(); }); }, []);
  const submit = () => {
    const bad = ask.validate?.(v) ?? null;
    if (bad) { setErr(bad); return; }
    close(v);
  };
  return (
    <SheetDialog
      title={ask.title}
      onClose={() => close(null)}
      width={400}
      footer={<><button className={secondaryBtn} onClick={() => close(null)}>{t("Cancel")}</button><button className={primaryBtn} onClick={submit}>{ask.ok ?? t("OK")}</button></>}
    >
      {ask.label && <label htmlFor="sheet-ask-input" className="mb-1 block text-xs text-muted-foreground">{ask.label}</label>}
      <input
        id="sheet-ask-input"
        ref={ref}
        value={v}
        placeholder={ask.placeholder}
        onChange={(e) => { setV(e.target.value); setErr(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        aria-invalid={Boolean(err)}
        className={inputClass + " h-9 text-sm"}
      />
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </SheetDialog>
  );
}

function ChoiceAsk({ ask }: { ask: Extract<Ask, { kind: "choice" }> }) {
  return (
    <SheetDialog
      title={ask.title}
      onClose={() => close(null)}
      width={420}
      footer={<>{ask.choices.map((c) => (
        <button key={c.id} className={c.tone === "danger" ? dangerBtn : c.tone === "primary" ? primaryBtn : secondaryBtn} onClick={() => close(c.id)}>{c.label}</button>
      ))}</>}
    >
      {typeof ask.body === "string" ? <p className="whitespace-pre-line text-sm">{ask.body}</p> : ask.body}
    </SheetDialog>
  );
}
