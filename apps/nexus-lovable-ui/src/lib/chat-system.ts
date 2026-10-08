import { t } from "@/lib/lang";
import type { NexusMessage, NexusSystemEvent, NexusSystemPerson } from "@/lib/nexus-api";

/**
 * System messages: a group's log lines ("Bagas added Mey", like WhatsApp; server since 8 Oct 2026).
 * The server stores what happened (`event`) and an Indonesian sentence (`content`) for apps that
 * don't know `kind`; this draws the sentence in the interface language, with "You"/"Kamu" for the
 * viewer. An event type this build doesn't know shows `content` as it is.
 */

export function isSystemMessage(m: Pick<NexusMessage, "kind"> | null | undefined): boolean {
  return m?.kind === "SYSTEM";
}

/** "Mey" · "Mey and Yuza" · "Mey, Yuza and Angela" (ID: "… dan …"). */
export function joinNames(names: string[]): string {
  const list = names.filter((n) => n.trim());
  if (list.length <= 1) return list[0] ?? "";
  return t("{names} and {last}", { names: list.slice(0, -1).join(", "), last: list[list.length - 1] });
}

/** The person as the sentence names them: "You" at the start, "you" further on, else their name. */
function who(p: NexusSystemPerson | undefined, meId: string | undefined, start: boolean): string {
  if (p && meId && p.id === meId) return start ? t("You") : t("you");
  return p?.name?.trim() || t("A member");
}

/** The sentence a SYSTEM message stands for, in the current language. */
export function systemSentence(m: Pick<NexusMessage, "event" | "content">, meId?: string): string {
  const e = m.event as NexusSystemEvent | null | undefined;
  if (!e || !e.actor) return m.content ?? "";
  const actor = who(e.actor, meId, true);
  const targets = (e.targets ?? []).map((p) => who(p, meId, false));
  const group = (e.name ?? "").trim();
  switch (e.type) {
    case "members_added":
      return targets.length ? t("{actor} added {names}", { actor, names: joinNames(targets) }) : m.content ?? "";
    case "member_removed":
      return targets.length ? t("{actor} removed {name}", { actor, name: joinNames(targets) }) : m.content ?? "";
    case "member_left":
      return t("{name} left", { name: who(e.targets?.[0] ?? e.actor, meId, true) });
    case "group_created":
      return group ? t("{actor} created the group “{group}”", { actor, group }) : t("{actor} created the group", { actor });
    case "group_renamed":
      return group ? t("{actor} renamed the group to “{group}”", { actor, group }) : m.content ?? "";
    default:
      return m.content ?? "";
  }
}
