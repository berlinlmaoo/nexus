import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Check, Clock, Loader2, Minus, RotateCcw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { uploadTotals, useVaultUploads, vaultUploads, type UploadEntry } from "@/lib/vault-uploads";

// ─────────────────────────────────────────────────────────────────────────────
// The Vault's upload panel (owner, 9 Oct 2026): a card in the middle of the screen with how many
// files, how many MB of how many, and each file's own progress, Cancel and Retry; Minimize folds it
// into a pill in the corner and the uploads carry on, wherever the person goes in the app. Mounted
// once in the app layout (routes/_app.tsx); the queue itself is lib/vault-uploads.ts.
//
// Not a modal: there is no backdrop and the page behind stays usable. The same panel exists on iOS
// (VaultUploadPanel.swift) with the same words.
// ─────────────────────────────────────────────────────────────────────────────

/** "12.4 MB" — one decimal from KB up, so the numbers visibly move during an upload. */
function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function Bar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function VaultUploadPanel() {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const { entries, view } = useVaultUploads();
  const totals = uploadTotals(entries);

  // The folder on screen shows what landed (the realtime "vault" ping does this too, a moment later).
  useEffect(() => vaultUploads.onLanded((_item, entry) => {
    void qc.invalidateQueries({ queryKey: ["vault"] });
    if (entry.replace) toast.success(t("“{name}” replaced", { name: entry.replace.itemName }), { description: t("Its links now show the new version.") });
  }), [qc, t]);

  // Leaving the page (reload, closing the tab) would stop the uploads: the browser asks first.
  useEffect(() => {
    if (!totals.active) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [totals.active]);

  if (view === "hidden" || entries.length === 0) return null;

  const allDone = !totals.active && totals.failed === 0 && totals.done > 0;
  const title = totals.active
    ? t(totals.total === 1 ? "Uploading {n} of {total} file" : "Uploading {n} of {total} files", { n: Math.max(1, totals.current), total: totals.total })
    : totals.failed > 0
      ? t(totals.failed === 1 ? "{n} upload failed" : "{n} uploads failed", { n: totals.failed })
      : t(totals.done === 1 ? "{n} file uploaded" : "{n} files uploaded", { n: totals.done });

  if (view === "pill") {
    return (
      <button
        type="button"
        lang={lang}
        onClick={() => vaultUploads.expand()}
        aria-label={`${t("Show uploads")}: ${title}`}
        className={cn(
          "fixed z-50 bottom-32 right-20 md:bottom-6 md:right-24 flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium shadow-pop",
          "transition-transform hover:scale-[1.03] active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          totals.failed > 0 && !totals.active && "border-destructive/60",
        )}
      >
        {totals.active ? <Upload className="h-4 w-4 text-primary" aria-hidden />
          : totals.failed > 0 ? <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />
          : <Check className="h-4 w-4 text-primary" aria-hidden />}
        <span className="tabular-nums">
          {totals.active ? `${totals.current}/${totals.total} · ${totals.pct}%` : totals.failed > 0 ? t("{n} failed", { n: totals.failed }) : `${totals.done}/${totals.total}`}
        </span>
      </button>
    );
  }

  return (
    <div
      lang={lang}
      role="region"
      aria-label={t("Uploads")}
      className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-border bg-card p-5 shadow-pop"
    >
      <div className="flex items-start gap-3">
        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-2xl", allDone ? "bg-primary/15 text-primary" : totals.failed > 0 && !totals.active ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
          {allDone ? <Check className="h-5 w-5" aria-hidden />
            : totals.failed > 0 && !totals.active ? <AlertCircle className="h-5 w-5" aria-hidden />
            : <Upload className="h-5 w-5" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold" aria-live="polite">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {t("{sent} of {total}", { sent: bytes(totals.sentBytes), total: bytes(totals.totalBytes) })} · {totals.pct}%
          </p>
        </div>
        <button
          type="button"
          onClick={() => vaultUploads.minimize()}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("Minimize")}
          title={t("Minimize")}
        >
          <Minus className="h-4 w-4" />
        </button>
        {!totals.active && (
          <button
            type="button"
            onClick={() => vaultUploads.close()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("Close")}
            title={t("Close")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <Bar pct={totals.pct} className="mt-4 h-2" />

      <ul className="mt-4 max-h-[min(18rem,45vh)] space-y-1 overflow-y-auto overscroll-contain pr-1">
        {entries.map((e) => <Row key={e.id} entry={e} />)}
      </ul>

      {totals.active && (
        <div className="mt-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => vaultUploads.cancelAll()}>{t("Cancel all")}</Button>
        </div>
      )}
    </div>
  );
}

function Row({ entry: e }: { entry: UploadEntry }) {
  const { t } = useLang();
  const pct = e.size > 0 ? Math.min(100, Math.round((e.sent / e.size) * 100)) : 0;
  const stateLabel = {
    queued: t("Queued"),
    uploading: t("Uploading"),
    done: t("Done"),
    failed: t("Failed"),
    cancelled: t("Cancelled"),
  }[e.state];
  return (
    <li className="rounded-xl px-2 py-2 hover:bg-muted/50">
      <div className="flex items-center gap-2.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center" aria-hidden>
          {e.state === "uploading" ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
            : e.state === "done" ? <Check className="h-4 w-4 text-primary" />
            : e.state === "failed" ? <AlertCircle className="h-4 w-4 text-destructive" />
            : e.state === "cancelled" ? <X className="h-4 w-4 text-muted-foreground" />
            : <Clock className="h-4 w-4 text-muted-foreground" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={e.name}>
            {e.replace ? t("{name} (new version)", { name: e.name }) : e.name}
          </p>
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {e.state === "uploading"
              ? `${t("{sent} of {total}", { sent: bytes(e.sent), total: bytes(e.size) })} · ${pct}%`
              : `${bytes(e.size)} · ${stateLabel}`}
            {e.state !== "uploading" && !e.replace ? ` · ${t("to {folder}", { folder: e.folderName })}` : ""}
          </p>
        </div>
        {(e.state === "failed" || e.state === "cancelled") && (
          <button
            type="button"
            onClick={() => vaultUploads.retry(e.id)}
            className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-primary/10 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("Retry {name}", { name: e.name })}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> {t("Try again")}
          </button>
        )}
        {(e.state === "queued" || e.state === "uploading") && (
          <button
            type="button"
            onClick={() => vaultUploads.cancel(e.id)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("Cancel {name}", { name: e.name })}
            title={t("Cancel")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {e.state === "uploading" && <Bar pct={pct} className="mt-1.5 ml-8 w-[calc(100%-2rem)]" />}
      {e.state === "failed" && e.error && (
        <p className="mt-1 ml-8 text-xs text-destructive">{t(e.error.text, e.error.vars)}</p>
      )}
    </li>
  );
}
