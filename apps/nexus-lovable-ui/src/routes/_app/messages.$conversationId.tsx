import { createFileRoute, redirect } from "@tanstack/react-router";

// `/messages/<id>` was the link every chat notification carried until 20 Sep 2026, and nothing here
// ever matched it — the tap opened the list and lost the chat. New rows link to `/messages?c=<id>`;
// this keeps the rows written before that (and any bookmark) landing on the conversation.
export const Route = createFileRoute("/_app/messages/$conversationId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/messages", search: { c: params.conversationId } });
  },
});
