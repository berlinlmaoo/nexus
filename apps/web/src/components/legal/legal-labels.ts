import { t } from "@/lib/lang";
import type { FieldType, LegalDocType } from "@/lib/legal-api";

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
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
