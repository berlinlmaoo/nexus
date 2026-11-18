import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, FileText, Loader2, Printer, RotateCcw, Upload, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageBody } from "@/components/PageLayout";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { PrintDialog } from "@/components/print/PrintDialog";
import { PrinterStatusPanel } from "@/components/print/PrinterStatusPanel";
import { RecentPrints } from "@/components/settings/PrintLogSection";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { useWebAppConfig } from "@/lib/meetings";
import {
  PRINT_UPLOAD_ACCEPT, PRINT_UPLOAD_MAX_BYTES, printApi, printErrorText, usePrinting, type PrintJob, type PrintUpload,
} from "@/lib/print-api";

export const Route = createFileRoute("/_app/print")({ component: PrintPage });

/**
 * Print menu (owner, 18 Nov 2026): any member of the company sends any file to the office printer. Choose a file →
 * the server turns it into a PDF and counts its pages → the Print dialog (copies, Color / Black & white, pages) →
 * status. The server keeps the file only until its print ends (at most 1 hour); a file chosen and then dropped is
 * deleted right away. Settings › Print log keeps the name, pages and result.
 */

const OK_EXT = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png)$/i;

function sizeText(bytes: number, locale: string) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toLocaleString(locale, { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(locale)} KB`;
}

function PrintPage() {
  const { t, tn, locale } = useLang();
  const cfg = useWebAppConfig();
  const printing = usePrinting();
  const [upload, setUpload] = useState<PrintUpload | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ended, setEnded] = useState<PrintJob | null>(null);
  const [sent, setSent] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  // A file chosen but never printed is deleted when the page goes away (a sent one is deleted by the server
  // when its job ends).
  const pending = useRef<string | null>(null);
  pending.current = upload && !sent ? upload.id : null;
  useEffect(() => {
    const drop = () => {
      const id = pending.current;
      pending.current = null;
      if (id) void fetch(`/api/print/uploads/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include", keepalive: true, headers: { "X-Nexus-Client": "web/1" } }).catch(() => {});
    };
    // Leaving the page inside the app, and closing or reloading the tab.
    window.addEventListener("pagehide", drop);
    return () => { window.removeEventListener("pagehide", drop); drop(); };
  }, []);

  const send = useMutation({
    mutationFn: (file: File) => printApi.upload(file),
    onSuccess: ({ upload: u }) => { setUpload(u); setEnded(null); setSent(false); setDialogOpen(true); },
    onError: (e) => { setPickedName(null); toast.error(t("Couldn't prepare the file"), { description: printErrorText(e) }); },
  });

  const reset = useCallback(() => {
    if (upload && !sent) void printApi.discard(upload.id).catch(() => {});
    setUpload(null); setPickedName(null); setEnded(null); setSent(false); setDialogOpen(false);
  }, [upload, sent]);

  const choose = (file: File | undefined | null) => {
    if (!file) return;
    if (!OK_EXT.test(file.name)) {
      toast.error(t("Couldn't prepare the file"), { description: /\.(heic|heif)$/i.test(file.name) ? t("HEIC photos can't be printed. Save the photo as JPG or PNG first.") : t("This kind of file can't be printed. Use PDF, Word, Excel, PowerPoint, JPG or PNG.") });
      return;
    }
    if (file.size > PRINT_UPLOAD_MAX_BYTES) { toast.error(t("Couldn't prepare the file"), { description: t("The file is larger than 25 MB") }); return; }
    if (upload && !sent) void printApi.discard(upload.id).catch(() => {});
    setUpload(null); setEnded(null); setSent(false);
    setPickedName(file.name);
    send.mutate(file);
  };

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files?.[0]); };
  const picker = (
    <input ref={input} type="file" accept={PRINT_UPLOAD_ACCEPT} className="hidden" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
  );

  return (
    <div>
      <PageHeader title={t("Print")} subtitle={t("Print any file on the office printer")} />
      {/* Desktop: the file on the left, the printer and recent prints on the right; a phone stacks them in that order. */}
      <PageBody className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="min-w-0 space-y-4">
        {picker}
        {cfg.isPending ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
        ) : !printing.enabled ? (
          <div className="rounded-xl border border-border bg-card shadow-soft">
            <EmptyState icon={Printer} title={t("The printer isn't set up on this server.")} message={t("Ask the person who runs NEXUS to connect the office printer. Until then, download the file and print it from your computer.")} />
          </div>
        ) : send.isPending ? (
          <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-border bg-card p-5 shadow-soft">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
            <div className="min-w-0">
              <div className="text-sm font-medium">{t("Preparing the file…")}</div>
              <div className="truncate text-xs text-muted-foreground">{pickedName}</div>
            </div>
          </div>
        ) : upload ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium [overflow-wrap:anywhere]">{upload.fileName}</div>
                <div className="text-xs text-muted-foreground">{tn(upload.pages, "{n} page", "{n} pages")} · {sizeText(upload.size, locale)}</div>
              </div>
            </div>
            {ended && (
              <div className={cn("flex items-center gap-2 text-sm", ended.status === "done" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
                {ended.status === "done" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {ended.status === "done" ? t("Printed. The file has been deleted from the server.") : t("Print failed. The file has been deleted from the server.")}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {!sent && <Button className="gap-1.5" onClick={() => setDialogOpen(true)}><Printer className="h-4 w-4" /> {t("Print")}</Button>}
              <Button variant={sent ? "default" : "outline"} className="gap-1.5" onClick={() => { reset(); input.current?.click(); }}>
                {sent ? <RotateCcw className="h-4 w-4" /> : <Upload className="h-4 w-4" />} {sent ? t("Print another file") : t("Choose another file")}
              </Button>
            </div>
          </div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn("rounded-xl border border-dashed bg-card shadow-soft transition-colors", dragging ? "border-primary bg-primary/5" : "border-border")}
          >
            <EmptyState icon={Upload} title={t("Choose a file to print")}
              message={t("PDF, Word, Excel, PowerPoint, JPG or PNG, up to 25 MB. The file is deleted from the server once it's printed.")}
              action={<Button className="gap-1.5" onClick={() => input.current?.click()}><Upload className="h-4 w-4" /> {t("Choose a file")}</Button>} />
          </div>
        )}
        </div>
        {printing.enabled && (
          <aside className="min-w-0 space-y-6 lg:sticky lg:top-[calc(var(--page-sticky-top,0px)+2rem)]">
            <PrinterStatusPanel />
            <RecentPrints />
          </aside>
        )}
      </PageBody>
      {upload && printing.enabled && (
        <PrintDialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); }} kind="upload" id={upload.id} title={upload.fileName} pages={upload.pages}
          onSent={() => setSent(true)} onEnded={setEnded} />
      )}
    </div>
  );
}
