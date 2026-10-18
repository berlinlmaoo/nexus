import { File as FileIcon, FileArchive, FileSpreadsheet, FileText, Presentation, type LucideIcon } from "lucide-react";

/**
 * Files in chat on the web (18 Oct 2026). Mirrors the server's src/lib/chat-files.ts: the same list,
 * the same limits. Checked here first only so a wrong file is refused at once, in the person's
 * language, instead of after the upload; the server decides.
 */

export const CHAT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const CHAT_FILE_MAX_BYTES = 25 * 1024 * 1024;

const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif"];
const DOC_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "zip"];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

/** The picker's `accept`: pictures and the documents above. */
export const CHAT_ACCEPT = [...IMAGE_EXT, ...DOC_EXT].map((e) => `.${e}`).join(",") + "," + IMAGE_TYPES.join(",");

export function extensionOf(name: string | null | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i + 1).toLowerCase();
}

/** A picture by its type (what the server sniffs), or by its name when the browser gave no type. */
export function isImageFile(file: Pick<File, "name" | "type">): boolean {
  if (IMAGE_TYPES.includes(file.type)) return true;
  return !file.type && IMAGE_EXT.includes(extensionOf(file.name));
}

export type LocalFileProblem = { code: "UNSUPPORTED_TYPE" } | { code: "TOO_LARGE"; maxMb: number } | { code: "EMPTY_FILE" };

/** Why this file can't be sent, or null when it may go up. */
export function checkChatFile(file: File): LocalFileProblem | null {
  const image = isImageFile(file);
  if (!image && !DOC_EXT.includes(extensionOf(file.name))) return { code: "UNSUPPORTED_TYPE" };
  const max = image ? CHAT_IMAGE_MAX_BYTES : CHAT_FILE_MAX_BYTES;
  if (file.size > max) return { code: "TOO_LARGE", maxMb: max / (1024 * 1024) };
  if (file.size === 0) return { code: "EMPTY_FILE" };
  return null;
}

/** A message's attachment is a document (not a picture): a non-image type. Old rows have no type = picture. */
export function isDocAttachment(attachmentType: string | null | undefined): boolean {
  const t = (attachmentType ?? "").trim().toLowerCase();
  return !!t && !t.startsWith("image/");
}

/** The icon for a file, by its name first (what people recognise), then its type. */
export function fileIconFor(name: string | null | undefined, type?: string | null): LucideIcon {
  const ext = extensionOf(name);
  const m = (type ?? "").toLowerCase();
  if (["xls", "xlsx", "csv"].includes(ext) || /sheet|excel|csv/.test(m)) return FileSpreadsheet;
  if (["ppt", "pptx"].includes(ext) || /presentation|powerpoint/.test(m)) return Presentation;
  if (ext === "zip" || /zip/.test(m)) return FileArchive;
  if (["pdf", "doc", "docx", "txt"].includes(ext) || m === "application/pdf" || /word|text\//.test(m)) return FileText;
  return FileIcon;
}

/** "PDF", "DOCX" … the short label beside the size. */
export function fileTypeLabel(name: string | null | undefined): string {
  return extensionOf(name).toUpperCase();
}

/** The name to show for a document message that predates names: the end of its path. */
export function attachmentDisplayName(name: string | null | undefined, url: string | null | undefined): string {
  if (name) return name;
  const last = (url ?? "").split("?")[0].split("/").filter(Boolean).pop() ?? "";
  return last || "file";
}

/** A PDF opens in the browser's viewer; everything else downloads. */
export function openHref(url: string, name: string | null | undefined): string {
  return extensionOf(name) === "pdf" || /\.pdf$/i.test(url) ? `${url}${url.includes("?") ? "&" : "?"}inline=1` : url;
}
