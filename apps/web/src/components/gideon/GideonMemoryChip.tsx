import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Brain, Check, Loader2, X } from "lucide-react";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { toastFailure } from "@/lib/failure";
import { GIDEON_MEMORY_KEY, deleteGideonMemory, updateGideonMemory } from "@/lib/gideon-ai";
import type { GideonMemory } from "@/lib/gideon";

/**
 * GIDEON Memory under an answer (19 Oct 2026): a suggestion with Save / Don't save, or a quiet "Saved to GIDEON
 * Memory" line. Small on purpose (not a proposal card): saving a memory is low-risk and always undoable in Settings.
 */
export function GideonMemoryChip({ memory, onChange }: { memory: GideonMemory; onChange: (m: GideonMemory) => void }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"save" | "skip" | null>(null);
  const settle = (m: GideonMemory) => { onChange(m); void qc.invalidateQueries({ queryKey: GIDEON_MEMORY_KEY }); };
  const save = async () => {
    setBusy("save");
    try { settle((await updateGideonMemory(memory.id, { status: "ACTIVE" })).memory); }
    catch (e) { toastFailure(t("Couldn't save to GIDEON Memory"), e); }
    finally { setBusy(null); }
  };
  const skip = async () => {
    setBusy("skip");
    try { await deleteGideonMemory(memory.id); settle({ ...memory, status: "DELETED" }); }
    catch (e) { const s = (e as { status?: number }).status; if (s === 404) settle({ ...memory, status: "DELETED" }); else toastFailure(t("Something went wrong."), e); }
    finally { setBusy(null); }
  };
  const settingsLink = <Link to="/settings" search={{ section: "gideon-memory" }} className="underline-offset-2 hover:underline">{t("GIDEON Memory")}</Link>;

  if (memory.status === "ACTIVE" || memory.status === "DELETED") {
    return (
      <div className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground" role="status">
        {memory.status === "ACTIVE" ? <Check className="mt-px h-3.5 w-3.5 shrink-0" /> : <X className="mt-px h-3.5 w-3.5 shrink-0" />}
        <span className="min-w-0 break-words">
          {memory.status === "ACTIVE" ? t("Saved to") : t("Not saved")}{memory.status === "ACTIVE" ? <> {settingsLink}</> : null}: <span className="text-foreground/80">{memory.text}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs">
      <Brain className="h-3.5 w-3.5 shrink-0 text-sidebar-primary" aria-hidden />
      <span className="min-w-0 flex-1 basis-40 text-foreground">
        <span className="text-muted-foreground">{t("Remember this?")} </span>{memory.text}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={skip} disabled={!!busy}
          className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60")}>
          {busy === "skip" && <Loader2 className="h-3 w-3 animate-spin" />}{t("Don't save")}
        </button>
        <button type="button" onClick={save} disabled={!!busy}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
          {busy === "save" && <Loader2 className="h-3 w-3 animate-spin" />}{t("Save")}
        </button>
      </div>
    </div>
  );
}
