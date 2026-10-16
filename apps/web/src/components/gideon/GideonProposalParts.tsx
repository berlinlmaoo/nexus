import { GideonMark } from "./GideonMark";
import { useLang } from "@/lib/lang";

/** The buttons on every approval card (Notion AI: a quiet Discard, a solid Apply). */
export const PROPOSAL_DISCARD = "inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export const PROPOSAL_APPLY = "inline-flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50";

/**
 * The top of an approval card, Notion AI style: GIDEON's mark, what it wants to do, and whether it is
 * waiting for you.
 */
export function ProposalHead({ open, title, summary }: { open: boolean; title: string; summary: string }) {
  const { t } = useLang();
  return (
    <div className="flex items-start gap-2.5 px-3 pb-2 pt-2.5">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border bg-background"><GideonMark className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" title={summary}>{open ? title : summary}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {open && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
          {open ? t("Waiting for your approval") : title}
        </span>
      </span>
    </div>
  );
}
