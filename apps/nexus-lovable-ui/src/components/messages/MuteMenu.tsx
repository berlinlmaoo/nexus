import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ApiError, nexusApi, type NexusConversation } from "@/lib/nexus-api";
import { isMuted, isMutedForever } from "@/lib/chat-unread";
import { localeOf, t } from "@/lib/lang";
import { cn } from "@/lib/utils";

type MuteChoice = "8h" | "1w" | "always" | "off";

function muteValue(choice: MuteChoice): string | "forever" | null {
  if (choice === "off") return null;
  if (choice === "always") return "forever";
  const hours = choice === "8h" ? 8 : 24 * 7;
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/** "Muted" for Always, "Muted until Fri 17:30" otherwise. */
export function mutedLabel(c: Pick<NexusConversation, "mutedUntil">): string {
  if (isMutedForever(c)) return t("Muted");
  const until = new Date(c.mutedUntil ?? "");
  if (Number.isNaN(until.getTime())) return t("Muted");
  const when = until.toLocaleString(localeOf(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  return t("Muted until {when}", { when });
}

type ConversationList = { conversations: NexusConversation[]; totalUnread?: number };

/**
 * Bell menu: silence a room for 8 hours, a week or for good, or undo it. Muted rooms stop pushing (an
 * @mention still gets through) and leave the badge count. In the thread header and, as a labelled
 * button (`labelled`), in the chat info panel.
 */
export function MuteMenu({ conversation, labelled = false }: { conversation: NexusConversation; labelled?: boolean }) {
  const qc = useQueryClient();
  const muted = isMuted(conversation);
  const mute = useMutation({
    mutationFn: (choice: MuteChoice) => nexusApi.muteConversation(conversation.id, muteValue(choice)),
    onSuccess: (res, choice) => {
      const value = res && "mutedUntil" in res ? res.mutedUntil : muteValue(choice);
      qc.setQueryData<ConversationList>(["conversations"], (cur) =>
        cur ? { ...cur, conversations: cur.conversations.map((c) => (c.id === conversation.id ? { ...c, mutedUntil: value } : c)) } : cur,
      );
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["chat-info", conversation.id] });
      toast.success(choice === "off" ? t("Notifications back on for this chat.") : t("Chat muted. You'll still hear about @mentions."));
    },
    onError: (e) => {
      // A server from before 8 Oct 2026 has no mute route at all.
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) toast(t("Muting isn't available yet. It comes with the next server update."));
      else toast.error(t("Couldn't change the mute. Try again."));
    },
  });
  const label = muted ? mutedLabel(conversation) : t("Mute notifications");
  const icon = mute.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {labelled ? (
          <button
            disabled={mute.isPending}
            className={cn("flex w-full flex-col items-center gap-1.5 rounded-2xl border border-border px-2 py-3 text-xs font-semibold transition-colors hover:bg-accent disabled:opacity-50", muted ? "text-primary" : "text-foreground")}
          >
            {icon}
            <span>{muted ? t("Unmute") : t("Mute")}</span>
          </button>
        ) : (
          <button
            title={label}
            aria-label={label}
            disabled={mute.isPending}
            className={cn("rounded-lg p-2 transition-colors hover:bg-accent disabled:opacity-50", muted ? "text-primary" : "text-muted-foreground")}
          >
            {icon}
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">{label}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => mute.mutate("8h")}>{t("For 8 hours")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => mute.mutate("1w")}>{t("For 1 week")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => mute.mutate("always")}>{t("Always")}</DropdownMenuItem>
        {muted && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => mute.mutate("off")}>{t("Unmute")}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
