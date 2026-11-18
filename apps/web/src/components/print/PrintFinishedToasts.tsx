import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLang } from "@/lib/lang";
import { useRealtime } from "@/lib/realtime";
import { PRINT_LOG_KEY, printToastId } from "@/lib/print-api";

/**
 * "Your print is ready" anywhere in the web app (owner, 18 Nov 2026: "a pop-up when the print is out"). The server
 * writes a print_done / print_failed notification the moment a job ends (lib/print/service.ts finish()); its socket
 * copy turns into a toast here, whatever page is open. The Print dialog uses the same toast id, so a print watched
 * in the dialog pops once, not twice.
 */
export function PrintFinishedToasts() {
  const { socket } = useRealtime();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t, lang } = useLang();
  useEffect(() => {
    if (!socket) return;
    const on = (n: { type?: unknown; title?: unknown; message?: unknown; link?: unknown; texts?: unknown }) => {
      if (n?.type !== "print_done" && n?.type !== "print_failed") return;
      const link = typeof n.link === "string" ? n.link : "/print";
      const jobId = /[?&]job=([^&]+)/.exec(link)?.[1] ?? null;
      // The row carries both languages (notification-text.ts): show the interface's.
      const tx = (n.texts as Record<string, { title?: string; message?: string }> | null | undefined)?.[lang];
      const title = String(tx?.title ?? n.title ?? "");
      const message = String(tx?.message ?? n.message ?? "");
      const opts = { id: jobId ? printToastId(jobId) : undefined, description: message, duration: 10_000, action: { label: t("Open"), onClick: () => void navigate({ to: "/print" }) } };
      if (n.type === "print_done") toast.success(title, opts);
      else toast.error(title, opts);
      void qc.invalidateQueries({ queryKey: PRINT_LOG_KEY });
      if (jobId) void qc.invalidateQueries({ queryKey: ["print", "job", jobId] });
      void qc.invalidateQueries({ queryKey: ["print", "status"] });
    };
    socket.on("new-notification", on);
    return () => { socket.off("new-notification", on); };
  }, [socket, qc, navigate, t, lang]);
  return null;
}
