import { createFileRoute } from "@tanstack/react-router";
import { GideonPanel } from "@/components/gideon/GideonPanel";

/**
 * GIDEON as a full page (Notion AI's full-page chat, 12 Oct 2026): the conversation list with search on the
 * left, the chat in the middle. ?chat=<id> opens a conversation; without it, a new one.
 */
export const Route = createFileRoute("/_app/gideon")({
  validateSearch: (search: Record<string, unknown>): { chat?: string } => (typeof search.chat === "string" && search.chat ? { chat: search.chat } : {}),
  component: GideonPage,
});

function GideonPage() {
  const { chat } = Route.useSearch();
  return (
    <div className="-mb-8 h-[calc(100dvh-5rem-env(safe-area-inset-bottom))] md:mb-0 md:h-dvh">
      <GideonPanel variant="page" initialChatId={chat ?? null} startNew={!chat} />
    </div>
  );
}
