import { parsePrinterUrl } from "@/lib/print/ipp"

/**
 * Where prints go (owner, 18 Nov 2026): PRINT_IPP_URL, the CUPS queue of the office printer, e.g.
 * ipp://192.168.223.114:631/printers/Epson_L3250 (Epson L3250, A4, VM infra). Unset or unreadable = printing is
 * off on this server: the API answers 503 and the apps hide Print (GET /api/app/config → printing.enabled).
 * PRINT_PRINTER_NAME (optional) is the name people see; default = the queue name with spaces ("Epson L3250").
 */

export const PRINT_LIMITS = {
  /** Copies per job. */
  maxCopies: 5,
  /** Pages of one copy. */
  maxPages: 50,
  /** Jobs per person per rolling hour. */
  jobsPerHour: 20,
} as const

export const PRINT_NOT_CONFIGURED = "Printer belum diatur di server ini"

export type PrinterConfig = { http: string; printerUri: string; name: string }

export function printerConfig(env: Record<string, string | undefined> = process.env): PrinterConfig | null {
  const parsed = parsePrinterUrl(env.PRINT_IPP_URL)
  if (!parsed) return null
  const name = env.PRINT_PRINTER_NAME?.trim() || parsed.queue.replace(/[_-]+/g, " ").trim() || "Printer"
  return { http: parsed.http, printerUri: parsed.printerUri, name }
}

/** What /api/app/config tells the apps (no address: the route is public). */
export function printingStatus(env: Record<string, string | undefined> = process.env): { enabled: boolean; printerName: string | null; maxCopies: number; maxPages: number } {
  const cfg = printerConfig(env)
  return { enabled: !!cfg, printerName: cfg?.name ?? null, maxCopies: PRINT_LIMITS.maxCopies, maxPages: PRINT_LIMITS.maxPages }
}

/**
 * The printer itself, for status only (owner, 18 Nov 2026): CUPS says "idle" whenever it has no job and never asks the
 * printer, so a printer that is switched off still read "Ready". PRINT_DEVICE_IPP_URL points at the printer's own IPP
 * endpoint — on the office network a forwarder on VM infra (192.168.223.114:8631 → EPSONE0F00A.local:631, nexus-prod
 * only), as ipps://192.168.223.114:8631/ipp/print (the Epson wants TLS) + PRINT_DEVICE_HOST. Unset = status from CUPS
 * alone, as before. Jobs never go there: printing stays on PRINT_IPP_URL (CUPS).
 */
export function printerDeviceConfig(env: Record<string, string | undefined> = process.env): { http: string; printerUri: string; hostHeader: string | null } | null {
  const parsed = parsePrinterUrl(env.PRINT_DEVICE_IPP_URL)
  if (!parsed) return null
  // PRINT_DEVICE_HOST: the printer's own name:port ("EPSONE0F00A.local:631"). The Epson refuses a request whose Host
  // header (and printer-uri) name the forwarder instead of itself.
  const host = env.PRINT_DEVICE_HOST?.trim() || null
  const path = new URL(parsed.printerUri.replace(/^ipps?:/, "http:")).pathname
  return { http: parsed.http, printerUri: host ? `ipps://${host}${path}` : parsed.printerUri, hostHeader: host }
}
