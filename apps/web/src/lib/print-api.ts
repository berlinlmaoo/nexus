import { ApiError, apiFetch } from "@/lib/nexus-api";
import { getLang, t } from "@/lib/lang";
import { useQuery } from "@tanstack/react-query";
import { useWebAppConfig } from "@/lib/meetings";

/**
 * Print to the office printer (owner, 18 Nov 2026): a Legal document or a Doc page, sent by the server to the CUPS
 * queue of the office printer. Whether this server has a printer, and its name, come from the remote config
 * (GET /api/app/config → printing); without one the Print action is hidden. Server: src/app/api/print.
 */

export type PrintKind = "legal" | "doc" | "upload";
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

export type PrintUpload = { id: string; fileName: string; pages: number; size: number; createdAt: string; expiresAt: string };

/** Files the Print menu takes (the server checks again, by name and content). */
export const PRINT_UPLOAD_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png";
export const PRINT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * "1-3,5" against the file's pages, the server's rule (src/lib/print/page-ranges.ts): null = every page, a number =
 * how many pages it prints, a string = what is wrong (already in the interface language).
 */
export function pageRangeCount(text: string, pages: number): number | string | null {
  const raw = text.replace(/\s+/g, "");
  if (!raw) return null;
  if (raw.length > 200 || !/^\d+(-\d+)?(,\d+(-\d+)?)*,?$/.test(raw)) return t("Write pages like 1-3,5");
  const seen = new Set<number>();
  for (const piece of raw.split(",").filter(Boolean)) {
    const [a, b] = piece.split("-").map(Number);
    const hi = b ?? a;
    if (a < 1 || hi < a) return t("Write pages like 1-3,5");
    if (hi > pages) return t("This file has {n} pages.", { n: pages });
    for (let p = a; p <= hi; p++) seen.add(p);
  }
  return seen.size;
}

/** The pages "1-3,5" prints, as a set; null = every page (empty or not valid yet). */
export function pageSet(text: string, pages: number): Set<number> | null {
  if (typeof pageRangeCount(text, pages) !== "number") return null;
  const out = new Set<number>();
  for (const piece of text.replace(/\s+/g, "").split(",").filter(Boolean)) {
    const [a, b] = piece.split("-").map(Number);
    for (let p = a; p <= (b ?? a); p++) out.add(p);
  }
  return out;
}

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
  print: (body: { kind: PrintKind; id: string; copies: number; colorMode: ColorMode; version?: number; pageRanges?: string }) =>
    apiFetch<{ job: PrintJob }>("/api/print", { method: "POST", body: JSON.stringify(body) }),
  /** Print menu: the file goes up, comes back as its page count (the server converts it to PDF). */
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<{ upload: PrintUpload }>("/api/print/uploads", { method: "POST", body: form });
  },
  discard: (id: string) => apiFetch<{ ok: boolean }>(`/api/print/uploads/${encodeURIComponent(id)}`, { method: "DELETE" }),
  job: (id: string) => apiFetch<{ job: PrintJob }>(`/api/print/jobs/${encodeURIComponent(id)}`),
  log: (q: { userId?: string; from?: string; to?: string; cursor?: string; limit?: string }) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return apiFetch<PrintLog>(`/api/print/jobs${qs ? `?${qs}` : ""}`);
  },
};

export const PRINT_LOG_KEY = ["print", "log"] as const;

/** The exact PDF a print of this item sends (GET /api/print/preview); errors come back as JSON. */
export function previewUrl(kind: PrintKind, id: string, version?: number): string {
  const sp = new URLSearchParams({ kind, id });
  if (version) sp.set("version", String(version));
  return `/api/print/preview?${sp.toString()}`;
}

/** The preview PDF's bytes, or an ApiError with the server's code (same codes as printing). */
export async function fetchPreview(kind: PrintKind, id: string, version?: number): Promise<ArrayBuffer> {
  const res = await fetch(previewUrl(kind, id, version), { credentials: "include", headers: { "Accept-Language": getLang(), "X-Nexus-Client": "web/1" } });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string; code?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body);
  }
  return res.arrayBuffer();
}

// ---------------------------------------------------------------- printer status (GET /api/print/status)

export type PrinterState = "idle" | "printing" | "stopped" | "error" | "disconnected" | "unreachable";
export type QueueJob = {
  position: number;
  state: "printing" | "waiting" | "held" | "stopped" | "stalled";
  who: { id: string; name: string } | null;
  mine: boolean;
  title?: string;
  nexusJobId?: string;
};
export type InkLevel = { name: string; level: number | null; color: string | null };
export type PrinterStatus = {
  reachable: boolean;
  /** "printer" = the state came from the printer itself; "cups" = from the print server only. */
  source?: "printer" | "cups";
  /** Ink levels, when the printer reports them (the L3250's ink tanks don't). */
  inks?: InkLevel[];
  state: PrinterState;
  reasons: Array<{ keyword: string; severity: "error" | "warning" | "report" }>;
  message: string | null;
  acceptingJobs: boolean;
  waiting: number;
  jobs: QueueJob[];
  checkedAt: string;
};

/** The office printer right now, every 5 s while the page is in front (the server asks CUPS at most every 3 s). */
export function usePrinterStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["print", "status"],
    queryFn: () => apiFetch<PrinterStatus>("/api/print/status"),
    enabled,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/** A printer reason keyword in words. Unknown ones show as they are. */
export function reasonText(keyword: string): string {
  switch (keyword) {
    case "media-empty": case "media-needed": return t("Out of paper");
    case "media-jam": return t("Paper jam");
    case "marker-supply-empty": case "toner-empty": return t("Out of ink");
    case "marker-supply-low": case "toner-low": return t("Ink is running low");
    case "door-open": case "cover-open": return t("A printer cover is open");
    case "paused": return t("The printer is paused");
    case "offline": case "connecting-to-device": case "timed-out": return t("The printer can't be reached");
    default: return keyword.replace(/-/g, " ");
  }
}

/** The sentence for a printer the server can't reach (off, or out of the office WiFi since 18 Nov 2026). */
export function disconnectedText(): string {
  return t("The printer can't be reached (off or out of the office WiFi). Your print comes out as soon as it's back.");
}

/** One toast per print job, wherever it is raised from (the dialog or the global listener). */
export const printToastId = (jobId: string) => `print-job-${jobId}`;

/** Why a print was refused, in the interface language (the server's text is English, its 503 Indonesian). */
export function printErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    const code = (e.payload as { code?: string } | null)?.code;
    if (code === "PRINT_NOT_CONFIGURED") return t("The printer isn't set up on this server.");
    if (code === "PRINT_RATE_LIMIT") return t("You've printed 20 times in the last hour. Try again later.");
    if (code === "TOO_MANY_PAGES") {
      const sum = /add up to (\d+)/.exec(e.message)?.[1];
      if (sum) return t("These pages add up to {n}. One print can have at most 50 pages.", { n: sum });
      const n = /has (\d+) pages/.exec(e.message)?.[1];
      return n ? t("This file has {n} pages. One print can have at most 50 pages.", { n }) : t("Too many pages: one print can have at most 50 pages.");
    }
    if (code === "NOT_PRINTABLE") return t("This version has no file that can be printed. Only PDF and Word files print.");
    if (code === "PAGES_UNKNOWN") return t("Couldn't read the number of pages of this file.");
    if (code === "PDF_NOT_CONFIGURED") return t("PDF conversion isn't set up on this server, so this can't be printed.");
    if (code === "UPLOAD_GONE") return t("This upload has expired. Upload the file again.");
    if (code === "BAD_RANGE") return t("Write pages like 1-3,5");
    if (code === "OUT_OF_RANGE") return e.message.replace(/^This file has (\d+) pages$/, (_m, n) => t("This file has {n} pages.", { n }));
    if (code === "UNSUPPORTED_TYPE") return /HEIC/i.test(e.message) ? t("HEIC photos can't be printed. Save the photo as JPG or PNG first.") : /match/i.test(e.message) ? t("The file doesn't match its name (it may be damaged or renamed).") : t("This kind of file can't be printed. Use PDF, Word, Excel, PowerPoint, JPG or PNG.");
    if (code === "TOO_LARGE") return t("The file is larger than 25 MB");
    if (code === "CONVERSION_FAILED") return t("This file couldn't be converted for printing. Try saving it as PDF first.");
    if (code === "NOT_A_MEMBER") return t("Printing is for members of the company workspace.");
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
