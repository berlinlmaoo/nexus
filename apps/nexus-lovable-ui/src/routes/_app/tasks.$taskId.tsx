import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";

export const Route = createFileRoute("/_app/tasks/$taskId")({ component: TaskDetailPage });

function TaskDetailPage() {
  const { taskId } = useParams({ from: "/_app/tasks/$taskId" });
  const navigate = useNavigate();
  return <TaskDetailPanel taskId={taskId} onClose={() => navigate({ to: "/my-tasks" })} />;
}
