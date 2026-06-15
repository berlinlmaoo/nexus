import { createFileRoute, useParams, useRouter } from "@tanstack/react-router";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";

export const Route = createFileRoute("/_app/tasks/$taskId")({ component: TaskDetailPage });

function TaskDetailPage() {
  const { taskId } = useParams({ from: "/_app/tasks/$taskId" });
  const router = useRouter();
  // Close → go back to wherever the task was opened from (folder view, board, calendar, search…) instead
  // of always dumping the user on My Tasks. Falls back to /my-tasks on a cold/direct load with no history.
  const onClose = () =>
    router.history.canGoBack() ? router.history.back() : router.navigate({ to: "/my-tasks" });
  return <TaskDetailPanel taskId={taskId} onClose={onClose} />;
}
