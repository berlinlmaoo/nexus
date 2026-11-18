import { ApiError, apiFetch } from "@/lib/nexus-api";
import { t } from "@/lib/lang";
import { useWebAppConfig } from "@/lib/meetings";

/**
 * Print to the office printer (owner, 18 Nov 2026): a Legal document or a Doc page, sent by the server to the CUPS
 * queue of the office printer. Whether this server has a printer, and its name, come from the remote config
 * (GET /api/app/config → printing); without one the Print action is hidden. Server: src/app/api/print.
 */

export type PrintKind = "legal" | "doc";
export type ColorMode = "color" | "mono";
export type PrintStatus = "queued" | "printing" | "done" | "failed";
export type PrintUser = { id: string; name: string; avatar: string | null };

export type PrintJob = {
  id: string;
  kind: PrintKind;
  refId: string;
  title: string;
  pages: number;
  copies: number;
  colorMode: ColorMode;
  status: PrintStatus;
  ippJobId: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  userId: string;
  user?: PrintUser | null;
};

export type PrintingConfig = { enabled: boolean; printerName: string | null; maxCopies: number; maxPages: number };
export type PrintLog = { jobs: PrintJob[]; nextCursor: string | null; canSeeAll: boolean; people: PrintUser[]; printing: PrintingConfig };

const OFF: PrintingConfig = { enabled: false, printerName: null, maxCopies: 5, maxPages: 50 };

/** The server's printer, or off (also while the config loads, so Print never flashes in and out). */
export function usePrinting(): PrintingConfig {
  const cfg = useWebAppConfig();
  const p = (cfg.data as { printing?: Partial<PrintingConfig> } | undefined)?.printing;
  return p?.enabled ? { ...OFF, ...p, enabled: true } : OFF;
}

export const printApi = {
  print: (body: { kind: PrintKind; id: string; copies: number; colorMode: ColorMode; version?: number }) =>
    apiFetch<{ job: PrintJob }>("/api/print", { method: "POST", body: JSON.stringify(body) }),
  job: (id: string) => apiFetch<{ job: PrintJob }>(`/api/print/jobs/${encodeURIComponent(id)}`),
  log: (q: { userId?: string; from?: string; to?: string; cursor?: string }) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return apiFetch<PrintLog>(`/api/print/jobs${qs ? `?${qs}` : ""}`);
  },
};

export const PRINT_LOG_KEY = ["print", "log"] as const;

/** Why a print was refused, in the interface language (the server's text is English, its 503 Indonesian). */
export function printErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    const code = (e.payload as { code?: string } | null)?.code;
    if (code === "PRINT_NOT_CONFIGURED") return t("The printer isn't set up on this server.");
    if (code === "PRINT_RATE_LIMIT") return t("You've printed 20 times in the last hour. Try again later.");
    if (code === "TOO_MANY_PAGES") {
      const n = /has (\d+) pages/.exec(e.message)?.[1];
      return n ? t("This file has {n} pages. One print can have at most 50 pages.", { n }) : t("Too many pages: one print can have at most 50 pages.");
    }
    if (code === "NOT_PRINTABLE") return t("This version has no file that can be printed. Only PDF and Word files print.");
    if (code === "PAGES_UNKNOWN") return t("Couldn't read the number of pages of this file.");
    if (code === "PDF_NOT_CONFIGURED") return t("PDF conversion isn't set up on this server, so this can't be printed.");
    if (code === "LEGAL_NOT_INVITED") return t("Legal is available by invitation only.");
    if (e.status === 403) return t("You can't open this, so you can't print it.");
    if (e.status === 404) return t("It no longer exists. Refresh the page.");
    if (e.status === 401) return t("Your session ended. Sign in again, then retry.");
    if (e.status >= 500) return t("Something went wrong on our side. Try again in a moment.");
    return e.message || t("Something went wrong. Try again.");
  }
  return t("No connection. Check your internet and try again.");
}

/** A failed job's reason, in the interface language where we know it. */
export function jobErrorText(error: string | null): string {
  if (!error) return t("The printer didn't say why.");
  if (/^Printer unreachable/i.test(error)) return t("The printer can't be reached. Check that it is on and connected, then try again.");
  if (/^Canceled at the printer/i.test(error)) return t("The job was canceled at the printer.");
  if (/^The printer refused the job/i.test(error)) return t("The printer refused the job ({why}).", { why: error.replace(/^The printer refused the job:\s*/i, "") });
  if (/^The printer stopped the job/i.test(error)) return t("The printer stopped the job ({why}).", { why: error.replace(/^The printer stopped the job:?\s*/i, "") || "—" });
  if (/^PDF /i.test(error) || /^Could not prepare/i.test(error)) return t("The file couldn't be prepared for printing ({why}).", { why: error });
  return error;
}

export function statusLabel(s: PrintStatus): string {
  return s === "done" ? t("Printed") : s === "failed" ? t("Print failed") : s === "printing" ? t("Printing…") : t("Queued");
}
