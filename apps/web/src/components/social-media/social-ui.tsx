import { Info } from "lucide-react";
import { useLang } from "@/lib/lang";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { count } from "@/components/outlet-sales/outlet-ui";

/** Shared bits of the Social Media Report (owner, 14 Oct 2026; components/social-media). */

/** Error text from a refused write: the server's message when it sent one. */
export function socialErrorText(error: unknown, fallback: string): string {
  const payload = (error as { payload?: { error?: unknown } } | null)?.payload;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

/** Whole numbers the way the rest of NEXUS prints them ("12.400"); "—" for nothing. */
export function num(n: number | null | undefined, lang: "en" | "id"): string {
  return count(n === null || n === undefined ? n : Math.round(n), lang);
}

/** "Views" is already the word for a project's saved views in the shared dictionary ("Tampilan"); here it is plays. */
export function viewsLabel(lang: string): string {
  return lang === "id" ? "Tayangan" : "Views";
}

/** "Engagement = Likes + Comments + Shares", one tap away (a popover, so it works on a phone too). */
export function EngagementInfo() {
  const { t } = useLang();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("What counts as engagement")}
          className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-9"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-64 text-xs leading-relaxed">
        <p className="font-semibold">{t("Engagement = Likes + Comments + Shares")}</p>
        <p className="mt-1 text-muted-foreground">{t("Views are counted on their own and are not part of engagement.")}</p>
      </PopoverContent>
    </Popover>
  );
}

