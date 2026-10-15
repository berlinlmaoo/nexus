// One way to say "that didn't work" (QA 13 Oct 2026). Failed writes were silent (profile photo remove,
// profile save, announcement deactivate/delete), showed raw server or browser text ("Forbidden: LEAD role
// required…", "The operation either timed out or was not allowed"), or used window.alert. Every write
// failure now becomes a toast with a title saying what failed and a description saying why, in the UI
// language.
import { toast } from "sonner";
import { ApiError } from "@/lib/nexus-api";
import { t } from "@/lib/lang";

/** Server text that is a code word for a developer, not a sentence for a person. */
const RAW = /^(forbidden|unauthorized|internal server error|request failed|not found|bad request|missing fields|invalid\b|[a-z]+ is required|[a-z]+ required)/i;

export function failureText(e: unknown): string {
  // WebAuthn (passkeys): the browser's DOMException names, not its English sentences.
  if (typeof DOMException !== "undefined" && e instanceof DOMException) {
    if (e.name === "NotAllowedError" || e.name === "AbortError") return t("The passkey prompt was closed or timed out. Nothing was added.");
    if (e.name === "InvalidStateError") return t("This device already has a passkey for your account.");
    if (e.name === "SecurityError") return t("Passkeys only work on the NEXUS address itself.");
    return t("Your browser couldn't create the passkey. Try again.");
  }
  if (e instanceof ApiError) {
    if (e.status === 401) return t("Your session ended. Sign in again, then retry.");
    if (e.status === 403) {
      const code = (e.payload as { code?: string } | null)?.code;
      if (code === "NEEDS_EDIT_ACCESS") return t("You can view this project but not change it. Ask its Project Owner for Can edit access.");
      if (code === "NEEDS_COMMENT_ACCESS") return t("You can view this project but not comment. Ask its Project Owner for Can comment access.");
      if (code === "NEEDS_FULL_ACCESS") return t("Only people with Full access to the project can do this.");
      return t("Your role can't do this. Ask a board member if you need it.");
    }
    if (e.status === 404) return t("It no longer exists. Refresh the page.");
    if (e.status === 429) return e.message; // already translated by apiFetch
    if (e.status >= 500) return t("Something went wrong on our side. Try again in a moment.");
    const msg = (e.message ?? "").trim();
    return msg && !RAW.test(msg) ? msg : t("The server didn't accept it. Check what you entered and try again.");
  }
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (/already has a passkey/i.test(msg)) return t("This device already has a passkey for your account.");
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg) || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    return t("No connection. Check your internet and try again.");
  }
  return t("Something went wrong. Try again.");
}

/** toast.error("Couldn't save your profile", { description: why }). `title` is already translated. */
export function toastFailure(title: string, e: unknown) {
  toast.error(title, { description: failureText(e) });
}
