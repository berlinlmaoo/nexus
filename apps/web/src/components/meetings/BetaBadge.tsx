import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";

/** The "Beta" chip every Meeting notes entry point and page carries (owner, 18 Oct 2026). Violet, NEXUS accent. */
export function BetaBadge({ className }: { className?: string }) {
  const { t } = useLang();
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-sidebar-primary ring-1 ring-inset ring-sidebar-primary/20", className)}>
      {t("Beta")}
    </span>
  );
}
