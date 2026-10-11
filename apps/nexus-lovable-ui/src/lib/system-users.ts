import { t } from "@/lib/lang";

/**
 * System identities that sign writes (server: lib/automation-identity.ts). Their stored name is English;
 * the web shows it in the interface language. Recognised by the fixed avatar path, which every author
 * payload carries (email is not always selected).
 */
export const AUTOMATION_AVATAR = "/api/system-avatars/automation.png";

export function isAutomationUser(u?: { avatar?: string | null; email?: string | null } | null): boolean {
  return !!u && (u.avatar === AUTOMATION_AVATAR || u.email === "automation@nexus.invalid");
}

/** The name to show for an author: "Automation" / "Otomasi" for the system identity, else the stored name. */
export function displayName(u?: { name?: string | null; avatar?: string | null; email?: string | null } | null, fallback = ""): string {
  if (isAutomationUser(u)) return t("Automation");
  return u?.name ?? fallback;
}
