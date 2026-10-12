import { createContext, useContext, type ReactNode } from "react";
import { EyeOff } from "lucide-react";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * A task made inside a filtered view that the filter doesn't let through stays on screen until the view
 * changes, marked "Hidden by filter" (Notion keeps it too; bug hunt C-BUG-9, 12 Oct 2026). The project page
 * provides the ids; cards, rows and table rows read them.
 */
const Ctx = createContext<ReadonlySet<string>>(new Set());

export function FilterHintProvider({ ids, children }: { ids: ReadonlySet<string>; children: ReactNode }) {
  return <Ctx.Provider value={ids}>{children}</Ctx.Provider>;
}

export function useFilteredOut(taskId: string): boolean {
  return useContext(Ctx).has(taskId);
}

export function FilterHint({ className }: { className?: string }) {
  const { t } = useLang();
  return (
    <span title={t("This task doesn't match the view's filter. It stays here until you leave or change the view.")} className={cn("inline-flex w-fit shrink-0 items-center gap-1 rounded px-1 text-[11px] leading-4 text-muted-foreground", className)}>
      <EyeOff className="h-3 w-3" />{t("Hidden by filter")}
    </span>
  );
}
