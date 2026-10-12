import { AlignLeft, AtSign, Calendar, CheckSquare, CircleDot, Hash, Link2, ListChecks, Paperclip, Phone, Type, Wallet } from "lucide-react";
import type { NexusFormBranding, NexusFormField } from "@/lib/nexus-api";

/**
 * The form model shared by the builder (FormStudio), the respondent page (/f/:id) and its preview.
 * The stored field JSON is unchanged — the released iOS/Android apps read the same objects — so a
 * "question kind" here is a builder-side view over `type` + `numberFormat`.
 */

export type FCond = { fieldId: string; operator: string; value: string };
export type FRule = { id: string; operator: string; value: string; action: string; targetTaskListId?: string; targetUserId?: string; targetUserIds?: string[]; targetCustomFieldId?: string; targetValue?: string };
export type FMapping = { target?: string; customFieldId?: string };
export type RichField = NexusFormField & {
  name?: string;
  showIf?: FCond | null;
  routingRules?: FRule[];
  mapping?: FMapping | null;
  attachmentEnabled?: boolean;
  autofill?: "name" | "email";
  numberFormat?: "currency-idr";
};

/** A question kind in the type menu. `rupiah` is a number question with the Rupiah format. */
export type QuestionKind = "text" | "textarea" | "dropdown" | "multi_select" | "checkbox" | "number" | "rupiah" | "date" | "email" | "phone" | "url" | "file";

export const QUESTION_KINDS: { kind: QuestionKind; label: string; hint: string; icon: typeof Type; group: "basic" | "specific"; keywords: string }[] = [
  { kind: "text", label: "Short answer", hint: "One line of text", icon: Type, group: "basic", keywords: "text short teks singkat" },
  { kind: "textarea", label: "Long answer", hint: "Several lines", icon: AlignLeft, group: "basic", keywords: "text long paragraph textarea panjang" },
  { kind: "dropdown", label: "Single choice", hint: "Pick one option", icon: CircleDot, group: "basic", keywords: "select dropdown radio pilihan satu" },
  { kind: "multi_select", label: "Multiple choice", hint: "Pick any number of options", icon: ListChecks, group: "basic", keywords: "multi checkbox pilihan ganda" },
  { kind: "checkbox", label: "Checkbox", hint: "A single yes / no tick", icon: CheckSquare, group: "basic", keywords: "check yes no centang" },
  { kind: "number", label: "Number", hint: "Digits only", icon: Hash, group: "specific", keywords: "number angka" },
  { kind: "rupiah", label: "Rupiah amount", hint: "Rp 1.500.000", icon: Wallet, group: "specific", keywords: "money currency idr rupiah harga uang" },
  { kind: "date", label: "Date", hint: "A day from a calendar", icon: Calendar, group: "specific", keywords: "date tanggal" },
  { kind: "email", label: "Email", hint: "name@company.com", icon: AtSign, group: "specific", keywords: "email mail surel" },
  { kind: "phone", label: "Phone", hint: "A phone number", icon: Phone, group: "specific", keywords: "phone telepon hp wa" },
  { kind: "url", label: "Link", hint: "A web address", icon: Link2, group: "specific", keywords: "url link tautan web" },
  { kind: "file", label: "File upload", hint: "One or more files", icon: Paperclip, group: "specific", keywords: "file upload attachment lampiran foto" },
];

export function kindOf(f: Pick<RichField, "type" | "numberFormat">): QuestionKind {
  if (f.type === "number" && f.numberFormat === "currency-idr") return "rupiah";
  if (f.type === "select") return "dropdown";
  return (QUESTION_KINDS.find((k) => k.kind === f.type)?.kind ?? "text") as QuestionKind;
}
export const kindMeta = (k: QuestionKind) => QUESTION_KINDS.find((x) => x.kind === k) ?? QUESTION_KINDS[0];
export const hasOptions = (f: Pick<RichField, "type">) => f.type === "dropdown" || f.type === "multi_select" || f.type === "select";

/** Turns a field into another kind, keeping what still applies (options, mapping, logic). */
export function withKind(f: RichField, kind: QuestionKind): RichField {
  const type = kind === "rupiah" ? "number" : kind;
  const next: RichField = { ...f, type };
  if (kind === "rupiah") next.numberFormat = "currency-idr";
  else delete next.numberFormat;
  if ((type === "dropdown" || type === "multi_select") && !Array.isArray(next.options)) next.options = optionsOf(f).length ? optionsOf(f) : [""];
  if (type !== "dropdown") delete next.display;
  if (type !== "text" && type !== "email") delete next.autofill;
  if (type === "file") delete next.attachmentEnabled;
  return next;
}

export function optionsOf(f: Pick<RichField, "options">): string[] {
  if (Array.isArray(f.options)) return f.options.map(String);
  if (f.options && typeof f.options === "object" && Array.isArray(f.options.choices)) return f.options.choices.map(String);
  return [];
}
export const fieldTitle = (f: Pick<RichField, "name" | "label">) => (f.name || f.label || "").trim();

let counter = 0;
export function newFieldId() {
  counter += 1;
  return `field_${Date.now()}_${counter}`;
}
export function newQuestion(kind: QuestionKind = "text"): RichField {
  return withKind({ id: newFieldId(), name: "", label: "", type: "text", required: false }, kind);
}

/** Client-side branching: mirrors submit/route.ts evaluateCondition. */
export function evalCond(cond: FCond | null | undefined, values: Record<string, unknown>): boolean {
  if (!cond) return true;
  const raw = values[cond.fieldId];
  const list = Array.isArray(raw) ? raw.map(String) : [raw == null ? "" : String(raw)];
  const joined = list.join(", ");
  const exp = String(cond.value ?? "");
  switch (cond.operator) {
    case "equals": return list.includes(exp);
    case "not_equals": return !list.includes(exp);
    case "contains": return joined.toLowerCase().includes(exp.toLowerCase());
    case "is_empty": return !joined;
    case "is_not_empty": return !!joined;
    default: return true;
  }
}
export function isFilled(v: unknown) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== "" && v !== false;
}

export const OPERATORS = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];
export const needsValue = (op: string) => op !== "is_empty" && op !== "is_not_empty";

export const MAPPING_TARGETS = [
  { value: "none", label: "Nothing (answer stays in the description)" },
  { value: "task_title", label: "Task title" },
  { value: "task_description", label: "Task description" },
  { value: "task_due_date", label: "Due date" },
  { value: "task_status", label: "Status" },
  { value: "task_priority", label: "Priority" },
  { value: "task_list", label: "Section" },
  { value: "custom_field", label: "A project field" },
];
export const ROUTING_ACTIONS = [
  { value: "assign_user", label: "Assign to" },
  { value: "set_field", label: "Set field" },
  { value: "set_task_list", label: "Move to section" },
];

/** Cover presets: drawn with CSS, nothing to upload. Stored as branding.cover = "preset:<key>". */
export const COVER_PRESETS: { key: string; label: string; css: string }[] = [
  { key: "paper", label: "Paper", css: "linear-gradient(135deg, #f4f1ea 0%, #e7e1d5 100%)" },
  { key: "mist", label: "Mist", css: "linear-gradient(135deg, #e8edf3 0%, #d5dee8 100%)" },
  { key: "lilac", label: "Lilac", css: "linear-gradient(135deg, #ece8fd 0%, #d9d1fb 100%)" },
  { key: "mint", label: "Mint", css: "linear-gradient(135deg, #e3f4ec 0%, #c9eadb 100%)" },
  { key: "peach", label: "Peach", css: "linear-gradient(135deg, #fdebe1 0%, #f9d3c0 100%)" },
  { key: "sky", label: "Sky", css: "linear-gradient(120deg, #8ec5fc 0%, #e0c3fc 100%)" },
  { key: "dusk", label: "Dusk", css: "linear-gradient(120deg, #5b4bc4 0%, #9d6bd6 55%, #e7a3b4 100%)" },
  { key: "forest", label: "Forest", css: "linear-gradient(120deg, #1f4e3d 0%, #3f7d5c 100%)" },
  { key: "ink", label: "Ink", css: "linear-gradient(120deg, #1d1f24 0%, #3a3e48 100%)" },
];
export function coverCss(cover: string | undefined | null): string | null {
  if (!cover) return null;
  if (cover.startsWith("preset:")) return COVER_PRESETS.find((p) => `preset:${p.key}` === cover)?.css ?? null;
  return `center / cover no-repeat url("${cover.replace(/"/g, "%22")}")`;
}

export const ICON_CHOICES = ["📝", "📋", "🧾", "💸", "💰", "🧮", "📦", "🛒", "🎟️", "📅", "🗓️", "⏰", "✈️", "🚗", "🏢", "🏠", "🎤", "🎬", "🎨", "📸", "🎧", "💡", "🛠️", "🧰", "📣", "📨", "📞", "🤝", "✅", "❓", "🔒", "⭐", "🔥", "🌱", "🍽️", "☕", "🎓", "🩺", "⚖️", "🧑‍💻"];

/** Draft form state the builder edits and autosaves. */
export type FormDraft = {
  name: string;
  description: string;
  fields: RichField[];
  isPublic: boolean;
  requireAuth: boolean;
  accessSchedule: Record<string, unknown> | null;
  branding: NexusFormBranding | null;
  settings: Record<string, unknown> | null;
};

/** The fields as saved: option rows trimmed, blank rows dropped (the editor keeps one for typing). */
export function cleanFields(fields: RichField[]): RichField[] {
  return fields.map((f) => (Array.isArray(f.options) ? { ...f, options: (f.options as unknown[]).map(String).map((s) => s.trim()).filter(Boolean) } : f));
}
