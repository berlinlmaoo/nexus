import { Chip } from "@heroui/react";
import { statusMeta, priorityMeta, type Status, type Priority } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  const m = statusMeta[status];
  return (
    <Chip
      size="sm"
      variant="soft"
      className={cn("h-6 px-1 text-xs font-semibold", m.color, className)}
    >
      <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </Chip>
  );
}

export function PriorityTag({ priority }: { priority: Priority }) {
  const m = priorityMeta[priority];
  return (
    <Chip size="sm" variant="soft" className={cn("h-5 px-1 text-[11px] font-semibold", m.color)}>
      {m.label}
    </Chip>
  );
}

export function ProgressBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", color)}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
