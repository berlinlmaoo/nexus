import { t } from "@/lib/lang";

/**
 * A page's title for display. A new page is stored as "Untitled" (server default, iOS/Android create
 * it that way too); in Indonesian it must read "Tanpa judul", not the stored English word (QA S-29 / B31).
 */
export function docTitle(title?: string | null): string {
  const v = (title ?? "").trim();
  return !v || v === "Untitled" ? t("Untitled") : v;
}
