import { t } from "@/lib/lang";
import type { FieldType, LegalDocType } from "@/lib/legal-api";
import { formatCount } from "@/lib/number-format";

/** Document types as people call them. The codes (SPK, PKS, …) are what the numbers print. */
export function docTypeLabel(type: string): string {
  const labels: Record<LegalDocType, string> = {
    SURAT: t("Letter"),
    SP: t("Warning letter (SP)"),
    SK: t("Power of attorney (SK)"),
    PKS: t("Cooperation agreement (PKS)"),
    SPK: t("Work agreement (SPK)"),
    NDA: t("Non-disclosure agreement (NDA)"),
    MOU: t("Memorandum of understanding (MOU)"),
    ADD: t("Addendum"),
    INVOICE: t("Invoice"),
    PJM: t("Loan of goods"),
    PGB: t("Return of goods"),
    OTHER: t("Other"),
  };
  return labels[type as LegalDocType] ?? type;
}

export function fieldTypeLabel(type: FieldType): string {
  const labels: Record<FieldType, string> = {
    text: t("Text"),
    longtext: t("Long text"),
    date: t("Date"),
    number: t("Number"),
    money: t("Amount (Rp)"),
    select: t("Choice"),
    boolean: t("Yes / no"),
    list: t("Table rows"),
  };
  return labels[type];
}

/** The field types a person may switch a scalar field between (lists and switches come from the file). */
export const SCALAR_FIELD_TYPES: FieldType[] = ["text", "longtext", "date", "number", "money", "select"];

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${formatCount(n / 1024 / 1024, 1)} MB`;
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = { DRAFT: t("Draft"), FINAL: t("Final"), SENT: t("Sent"), SIGNED: t("Signed"), VOID: t("Void") };
  return labels[status] ?? status;
}

/** Badge colours by status: a quiet draft, a green signed, a struck-through void. */
export function statusClass(status: string): string {
  switch (status) {
    case "FINAL": return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "SENT": return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "SIGNED": return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "VOID": return "bg-muted text-muted-foreground line-through";
    default: return "bg-muted text-foreground";
  }
}

export function versionKindLabel(kind: string): string {
  const labels: Record<string, string> = { GENERATED: t("Generated"), MANUAL: t("Edited"), GIDEON: "GIDEON", UPLOAD: t("Uploaded"), RESTORE: t("Restored") };
  return labels[kind] ?? kind;
}

/**
 * "2026-09-30" → "30 Sep" in the interface language; the year only when it is not this one ("30 Sep 2025")
 * (UI tour run 11, WM-12/WD-6). "This year" is the WIB year, the office's.
 */
export function fmtDay(day: string | null | undefined, lang: "id" | "en"): string {
  if (!day) return "—";
  const key = day.slice(0, 10);
  const d = new Date(`${key}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  const thisYear = new Date(Date.now() + 7 * 3600_000).getUTCFullYear();
  const sameYear = d.getUTCFullYear() === thisYear;
  return d.toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}
