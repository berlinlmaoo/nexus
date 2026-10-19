import { createFileRoute, useParams } from "@tanstack/react-router";
import { MeetingPage } from "@/components/meetings/MeetingPage";

/** One meeting's notes (Beta, 18 Oct 2026): status while it is transcribed, then the minutes and tasks to review. */
export const Route = createFileRoute("/_app/meetings/$meetingId")({ component: MeetingRoute });

function MeetingRoute() {
  const { meetingId } = useParams({ from: "/_app/meetings/$meetingId" });
  return <MeetingPage key={meetingId} id={meetingId} />;
}
