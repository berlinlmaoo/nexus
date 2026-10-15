import type { ComponentType, ReactNode } from "react";
import { FileQuestion, Lock, RotateCw, ServerCrash, WifiOff } from "lucide-react";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { ApiError } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";

/**
 * The one "this didn't load" state on the web (QA 13 Oct 2026). A failed request used to fall into
 * whatever the screen drew when it had no data: "Admin access required" in the Control Room, 0 projects
 * and Iron Lv.1 on the Dashboard, "No attendance data" on Attendance, a skeleton forever on a ticket.
 * Every one of those told the person something false. This tells the truth, in one of four shapes:
 *
 *  - offline    no response at all          → "No connection" + Try again
 *  - notFound   404                         → "This … doesn't exist" (deleted, or a wrong link); no retry
 *  - forbidden  403                         → "You don't have access"; no retry
 *  - server     5xx and anything else       → "Couldn't load …" + Try again
 *
 * Pair it with `retryTransient` on the query, so a 404/403 shows at once instead of after three retries.
 */
export type LoadErrorKind = "offline" | "notFound" | "forbidden" | "server";

export function loadErrorKind(error: unknown): LoadErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 404) return "notFound";
    if (error.status === 403) return "forbidden";
    if (error.status === 0) return "offline";
    return "server";
  }
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg)) return "offline";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  return "server";
}

/** React Query `retry`: never retry a 4xx (the answer won't change); one quick retry otherwise, so an error
 *  shows in about a second instead of three (QA R2 Manager B19). */
export function retryTransient(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

/** True when the error is a real "no access" answer (403), not a failure to get any answer. */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

export function LoadError({
  error,
  onRetry,
  what,
  notFoundTitle,
  notFoundMessage,
  forbiddenTitle,
  forbiddenMessage,
  action,
  compact,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  /** What failed to load, already translated and lower-case: "the tickets", "this month's attendance". */
  what?: string;
  notFoundTitle?: string;
  notFoundMessage?: string;
  forbiddenTitle?: string;
  forbiddenMessage?: string;
  /** Extra action (e.g. a way back) shown next to Try again. */
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useLang();
  const kind = loadErrorKind(error);
  const retry = onRetry && (kind === "offline" || kind === "server")
    ? <EmptyAction onClick={onRetry}><RotateCw className="h-4 w-4" /> {t("Try again")}</EmptyAction>
    : null;
  const acts = retry || action ? <>{retry}{action}</> : undefined;
  const props: { icon: ComponentType<{ className?: string }>; title: string; message: string } =
    kind === "offline"
      ? { icon: WifiOff, title: t("No connection"), message: t("Check your internet, then try again. Nothing was changed.") }
      : kind === "notFound"
        ? { icon: FileQuestion, title: notFoundTitle ?? t("Not found"), message: notFoundMessage ?? t("It may have been deleted, or the link is wrong.") }
        : kind === "forbidden"
          ? { icon: Lock, title: forbiddenTitle ?? t("You don't have access"), message: forbiddenMessage ?? t("Your role can't open this. Ask a board member if you need it.") }
          : { icon: ServerCrash, title: what ? t("Couldn't load {what}", { what }) : t("Couldn't load this"), message: t("Something went wrong on our side. Try again in a moment.") };
  return <EmptyState {...props} tone="muted" compact={compact} className={className} action={acts} />;
}
